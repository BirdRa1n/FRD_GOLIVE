// Lógica de sessão WebRTC contra o LiveKit privado.
//
// IMPORTANTE: este módulo depende APENAS de `livekit-client` e de tipos DOM.
// Nada de Discord/Vencord aqui — assim ele é testável/typecheckável isolado
// (ver ../../tsconfig.check.json).

import {
    ConnectionState,
    createLocalVideoTrack,
    LocalAudioTrack,
    type LocalTrack,
    LocalVideoTrack,
    type RemoteParticipant,
    type RemoteTrack,
    type RemoteTrackPublication,
    Room,
    RoomEvent,
    Track,
} from "livekit-client";

export interface RemoteStreamInfo {
    /** identity do participante na sala (usamos o user id do Discord). */
    id: string;
    /** nome de exibição. */
    name: string;
    /** MediaStream combinando as tracks (vídeo + áudio) daquele participante. */
    stream: MediaStream;
}

export interface RtcSessionCallbacks {
    onStreamAdded(info: RemoteStreamInfo): void;
    onStreamUpdated(info: RemoteStreamInfo): void;
    onStreamRemoved(id: string): void;
    onConnected?(): void;
    /** LiveKit perdeu a conexão e está tentando religar sozinho (queda transitória). */
    onReconnecting?(): void;
    /** LiveKit religou sozinho após uma queda transitória. */
    onReconnected?(): void;
    /** Conexão encerrada de vez (LiveKit desistiu ou desconexão explícita). */
    onDisconnected?(): void;
    /**
     * Um participante remoto COMEÇOU a publicar vídeo (tela/câmera) depois que já
     * estávamos na sala. Não dispara para quem já transmitia quando entramos.
     */
    onRemoteVideoStarted?(id: string, name: string): void;
    /** Um participante remoto parou de publicar vídeo. */
    onRemoteVideoStopped?(id: string, name: string): void;
    /** A publicação local terminou (botão, overlay do SO ou fim da captura). */
    onLocalSharingStopped?(): void;
}

export interface ScreenShareOptions {
    systemAudio: boolean;
    /** Altura máxima em px; 0 = resolução da fonte (sem limite). */
    maxHeight: number;
    fps: number;
}

/** Gerencia UMA sala do LiveKit (uma call de voz do Discord). */
export class RtcSession {
    private room: Room | null = null;
    private readonly streams = new Map<string, MediaStream>();
    private publishedTracks: LocalTrack[] = [];
    /** true durante disconnect(): suprime eventos de "parou" da limpeza. */
    private closing = false;

    constructor(private readonly cb: RtcSessionCallbacks) {}

    get isConnected(): boolean {
        return this.room?.state === ConnectionState.Connected;
    }

    get isPublishing(): boolean {
        return this.publishedTracks.length > 0;
    }

    async connect(serverUrl: string, token: string): Promise<void> {
        if (this.room) await this.disconnect();

        const room = new Room({
            // adaptiveStream OFF: como anexamos o stream manualmente (srcObject), o
            // LiveKit não observa o tamanho dos nossos <video> e escolheria uma
            // camada baixa. Desligado, o assinante recebe sempre a melhor qualidade.
            adaptiveStream: false,
            dynacast: true, // publisher só envia o que é consumido
            publishDefaults: {
                simulcast: true, // câmera: múltiplas camadas
            },
        });
        this.room = room;

        room
            .on(RoomEvent.TrackSubscribed, this.handleSubscribed)
            .on(RoomEvent.TrackUnsubscribed, this.handleUnsubscribed)
            .on(RoomEvent.TrackPublished, this.handlePublished)
            .on(RoomEvent.TrackUnpublished, this.handleUnpublished)
            .on(RoomEvent.ParticipantDisconnected, this.handleParticipantLeft)
            .on(RoomEvent.Reconnecting, this.handleReconnecting)
            .on(RoomEvent.Reconnected, this.handleReconnected)
            .on(RoomEvent.Disconnected, this.handleDisconnected);

        await room.connect(serverUrl, token);
        this.cb.onConnected?.();
    }

