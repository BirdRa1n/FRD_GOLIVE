// Orquestra a sessão RTC de acordo com o estado do Discord e das configurações.
// Acopla session.ts (puro) + streamStore (puro) + settings/discordState (Vencord).
//
// Camadas de resiliência:
//  1. LiveKit religa sozinho quedas transitórias (onReconnecting/onReconnected).
//  2. Se o LiveKit desistir (onDisconnected) e o usuário ainda quiser estar no
//     canal, tentamos reconectar com backoff — buscando um token novo (o antigo
//     pode ter expirado durante a queda).

import { getLocalUser } from "../discordState";
import { settings } from "../settings";
import { streamStore } from "../state/streamStore";
import { pickSource } from "../ui/sourcePicker";
import {
    captureNativeSource,
    getNativeSources,
    isNativeCaptureAvailable,
} from "./nativeCapture";
import { RtcSession } from "./session";

let session: RtcSession | null = null;
/** Canal em que o usuário QUER estar conectado (null = saída intencional). */
let desiredChannel: string | null = null;
/** Suprime a lógica de reconexão durante desconexões que nós mesmos provocamos. */
let suppressReconnect = false;

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

const MAX_RETRIES = 6;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

function retryDelay(attempt: number): number {
    return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function cancelRetry(): void {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

/** Traduz erros técnicos em mensagens acionáveis para o usuário. */
function describeError(e: unknown): string {
    if (e instanceof Error) {
        const m = e.message;
        if (m.includes("403")) return "Segredo da organização inválido.";
        if (m.includes("401")) return "Não autorizado pelo servidor privado.";
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(m))
            return "Servidor privado inacessível (offline ou URL incorreta).";
        return m;
    }
    return String(e);
}

async function fetchToken(room: string, identity: string, name: string): Promise<string> {
    const base = settings.store.tokenServiceUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, identity, name, orgSecret: settings.store.orgSecret }),
    });
    if (!res.ok) throw new Error(`token-service respondeu ${res.status}`);
    const data = await res.json() as { token?: string; };
    if (!data.token) throw new Error("token-service não retornou um token");
    return data.token;
}

function buildSession(): RtcSession {
    return new RtcSession({
        onStreamAdded: info => streamStore.upsert(info),
        onStreamUpdated: info => streamStore.upsert(info),
        onStreamRemoved: id => streamStore.remove(id),
        onConnected: () => {
            retryAttempt = 0;
            streamStore.setStatus("connected");
        },
        onReconnecting: () => streamStore.setStatus("reconnecting"),
        onReconnected: () => streamStore.setStatus("connected"),
        onDisconnected: () => handleUnexpectedDisconnect(),
    });
}

/** Encerra a sessão atual sem disparar reconexão nem mexer no desiredChannel. */
async function disposeSession(): Promise<void> {
    if (!session) return;
    suppressReconnect = true;
    try {
        await session.disconnect();
    } finally {
        session = null;
        suppressReconnect = false;
    }
}

async function establish(channelId: string): Promise<void> {
    const user = getLocalUser();
    if (!user) throw new Error("Usuário do Discord indisponível.");
    if (!settings.store.orgSecret) {
        streamStore.setError("Configure o segredo da organização nas configurações do plugin.");
        return;
    }

    streamStore.setStatus(retryAttempt > 0 ? "reconnecting" : "connecting");

    await disposeSession();
    session = buildSession();

    const token = await fetchToken(channelId, user.id, user.username);
    await session.connect(settings.store.serverUrl, token);
}

function handleUnexpectedDisconnect(): void {
    streamStore.clearStreams();
    if (suppressReconnect) return; // fomos nós que desconectamos
    if (!desiredChannel) return; // usuário saiu do canal
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
    if (desiredChannel === channelId && session?.isConnected) return;

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
    desiredChannel = null; // marca intenção ANTES do teardown
    cancelRetry();
    retryAttempt = 0;
    await disposeSession();
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

export async function startScreenShare(): Promise<void> {
    if (!session) throw new Error("Conecte-se a um canal de voz primeiro.");

    // Modo nativo forçado (para regiões onde o Discord bloqueia a captura).
    if (settings.store.nativeScreenCapture && isNativeCaptureAvailable()) {
        return startScreenShareNative();
    }

    try {
        await session.shareScreen({
            systemAudio: settings.store.includeSystemAudio,
            maxHeight: Number(settings.store.maxHeight),
            fps: Number(settings.store.fps),
        });
        streamStore.setSharing("screen");
    } catch (e) {
        // Cancelar o seletor de tela do navegador não é um erro real.
        if (e instanceof Error && e.name === "NotAllowedError") return;

        // Falha "dura" (ex.: bloqueio regional): tenta a captura nativa.
        if (isNativeCaptureAvailable()) {
            try {
                await startScreenShareNative();
                return;
            } catch (nativeErr) {
                streamStore.setError(describeError(nativeErr));
                return;
            }
        }
        streamStore.setError(describeError(e));
    }
}

/** Compartilha a tela usando o desktopCapturer do Electron (contorna o Discord). */
export async function startScreenShareNative(): Promise<void> {
    if (!session) throw new Error("Conecte-se a um canal de voz primeiro.");

    const sources = await getNativeSources();
    if (sources.length === 0) throw new Error("Nenhuma tela/janela disponível para capturar.");

    const chosen = await pickSource(sources);
    if (!chosen) return; // usuário cancelou o picker

    const stream = await captureNativeSource(chosen.id, {
        systemAudio: settings.store.includeSystemAudio,
        maxHeight: Number(settings.store.maxHeight),
        fps: Number(settings.store.fps),
    });
    await session.publishMediaStream(stream);
    streamStore.setSharing("screen");
}

export async function startCameraShare(): Promise<void> {
    if (!session) throw new Error("Conecte-se a um canal de voz primeiro.");
    try {
        await session.shareCamera();
        streamStore.setSharing("camera");
    } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") return;
        streamStore.setError(describeError(e));
    }
}

export async function stopSharing(): Promise<void> {
    if (!session) return;
    await session.stopSharing();
    streamStore.setSharing(null);
}

/** Chamado quando o canal de voz selecionado muda (ou fica null ao sair). */
export function onVoiceChannelChange(channelId: string | null): void {
    if (channelId) {
        connectToChannel(channelId).catch(e => console.error("[FRD GoLive]", e));
    } else {
        disconnect().catch(e => console.error("[FRD GoLive]", e));
    }
}
