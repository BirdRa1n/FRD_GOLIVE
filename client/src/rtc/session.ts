// Lógica de sessão WebRTC contra o LiveKit privado.
//
// IMPORTANTE: este módulo depende APENAS de `livekit-client` e de tipos DOM.
// Nada de Discord/Vencord aqui — assim ele é testável/typecheckável isolado
// (ver ../../tsconfig.check.json).

import {
    ConnectionState,
    createLocalScreenTracks,
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
}

export interface ScreenShareOptions {
    systemAudio: boolean;
    maxHeight: number;
    fps: number;
}

/** Gerencia UMA sala do LiveKit (uma call de voz do Discord). */
export class RtcSession {
    private room: Room | null = null;
    private readonly streams = new Map<string, MediaStream>();
    private publishedTracks: LocalTrack[] = [];

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
            .on(RoomEvent.ParticipantDisconnected, this.handleParticipantLeft)
            .on(RoomEvent.Reconnecting, this.handleReconnecting)
            .on(RoomEvent.Reconnected, this.handleReconnected)
            .on(RoomEvent.Disconnected, this.handleDisconnected);

        await room.connect(serverUrl, token);
        this.cb.onConnected?.();
    }

    async shareScreen(opts: ScreenShareOptions): Promise<void> {
        if (!this.room) throw new Error("Não conectado ao servidor privado.");

        const tracks = await createLocalScreenTracks({
            audio: opts.systemAudio,
            resolution: {
                width: Math.round((opts.maxHeight * 16) / 9),
                height: opts.maxHeight,
                frameRate: opts.fps,
            },
        });

        // bitrate alvo em função da resolução (nitidez para tela/texto).
        const maxBitrate = opts.maxHeight >= 1440 ? 8_000_000
            : opts.maxHeight >= 1080 ? 5_000_000
            : 2_500_000;

        for (const track of tracks) {
            if (track.kind === Track.Kind.Video) {
                // "detail" prioriza nitidez (texto/código) sobre fluidez.
                try { track.mediaStreamTrack.contentHint = "detail"; } catch { /* ok */ }
                await this.room.localParticipant.publishTrack(track, {
                    simulcast: false, // tela: uma única camada de alta qualidade
                    videoEncoding: { maxBitrate, maxFramerate: opts.fps },
                });
            } else {
                await this.room.localParticipant.publishTrack(track);
            }
            this.publishedTracks.push(track);
        }
    }

    async shareCamera(): Promise<void> {
        if (!this.room) throw new Error("Não conectado ao servidor privado.");
        const track = await createLocalVideoTrack();
        await this.room.localParticipant.publishTrack(track);
        this.publishedTracks.push(track);
    }

    /**
     * Publica tracks de um MediaStream já capturado (ex.: via desktopCapturer do
     * Electron, contornando o getDisplayMedia do Discord em regiões censuradas).
     */
    async publishMediaStream(stream: MediaStream): Promise<void> {
        if (!this.room) throw new Error("Não conectado ao servidor privado.");
        for (const mediaTrack of stream.getTracks()) {
            const track =
                mediaTrack.kind === "audio"
                    ? new LocalAudioTrack(mediaTrack)
                    : new LocalVideoTrack(mediaTrack);
            await this.room.localParticipant.publishTrack(track);
            this.publishedTracks.push(track);
            // Se o usuário parar a captura pelo overlay do SO, encerra a publicação.
            mediaTrack.addEventListener("ended", () => void this.stopSharing());
        }
    }

    async stopSharing(): Promise<void> {
        if (!this.room) return;
        for (const track of this.publishedTracks) {
            await this.room.localParticipant.unpublishTrack(track, true);
        }
        this.publishedTracks = [];
    }

    async disconnect(): Promise<void> {
        await this.stopSharing();
        if (this.room) {
            await this.room.disconnect();
            this.room = null;
        }
        this.streams.clear();
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
