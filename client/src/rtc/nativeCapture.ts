// Captura de tela NATIVA no renderer, sem passar pelo getDisplayMedia do Discord.
//
// Lista as fontes pelo módulo nativo (desktopCapturer) e captura a escolhida via
// getUserMedia com `chromeMediaSource: "desktop"` — API do Electron/Chromium que
// ignora o gate regional do Discord.

import type { NativeSource } from "../types";

interface NativeApi {
    getScreenSources(): Promise<NativeSource[]>;
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

export interface NativeCaptureOptions {
    systemAudio: boolean;
    maxHeight: number;
    fps: number;
}

export async function captureNativeSource(
    sourceId: string,
    opts: NativeCaptureOptions,
): Promise<MediaStream> {
    const video = {
        mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            maxWidth: Math.round((opts.maxHeight * 16) / 9),
            maxHeight: opts.maxHeight,
            maxFrameRate: opts.fps,
        },
    };

    // ATENÇÃO: o desktopCapturer captura o áudio do SISTEMA INTEIRO — inclui a call
    // do Discord. Para áudio SEM a call, use getDisplayMedia compartilhando uma ABA.
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
