// Store reativo mínimo compartilhado entre o controller e o painel de UI.
// Puro (sem Discord/Vencord) — typecheckável isolado.

import type { RemoteStreamInfo } from "../rtc/session";

export type ConnectionStatus =
    | "idle" // fora de call / desligado
    | "connecting" // primeira conexão em andamento
    | "connected" // conectado ao servidor privado
    | "reconnecting" // caiu e está tentando religar
    | "error"; // falhou; ver errorMessage

type Listener = () => void;

class StreamStore {
    private readonly streams = new Map<string, RemoteStreamInfo>();
    private readonly listeners = new Set<Listener>();

    status: ConnectionStatus = "idle";
    errorMessage: string | null = null;
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

    /** Remove só os streams remotos (ex.: numa queda), preservando status. */
    clearStreams(): void {
        if (this.streams.size > 0) {
            this.streams.clear();
            this.emit();
        }
    }

    setStatus(status: ConnectionStatus): void {
        this.status = status;
        if (status !== "error") this.errorMessage = null;
        this.emit();
    }

    setError(message: string): void {
        this.status = "error";
        this.errorMessage = message;
        this.emit();
    }

    clearError(): void {
        if (this.errorMessage !== null) {
            this.errorMessage = null;
            this.emit();
        }
    }

    setSharing(value: boolean): void {
        this.sharing = value;
        this.emit();
    }

    reset(): void {
        this.streams.clear();
        this.status = "idle";
        this.errorMessage = null;
        this.sharing = false;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

export const streamStore = new StreamStore();
