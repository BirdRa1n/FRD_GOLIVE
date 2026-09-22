// Orquestra a sessão RTC conforme o estado do Discord e as configurações.
//
// Arquitetura: mídia via SFU (LiveKit) + um canal de CONTROLE (WebSocket) para
// receber a policy (habilitação/quotas) e reportar o estado de transmissão ao
// admin. A mídia entra no LiveKit pelo IP público definido no servidor.
//
// Camadas de resiliência:
//  1. O LiveKit religa quedas transitórias sozinho.
//  2. Se o canal de controle cair e o usuário ainda quiser estar no canal,
//     reconectamos com backoff (buscando config/token novos).

import { getLocalUser } from "../discordState";
import { settings } from "../settings";
import { streamStore } from "../state/streamStore";
import { pickSource } from "../ui/pickerController";
import { playStreamSound } from "../ui/streamSounds";
import {
    captureNativeSource,
    getNativeSources,
    isNativeCaptureAvailable,
} from "./nativeCapture";
import { RtcSession } from "./session";
import { type Policy, SignalingClient } from "./signalingClient";

/** Canal de controle (policy/presença). */
let control: SignalingClient | null = null;
/** Sessão de mídia (LiveKit). */
let session: RtcSession | null = null;
/** Canal em que o usuário QUER estar conectado (null = saída intencional). */
let desiredChannel: string | null = null;
let suppressReconnect = false;

let policy: Policy = { enabled: false, maxHeight: 0, maxFps: 0 };
let mediaServerUrl = "";
let mediaConnecting = false;

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

const MAX_RETRIES = 6;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

