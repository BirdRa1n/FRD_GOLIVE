// Módulo NATIVO do plugin — roda no processo main do Electron (Vencord expõe as
// funções exportadas aqui via VencordNative.pluginHelpers.FRDGoLive).
//
// 1) Lista telas/janelas pelo desktopCapturer (contorna o getDisplayMedia do
//    Discord e o bloqueio regional).
// 2) Áudio da transmissão SEM o áudio do Discord (a call não vaza para quem
//    assiste — ninguém se escuta na live), no Windows:
//    - o Chromium tem o dispositivo "loopbackWithoutChrome": áudio do sistema
//      EXCLUINDO a árvore de processos de quem captura (WASAPI process loopback,
//      PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE);
//    - por padrão quem captura é o processo do *serviço de áudio* do Chromium, e
//      a voz da call (discord_voice) toca no *renderer* — que não é filho dele.
//      Então rodamos o serviço de áudio DENTRO do processo principal
//      (--disable-features=AudioServiceOutOfProcess): a árvore excluída passa a
//      ser o Discord inteiro (main → renderer com a voz, GPU, utilitários);
//    - a captura vai por getDisplayMedia; o handler abaixo responde com a fonte
//      escolhida no picker + audio "loopbackWithoutChrome" (o Electron 42 repassa
//      o id como está; o 43+ também, e ainda mapeia restrictOwnAudio).
//
// Este arquivo é carregado pelo Vencord ANTES do código do Discord, o que
// permite ajustar as flags do Chromium a tempo (antes do app ficar "ready").

import { RendererSettings } from "@main/settings";
import { app, desktopCapturer, type IpcMainInvokeEvent, session } from "electron";
import { release } from "node:os";

import type { NativeSource } from "./types";

const IS_WIN = process.platform === "win32";
const OWN_AUDIO_EXCLUDED_DEVICE = "loopbackWithoutChrome";
const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";

function pluginSettings(): { enabled?: boolean; excludeDiscordAudio?: boolean; } {
    try {
        return (RendererSettings.store.plugins?.FRDGoLive ?? {}) as { enabled?: boolean; excludeDiscordAudio?: boolean; };
    } catch {
        return {};
    }
}

/** Windows 10 2004 (build 19041)+ tem o process loopback do WASAPI. */
function windowsSupportsProcessLoopback(): boolean {
    if (!IS_WIN) return false;
    const build = Number(release().split(".")[2] ?? 0);
    return build >= 19041;
}

// --- 1. Flags do Chromium (antes do "ready") ------------------------------------

/** Junta listas "A,B" sem duplicar. */
function mergeFeatureList(current: string, extra: string): string {
    const set = new Set([...current.split(","), ...extra.split(",")].map(s => s.trim()).filter(Boolean));
    return [...set].join(",");
}

const wantInProcessAudio =
    windowsSupportsProcessLoopback()
    && pluginSettings().enabled !== false
    && pluginSettings().excludeDiscordAudio !== false;

if (wantInProcessAudio) {
    const cl = app.commandLine;
    // O Discord também define --disable-features (depois de nós); o último
    // appendSwitch venceria. Envolvemos o appendSwitch para SEMPRE mesclar.
    const original = cl.appendSwitch.bind(cl);
    cl.appendSwitch = (name: string, value?: string) => {
        if ((name === "disable-features" || name === "enable-features") && value !== undefined) {
            value = mergeFeatureList(cl.getSwitchValue(name), value);
            if (name === "disable-features") value = mergeFeatureList(value, AUDIO_SERVICE_FEATURE);
        }
        return value === undefined ? original(name) : original(name, value);
    };
    cl.appendSwitch("disable-features", AUDIO_SERVICE_FEATURE);
}

// --- 2. Handler do getDisplayMedia --------------------------------------------

interface PendingCapture {
    sourceId: string;
    sourceName: string;
    audio: boolean;
    at: number;
}

let pending: PendingCapture | null = null;
type DisplayHandler = Parameters<Electron.Session["setDisplayMediaRequestHandler"]>[0];
/** Handler que o próprio Discord registrou (chamado quando o pedido não é nosso). */
let discordHandler: DisplayHandler | null = null;

function installDisplayMediaHandler(): void {
    const ses = session.defaultSession;
    const originalSet = ses.setDisplayMediaRequestHandler.bind(ses);

    const combined: DisplayHandler = (request, callback) => {
        const p = pending;
        if (p && Date.now() - p.at < 15_000) {
            pending = null; // uso único
            callback({
                video: { id: p.sourceId, name: p.sourceName } as Electron.DesktopCapturerSource,
                ...(p.audio && request.audioRequested ? { audio: OWN_AUDIO_EXCLUDED_DEVICE as "loopback" } : {}),
            });
            return;
        }
        if (discordHandler) return discordHandler(request, callback);
        // Sem handler do Discord: nega (comportamento padrão sem handler).
        callback({});
    };

    // Se o Discord registrar (ou trocar) o handler dele, guardamos e mantemos o nosso na frente.
    ses.setDisplayMediaRequestHandler = ((handler: DisplayHandler | null, opts?: Electron.DisplayMediaRequestHandlerOpts) => {
        discordHandler = handler;
        originalSet(combined, opts);
    }) as typeof ses.setDisplayMediaRequestHandler;

    originalSet(combined);
}

// Registrado antes do Discord: roda primeiro no "ready".
app.whenReady().then(installDisplayMediaHandler).catch(e => console.error("[FRD GoLive] handler de display media:", e));

// --- API exposta ao renderer ------------------------------------------------------

export async function getScreenSources(_: IpcMainInvokeEvent): Promise<NativeSource[]> {
    const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
    });

    return sources.map(source => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith("screen:") ? "screen" as const : "window" as const,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined,
    }));
}

export interface AudioCaps {
    /** Dá para transmitir o som SEM o áudio do Discord (a call). */
    excludesDiscord: boolean;
    /** Motivo quando não dá (mostrado no picker). */
    reason?: string;
}

/** O que esta máquina consegue fazer com o áudio da transmissão. */
export function getAudioCaps(_: IpcMainInvokeEvent): AudioCaps {
    if (!IS_WIN) return { excludesDiscord: false, reason: "O macOS não permite capturar o som do sistema." };
    if (!windowsSupportsProcessLoopback()) {
        return { excludesDiscord: false, reason: "Requer Windows 10 (versão 2004) ou mais novo para separar o áudio do Discord." };
    }
    if (!wantInProcessAudio) {
        return { excludesDiscord: false, reason: "Separação do áudio do Discord desligada nas configurações do plugin." };
    }
    // Confere se a flag pegou: com ela, não existe processo de serviço de áudio separado.
    const outOfProcess = app.getAppMetrics().some(m => m.serviceName === "audio.mojom.AudioService");
    if (outOfProcess) {
        return { excludesDiscord: false, reason: "Reinicie o Discord por completo para ativar o som sem o áudio da call." };
    }
    return { excludesDiscord: true };
}

/**
 * Reserva a próxima chamada de getDisplayMedia do renderer para a fonte escolhida
 * no nosso picker (com áudio sem o Discord, se pedido). Vale por 15 s.
 */
export function prepareCapture(_: IpcMainInvokeEvent, sourceId: string, sourceName: string, audio: boolean): void {
    pending = { sourceId, sourceName, audio, at: Date.now() };
}

export function cancelCapture(_: IpcMainInvokeEvent): void {
    pending = null;
}
