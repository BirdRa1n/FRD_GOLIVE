// Store reativo mínimo compartilhado entre o controller e o painel de UI.
// Puro (sem Discord/Vencord) — typecheckável isolado.

import type { RemoteStreamInfo } from "../rtc/session";

type Listener = () => void;

class StreamStore {
    private readonly streams = new Map<string, RemoteStreamInfo>();
    private readonly listeners = new Set<Listener>();

    connected = false;
    sharing = false;

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getStreams(): RemoteStreamInfo[] {
        return [...this.streams.values()];
    }

    upsert(info: RemoteStreamInfo): void {
        this.streams.set(info.id, info);
        this.emit();
    }

    remove(id: string): void {
        if (this.streams.delete(id)) this.emit();
    }

    setConnected(value: boolean): void {
        this.connected = value;
        this.emit();
    }

    setSharing(value: boolean): void {
        this.sharing = value;
        this.emit();
    }

    reset(): void {
        this.streams.clear();
        this.connected = false;
        this.sharing = false;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

export const streamStore = new StreamStore();