    async shareScreen(opts: ScreenShareOptions): Promise<void> {
        if (!this.room) throw new Error("Não conectado ao servidor privado.");

        // Usa getDisplayMedia (picker nativo do Discord). Ao compartilhar uma
        // JANELA, o áudio capturado é o DAQUELA janela — a call do Discord (outra
        // janela) NÃO entra, como no compartilhamento nativo. suppressLocalAudioPlayback
        // evita eco local do áudio capturado.
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: opts.maxHeight > 0
                ? { width: Math.round((opts.maxHeight * 16) / 9), height: opts.maxHeight, frameRate: opts.fps }
                : { frameRate: opts.fps },
            // restrictOwnAudio: pede ao navegador para tirar o áudio do próprio
            // app (a call) do som capturado, onde houver suporte.
            audio: opts.systemAudio
                ? ({ suppressLocalAudioPlayback: true, restrictOwnAudio: true } as MediaTrackConstraints)
                : false,
        });

        await this.publishScreenStream(stream, opts);
    }

    /**
     * Publica um MediaStream de tela (vídeo em alta + áudio) no LiveKit. Usado
     * tanto pelo getDisplayMedia quanto pela captura nativa (desktopCapturer).
     */
    async publishScreenStream(stream: MediaStream, opts: Pick<ScreenShareOptions, "maxHeight" | "fps">): Promise<void> {
        if (!this.room) throw new Error("Não conectado ao servidor privado.");

        const maxBitrate = opts.maxHeight === 0 || opts.maxHeight >= 1440 ? 8_000_000
            : opts.maxHeight >= 1080 ? 5_000_000
            : 2_500_000;

        for (const mediaTrack of stream.getTracks()) {
            if (mediaTrack.kind === "video") {
                // "detail" prioriza nitidez (texto/código) sobre fluidez.
                try { mediaTrack.contentHint = "detail"; } catch { /* ok */ }
                const track = new LocalVideoTrack(mediaTrack);
                await this.room.localParticipant.publishTrack(track, {
                    source: Track.Source.ScreenShare,
                    simulcast: false, // tela: uma única camada de alta qualidade
                    videoEncoding: { maxBitrate, maxFramerate: opts.fps },
                });
                this.publishedTracks.push(track);
            } else {
                const track = new LocalAudioTrack(mediaTrack);
                await this.room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShareAudio });
                this.publishedTracks.push(track);
            }
            mediaTrack.addEventListener("ended", () => void this.stopSharing());
        }
    }

    async shareCamera(): Promise<void> {
        if (!this.room) throw new Error("Não conectado ao servidor privado.");
        const track = await createLocalVideoTrack();
        await this.room.localParticipant.publishTrack(track);
        this.publishedTracks.push(track);
    }

    async stopSharing(): Promise<void> {
        if (await this.unpublishAll()) this.cb.onLocalSharingStopped?.();
    }

    /** Despublica tudo que é local. Retorna true se havia algo publicado. */
    private async unpublishAll(): Promise<boolean> {
        if (!this.room || this.publishedTracks.length === 0) return false;
        // Zera antes do await: os listeners de "ended" das outras tracks não
        // disparam um segundo stop enquanto este ainda está em andamento.
        const tracks = this.publishedTracks;
        this.publishedTracks = [];
        for (const track of tracks) {
            await this.room.localParticipant.unpublishTrack(track, true);
        }
        return true;
    }

    async disconnect(): Promise<void> {
        this.closing = true;
        try {
            await this.unpublishAll();
            if (this.room) {
                await this.room.disconnect();
                this.room = null;
            }
            this.streams.clear();
        } finally {
            this.closing = false;
        }
    }

    private readonly handleSubscribed = (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant,
    ): void => {
        if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) return;

        const id = participant.identity;
        let stream = this.streams.get(id);
        const isNew = stream === undefined;
        if (!stream) {
            stream = new MediaStream();
            this.streams.set(id, stream);
        }
        stream.addTrack(track.mediaStreamTrack);

        const info: RemoteStreamInfo = { id, name: participant.name || id, stream };
        if (isNew) this.cb.onStreamAdded(info);
        else this.cb.onStreamUpdated(info);
    };

    private readonly handleUnsubscribed = (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant,
    ): void => {
        const id = participant.identity;
        const stream = this.streams.get(id);
        if (!stream) return;

        stream.removeTrack(track.mediaStreamTrack);
        if (stream.getTracks().length === 0) {
            this.streams.delete(id);
            this.cb.onStreamRemoved(id);
        } else {
            this.cb.onStreamUpdated({ id, name: participant.name || id, stream });
        }
    };

    private readonly handlePublished = (pub: RemoteTrackPublication, participant: RemoteParticipant): void => {
        if (pub.kind !== Track.Kind.Video) return;
        this.cb.onRemoteVideoStarted?.(participant.identity, participant.name || participant.identity);
    };

    private readonly handleUnpublished = (pub: RemoteTrackPublication, participant: RemoteParticipant): void => {
        // Na nossa própria saída o LiveKit despublica todo mundo — não é "parou".
        if (this.closing || this.room?.state !== ConnectionState.Connected) return;
        if (pub.kind !== Track.Kind.Video) return;
        this.cb.onRemoteVideoStopped?.(participant.identity, participant.name || participant.identity);
    };

    private readonly handleParticipantLeft = (participant: RemoteParticipant): void => {
        if (this.streams.delete(participant.identity)) {
            this.cb.onStreamRemoved(participant.identity);
        }
    };

    private readonly handleReconnecting = (): void => {
        this.cb.onReconnecting?.();
    };

    private readonly handleReconnected = (): void => {
        this.cb.onReconnected?.();
    };

    private readonly handleDisconnected = (): void => {
        this.streams.clear();
        this.cb.onDisconnected?.();
    };
}
