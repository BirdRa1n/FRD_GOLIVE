// Controla o picker de fontes de captura nativa como uma "modal" baseada em
// promessa: startScreenShareNative chama pickSource(...) e aguarda a escolha; a
// UI (SourcePicker) chama resolvePick(...) quando o usuário clica ou cancela.

import { streamStore } from "../state/streamStore";
import type { NativeSource } from "../types";

let resolver: ((source: NativeSource | null) => void) | null = null;

export function pickSource(sources: NativeSource[]): Promise<NativeSource | null> {
    // se já houver um picker aberto, cancela o anterior
    resolver?.(null);
    streamStore.setPicker(sources);
    return new Promise(resolve => {
        resolver = resolve;
    });
}

export function resolvePick(source: NativeSource | null): void {
    streamStore.setPicker(null);
    const r = resolver;
    resolver = null;
    r?.(source);
}
