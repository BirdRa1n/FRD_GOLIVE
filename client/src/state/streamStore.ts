// Store reativo mínimo compartilhado entre o controller e o painel de UI.
// Puro (sem Discord/Vencord) — typecheckável isolado.

import type { RemoteStreamInfo } from "../rtc/session";
import type { NativeSource } from "../types";

export type ConnectionStatus =
    | "idle" // fora de call / desligado
    | "connecting" // primeira conexão em andamento
    | "connected" // conectado ao servidor privado
    | "reconnecting" // caiu e está tentando religar
    | "error"; // falhou; ver errorMessage

/** O que o usuário local está transmitindo agora (null = nada). */
export type SharingKind = "screen" | "camera" | null;

type Listener = () => void;

class StreamStore {
    private readonly streams = new Map<string, RemoteStreamInfo>();
    private readonly listeners = new Set<Listener>();
    /**
     * Volume (0..1) e mute escolhidos por quem ASSISTE, por usuário (id). Ficam
     * fora de reset(): valem pela sessão toda, mesmo se a pessoa parar e voltar.
     */
    private readonly volumes = new Map<string, number>();
    private readonly muted = new Set<string>();

    status: ConnectionStatus = "idle";
    errorMessage: string | null = null;
    sharingKind: SharingKind = null;
    /** Fontes a escolher no picker de captura nativa (null = picker fechado). */
    pickerSources: NativeSource[] | null = null;
    /** Stream em foco no modo teatro (null = teatro fechado). */
    focusedId: string | null = null;

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
        if (this.streams.delete(id)) {
            if (this.focusedId === id) this.focusedId = null;
            this.emit();
        }
    }

    getVolume(id: string): number {
        return this.volumes.get(id) ?? 1;
    }

    isMuted(id: string): boolean {
        return this.muted.has(id);
    }

    setVolume(id: string, volume: number): void {
        const v = Math.min(1, Math.max(0, volume));
        this.volumes.set(id, v);
        // Subir o volume desfaz o mute (comportamento do Discord).
        if (v > 0) this.muted.delete(id);
        this.emit();
    }

    toggleMute(id: string): void {
        if (this.muted.has(id)) {
            this.muted.delete(id);
            // Desmutar com volume 0 não faria nada — volta pra um nível audível.
            if (this.getVolume(id) === 0) this.volumes.set(id, 0.5);
        } else {
            this.muted.add(id);
        }
        this.emit();
    }

    setFocused(id: string | null): void {
        this.focusedId = id;
        this.emit();
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

    setSharing(kind: SharingKind): void {
        this.sharingKind = kind;
        this.emit();
    }

    setPicker(sources: NativeSource[] | null): void {
        this.pickerSources = sources;
        this.emit();
    }

    reset(): void {
        this.streams.clear();
        this.status = "idle";
        this.errorMessage = null;
        this.sharingKind = null;
        this.pickerSources = null;
        this.focusedId = null;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

export const streamStore = new StreamStore();