function retryDelay(attempt: number): number {
    return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function cancelRetry(): void {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

/** Traduz erros técnicos em mensagens acionáveis para o usuário. */
function describeError(e: unknown): string {
    if (e instanceof Error) {
        const m = e.message;
        if (m.includes("403")) return "Usuário não habilitado pelo admin — peça acesso no site.";
        if (m.includes("503")) return "SFU indisponível no servidor (LiveKit não configurado).";
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(m))
            return "Servidor privado inacessível (offline ou URL incorreta).";
        return m;
    }
    return String(e);
}

interface ClientConfig {
    signalingUrl: string;
    serverUrl: string;
}

function base(): string {
    return settings.store.tokenServiceUrl.replace(/\/+$/, "");
}

async function fetchConfig(): Promise<ClientConfig> {
    const res = await fetch(`${base()}/config`);
    if (!res.ok) throw new Error(`servidor respondeu ${res.status} em /config`);
    return await res.json() as ClientConfig;
}

async function fetchToken(room: string, userId: string, name: string): Promise<{ token: string; serverUrl?: string; }> {
    const res = await fetch(`${base()}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, userId, name }),
    });
    if (!res.ok) throw new Error(`token: servidor respondeu ${res.status}`);
    const data = await res.json() as { token?: string; serverUrl?: string; };
    if (!data.token) throw new Error("servidor não retornou um token");
    return { token: data.token, serverUrl: data.serverUrl };
}

function buildSession(): RtcSession {
    return new RtcSession({
        onStreamAdded: info => streamStore.upsert(info),
        onStreamUpdated: info => streamStore.upsert(info),
        onStreamRemoved: id => streamStore.remove(id),
        onConnected: () => { retryAttempt = 0; streamStore.setStatus("connected"); },
        onReconnecting: () => streamStore.setStatus("reconnecting"),
        onReconnected: () => streamStore.setStatus("connected"),
        onDisconnected: () => handleUnexpectedDisconnect(),
        onRemoteVideoStarted: () => playStreamSound("start"),
        onRemoteVideoStopped: () => playStreamSound("stop"),
        onLocalSharingStopped: () => {
            control?.setState(false);
            streamStore.setSharing(null);
            playStreamSound("stop");
        },
    });
}

/** Aplica a policy recebida do controle: gate de habilitação + conexão de mídia. */
function applyPolicy(p: Policy): void {
    policy = p;
    if (!p.enabled) {
        streamStore.setError("Aguardando liberação do admin — peça acesso no site.");
        return;
    }
    streamStore.clearError();
    void ensureMedia();
}

/** Conecta a mídia (LiveKit) — só quando o usuário está habilitado. */
async function ensureMedia(): Promise<void> {
    if (!policy.enabled || mediaConnecting || session?.isConnected) return;
    const user = getLocalUser();
    const room = desiredChannel;
    if (!user || !room) return;

    mediaConnecting = true;
    try {
        const { token, serverUrl } = await fetchToken(room, user.id, user.username);
        const url = serverUrl || mediaServerUrl;
        if (!url) throw new Error("URL do servidor de mídia ausente na config");
        const s = buildSession();
        session = s;
        await s.connect(url, token);
    } catch (e) {
        streamStore.setError(describeError(e));
    } finally {
        mediaConnecting = false;
    }
}

async function teardown(): Promise<void> {
    suppressReconnect = true;
    try {
        if (session) { await session.disconnect().catch(() => { /* ok */ }); }
        control?.close();
    } finally {
        session = null;
        control = null;
        mediaConnecting = false;
        suppressReconnect = false;
    }
}

async function establish(channelId: string): Promise<void> {
    const user = getLocalUser();
    if (!user) throw new Error("Usuário do Discord indisponível.");

    streamStore.setStatus(retryAttempt > 0 ? "reconnecting" : "connecting");
    await teardown();

    const cfg = await fetchConfig();
    mediaServerUrl = cfg.serverUrl;

    control = new SignalingClient({
        onJoined: p => applyPolicy(p),
        onPolicy: p => applyPolicy(p),
        onPeers: () => { /* SFU: peers vêm do LiveKit */ },
        onPeerJoined: () => { /* idem */ },
        onPeerLeft: () => { /* idem */ },
        onSignal: () => { /* idem */ },
        onClose: () => handleUnexpectedDisconnect(),
    });
    await control.connect(cfg.signalingUrl, channelId, user.id, user.username);
    streamStore.setStatus("connected");
}

function handleUnexpectedDisconnect(): void {
    streamStore.clearStreams();
    if (suppressReconnect) return;
    if (!desiredChannel) return;
    scheduleRetry();
}

function scheduleRetry(): void {
    cancelRetry();
    if (retryAttempt >= MAX_RETRIES) {
        streamStore.setError("Não foi possível reconectar ao servidor privado.");
        return;
    }
    streamStore.setStatus("reconnecting");
    const delay = retryDelay(retryAttempt);
    retryTimer = setTimeout(() => {
        retryAttempt++;
        const channel = desiredChannel;
        if (!channel) return;
        establish(channel).catch(e => {
            console.error("[FRD GoLive] reconexão falhou:", e);
            scheduleRetry();
        });
    }, delay);
}

export async function connectToChannel(channelId: string): Promise<void> {
    if (desiredChannel === channelId && control?.isConnected) return;

    cancelRetry();
    desiredChannel = channelId;
    retryAttempt = 0;
    streamStore.clearStreams();

    try {
        await establish(channelId);
    } catch (e) {
        streamStore.setError(describeError(e));
        scheduleRetry();
    }
}

export async function disconnect(): Promise<void> {
    desiredChannel = null;
    cancelRetry();
    retryAttempt = 0;
    await teardown();
    streamStore.reset();
}

/** Tentativa manual de reconexão (botão do painel). */
export async function reconnectNow(): Promise<void> {
    if (!desiredChannel) return;
    cancelRetry();
    retryAttempt = 0;
    streamStore.clearError();
    try {
        await establish(desiredChannel);
    } catch (e) {
        streamStore.setError(describeError(e));
        scheduleRetry();
    }
}

/** Aplica as quotas do admin (resolução/FPS) sobre o pedido do usuário. */
function clampToPolicy(maxHeight: number, fps: number): { maxHeight: number; fps: number; } {
    return {
        maxHeight: policy.maxHeight > 0 ? Math.min(maxHeight, policy.maxHeight) : maxHeight,
        fps: policy.maxFps > 0 ? Math.min(fps, policy.maxFps) : fps,
    };
}

function ensureMediaReady(): RtcSession {
    if (!policy.enabled) throw new Error("Aguardando liberação do admin — peça acesso no site.");
    if (!session?.isConnected) throw new Error("Conectando à mídia — tente novamente em instantes.");
    return session;
}

export async function startScreenShare(): Promise<void> {
    const s = ensureMediaReady();

    if (settings.store.nativeScreenCapture && isNativeCaptureAvailable()) {
        return startScreenShareNative();
    }

    const q = clampToPolicy(Number(settings.store.maxHeight), Number(settings.store.fps));
    try {
        await s.shareScreen({ systemAudio: settings.store.includeSystemAudio, maxHeight: q.maxHeight, fps: q.fps });
        markSharing("screen");
    } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") return;
        if (isNativeCaptureAvailable()) {
            try { await startScreenShareNative(); return; }
            catch (nativeErr) { streamStore.setError(describeError(nativeErr)); return; }
        }
        streamStore.setError(describeError(e));
    }
}

/** Compartilha a tela usando o desktopCapturer do Electron (contorna o Discord). */
export async function startScreenShareNative(): Promise<void> {
    const s = ensureMediaReady();

    const sources = await getNativeSources();
    if (sources.length === 0) throw new Error("Nenhuma tela/janela disponível para capturar.");

    const chosen = await pickSource(sources);
    if (!chosen) return;

    const q = clampToPolicy(Number(settings.store.maxHeight), Number(settings.store.fps));
    const stream = await captureNativeSource(chosen.id, {
        systemAudio: settings.store.includeSystemAudio,
        maxHeight: q.maxHeight,
        fps: q.fps,
    });
    await s.publishMediaStream(stream);
    markSharing("screen");
}

export async function startCameraShare(): Promise<void> {
    const s = ensureMediaReady();
    try {
        await s.shareCamera();
        markSharing("camera");
    } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") return;
        streamStore.setError(describeError(e));
    }
}

function markSharing(kind: "screen" | "camera"): void {
    control?.setState(true, kind);
    streamStore.setSharing(kind);
    playStreamSound("start");
}

/** O estado/som de "parou" vêm do onLocalSharingStopped da sessão. */
export async function stopSharing(): Promise<void> {
    if (!session) return;
    await session.stopSharing();
}

/** Chamado quando o canal de voz selecionado muda (ou fica null ao sair). */
export function onVoiceChannelChange(channelId: string | null): void {
    if (channelId) {
        connectToChannel(channelId).catch(e => console.error("[FRD GoLive]", e));
    } else {
        disconnect().catch(e => console.error("[FRD GoLive]", e));
    }
}
