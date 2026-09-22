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
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
    });

    return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
    }));
}
