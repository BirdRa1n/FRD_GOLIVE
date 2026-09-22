// Módulo NATIVO do plugin — roda no processo main do Electron (Vencord expõe as
// funções exportadas aqui via VencordNative.pluginHelpers.FRDGoLive).
//
// Usa o desktopCapturer do Electron diretamente, contornando o getDisplayMedia do
// Discord. É o que permite compartilhar tela mesmo onde o Discord desativa a
// opção por região.

import { desktopCapturer, type IpcMainInvokeEvent } from "electron";

import type { NativeSource } from "./types";

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
