// Toca o áudio de cada stream remoto num único elemento oculto por stream.
// Todos os <video> de exibição ficam MUTADOS; assim várias visualizações do
// mesmo stream (painel, teatro, tile nativo) não geram eco. O volume/mute que o
// espectador escolhe (streamStore) é aplicado aqui.

import { streamStore } from "./streamStore";

const sinks = new Map<string, HTMLAudioElement>();

export function syncAudioSinks(): void {
    const active = new Set(streamStore.getStreams().map(s => s.id));

    for (const [id, el] of [...sinks]) {
        if (!active.has(id)) {
            el.srcObject = null;
            el.remove();
            sinks.delete(id);
        }
    }

    for (const s of streamStore.getStreams()) {
        let el = sinks.get(s.id);
        if (!el) {
            el = document.createElement("audio");
            el.autoplay = true;
            el.style.display = "none";
            document.body.appendChild(el);
            sinks.set(s.id, el);
        }
        if (el.srcObject !== s.stream) el.srcObject = s.stream;
        const volume = streamStore.getVolume(s.id);
        if (el.volume !== volume) el.volume = volume;
        el.muted = streamStore.isMuted(s.id);
    }
}

export function clearAudioSinks(): void {
    for (const el of sinks.values()) {
        el.srcObject = null;
        el.remove();
    }
    sinks.clear();
}
