// Store reativo mínimo compartilhado entre o controller e o painel de UI.
// Puro (sem Discord/Vencord) — typecheckável isolado.

import type { RemoteStreamInfo } from "../rtc/session";

export type ConnectionStatus =
    | "idle" // fora de call / desligado
    | "connecting" // primeira conexão em andamento
    | "connected" // conectado ao servidor privado
    | "reconnecting" // caiu e está tentando religar
    | "error"; // falhou; ver errorMessage

/** O que o usuário local está transmitindo agora (null = nada). */
export type SharingKind = "screen" | "camera" | null;

type Listener = () => void;

/**
 * Preferências de quem ASSISTE sobre a transmissão de um usuário (como o menu de
 * botão direito do Discord). Persistidas nas settings do plugin pelo index.tsx.
 */
export interface StreamPrefs {
    /** 0..1 (padrão 1). */
    volume?: number;
    /** Áudio da transmissão silenciado. */
    muted?: boolean;
    /** Não tocar o som de início/fim quando ESTE usuário transmitir. */
    soundsMuted?: boolean;
}

class StreamStore {
    private readonly streams = new Map<string, RemoteStreamInfo>();
    private readonly listeners = new Set<Listener>();
    /** Preferências por usuário (id). Ficam fora de reset(): valem entre calls. */
    private prefs: Record<string, StreamPrefs> = {};
    private readonly prefListeners = new Set<Listener>();

    status: ConnectionStatus = "idle";
    errorMessage: string | null = null;
    sharingKind: SharingKind = null;
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

    getStream(id: string): RemoteStreamInfo | undefined {
        return this.streams.get(id);
    }

    // --- preferências por usuário ------------------------------------------

    getVolume(id: string): number {
        return this.prefs[id]?.volume ?? 1;
    }

    isMuted(id: string): boolean {
        return this.prefs[id]?.muted === true;
    }

    isSoundMuted(id: string): boolean {
        return this.prefs[id]?.soundsMuted === true;
    }

    setVolume(id: string, volume: number): void {
        const v = Math.min(1, Math.max(0, volume));
        // Subir o volume desfaz o mute (comportamento do Discord).
        this.patchPrefs(id, v > 0 ? { volume: v, muted: false } : { volume: v });
    }

    toggleMute(id: string): void {
        const muted = !this.isMuted(id);
        // Desmutar com volume 0 não faria nada — volta pra um nível audível.
        this.patchPrefs(id, !muted && this.getVolume(id) === 0 ? { muted, volume: 0.5 } : { muted });
    }

    toggleSoundMute(id: string): void {
        this.patchPrefs(id, { soundsMuted: !this.isSoundMuted(id) });
    }

    /** Carrega as preferências salvas (sem notificar os ouvintes de prefs). */
    hydratePrefs(saved: Record<string, StreamPrefs> | null | undefined): void {
        this.prefs = saved && typeof saved === "object" ? { ...saved } : {};
        this.emit();
    }

    exportPrefs(): Record<string, StreamPrefs> {
        return { ...this.prefs };
    }

    /** Ouvinte só de mudanças de preferência (para persistir). */
    subscribePrefs(listener: Listener): () => void {
        this.prefListeners.add(listener);
        return () => {
            this.prefListeners.delete(listener);
        };
    }

    private patchPrefs(id: string, patch: StreamPrefs): void {
        const next: StreamPrefs = { ...this.prefs[id], ...patch };
        // Remove chaves no valor padrão para o JSON salvo continuar pequeno.
        if (next.volume === 1) delete next.volume;
        if (!next.muted) delete next.muted;
        if (!next.soundsMuted) delete next.soundsMuted;
        if (Object.keys(next).length) this.prefs[id] = next;
        else delete this.prefs[id];
        for (const l of this.prefListeners) l();
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

    reset(): void {
        this.streams.clear();
        this.status = "idle";
        this.errorMessage = null;
        this.sharingKind = null;
        this.focusedId = null;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

export const streamStore = new StreamStore();
