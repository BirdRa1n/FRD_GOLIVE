// Híbrido (experimental): o Go Live NATIVO redirecionado dá o shell "AO VIVO" + o áudio
// E2EE (via DAVE), mas o encoder de vídeo nativo não produz frames pelo servidor privado
// (ver docs/GOLIVE-NATIVO.md). Então, quando o usuário inicia o Go Live nativo, publicamos
// a MESMA fonte no LiveKit (vídeo apenas); no lado de quem assiste, o `nativeTileInject`
// sobrepõe esse vídeo no tile nativo (o Erro 2012 é suprimido em nativeStreamRedirect).

import { FluxDispatcher } from "@webpack/common";

import { publishHybridVideo, stopHybridVideo } from "../rtc/controller";
import { settings } from "../settings";

let running = false;

function enabled(): boolean {
    return !!settings.store.nativeStreamHybrid && !!settings.store.nativeStreamEndpoint;
}

function onStreamStart(action: { sourceId?: string | null; }): void {
    if (!enabled() || !action.sourceId) return;
    console.log("[FRD GoLive] híbrido: Go Live nativo iniciou → publicando o vídeo no LiveKit:", action.sourceId);
    void publishHybridVideo(action.sourceId);
}

function onStreamStop(): void {
    if (!enabled()) return;
    void stopHybridVideo();
}

export function startHybrid(): void {
    if (running) return;
    running = true;
    FluxDispatcher.subscribe("STREAM_START", onStreamStart);
    FluxDispatcher.subscribe("STREAM_STOP", onStreamStop);
}

export function stopHybrid(): void {
    if (!running) return;
    running = false;
    FluxDispatcher.unsubscribe("STREAM_START", onStreamStart);
    FluxDispatcher.unsubscribe("STREAM_STOP", onStreamStop);
    void stopHybridVideo();
}
