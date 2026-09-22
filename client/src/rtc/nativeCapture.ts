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

    // SEM áudio: o desktopCapturer só captura o áudio do SISTEMA INTEIRO, o que
    // incluiria a call do Discord (a voz dos membros vazaria na transmissão).
    // Áudio scoped (só da janela) existe apenas no caminho getDisplayMedia.
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video,
    } as unknown as MediaStreamConstraints);
}
