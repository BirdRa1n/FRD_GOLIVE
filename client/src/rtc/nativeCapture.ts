// Captura de tela NATIVA no renderer, sem passar pelo getDisplayMedia do Discord.
//
// Lista as fontes pelo módulo nativo (desktopCapturer) e captura a escolhida via
// getUserMedia com `chromeMediaSource: "desktop"` — API do Electron/Chromium que
// ignora o gate regional do Discord.

import type { NativeSource } from "../types";

export interface AudioCaps {
    /** Dá para transmitir o som SEM o áudio do Discord (a call). */
    excludesDiscord: boolean;
    reason?: string;
}

interface NativeApi {
    getScreenSources(): Promise<NativeSource[]>;
    getAudioCaps?(): Promise<AudioCaps>;
    prepareCapture?(sourceId: string, sourceName: string, audio: boolean): Promise<void>;
    cancelCapture?(): Promise<void>;
}

/** Acessa o módulo nativo exposto pelo Vencord (só existe no Discord Desktop). */
function getNative(): NativeApi {
    const helpers = (window as { VencordNative?: { pluginHelpers?: Record<string, unknown>; }; })
        .VencordNative?.pluginHelpers;
    const api = helpers?.FRDGoLive as NativeApi | undefined;
    if (!api?.getScreenSources) {
        throw new Error("Captura nativa indisponível (requer Discord Desktop com o plugin).");
    }
    return api;
}

export function isNativeCaptureAvailable(): boolean {
    try {
        getNative();
        return true;
    } catch {
        return false;
    }
}

export function getNativeSources(): Promise<NativeSource[]> {
    return getNative().getScreenSources();
}

/** Se esta máquina consegue transmitir o som sem o áudio do Discord. */
export async function getAudioCaps(): Promise<AudioCaps> {
    const api = getNative();
    if (!api.getAudioCaps) return { excludesDiscord: false, reason: "Atualize o plugin (reinstale pelo instalador)." };
    return api.getAudioCaps();
}

export interface NativeCaptureOptions {
    systemAudio: boolean;
    /** Altura máxima em px; 0 = resolução da fonte. */
    maxHeight: number;
    fps: number;
}

/**
 * Captura a fonte com o áudio do sistema SEM o áudio do Discord (Windows).
 * O módulo nativo reserva o próximo getDisplayMedia para esta fonte e responde
 * com o dispositivo "loopbackWithoutChrome" — que, com o serviço de áudio no
 * processo principal, exclui a árvore inteira do Discord (inclusive a call).
 */
export async function captureWithoutDiscordAudio(
    source: NativeSource,
    opts: Omit<NativeCaptureOptions, "systemAudio">,
): Promise<MediaStream> {
    const api = getNative();
    if (!api.prepareCapture) throw new Error("Captura de áudio sem o Discord indisponível nesta versão do plugin.");
    await api.prepareCapture(source.id, source.name, true);
    try {
        return await navigator.mediaDevices.getDisplayMedia({
            video: opts.maxHeight > 0
                ? { height: { max: opts.maxHeight }, width: { max: Math.round((opts.maxHeight * 16) / 9) }, frameRate: { max: opts.fps } }
                : { frameRate: { max: opts.fps } },
            // Não silenciar o som local de quem transmite; e pedir para excluir o
            // próprio app (honrado pelo Electron 43+, e forçado pelo nosso handler).
            audio: { suppressLocalAudioPlayback: false, restrictOwnAudio: true } as MediaTrackConstraints,
            systemAudio: "include",
        } as DisplayMediaStreamOptions);
    } catch (e) {
        await api.cancelCapture?.();
        throw e;
    }
}

export async function captureNativeSource(
    sourceId: string,
    opts: NativeCaptureOptions,
): Promise<MediaStream> {
    // maxHeight 0 = resolução da fonte (sem limite de tamanho).
    const size = opts.maxHeight > 0
        ? { maxWidth: Math.round((opts.maxHeight * 16) / 9), maxHeight: opts.maxHeight }
        : {};
    const video = {
        mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            ...size,
            maxFrameRate: opts.fps,
        },
    };

    // ATENÇÃO: aqui o áudio é o do SISTEMA INTEIRO — inclui a call do Discord.
    // Só é usado quando o usuário desliga "separar o áudio do Discord"; o padrão
    // é captureWithoutDiscordAudio.
    if (opts.systemAudio) {
        try {
            return await navigator.mediaDevices.getUserMedia({
                audio: { mandatory: { chromeMediaSource: "desktop" } },
                video,
            } as unknown as MediaStreamConstraints);
        } catch {
            // plataforma sem áudio de sistema (ex.: macOS) → segue só com vídeo
        }
    }

    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video,
    } as unknown as MediaStreamConstraints);
}
