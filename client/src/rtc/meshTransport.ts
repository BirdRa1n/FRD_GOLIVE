// Transporte P2P/mesh: uma RTCPeerConnection por peer, com "perfect negotiation".
// A mídia vai cliente↔cliente (não passa pelo servidor) — só o signaling é central.
// Depende de DOM (RTCPeerConnection, MediaStream) + signalingClient — typecheckável.

import type { RemoteStreamInfo, RtcSessionCallbacks, ScreenShareOptions } from "./session";
import { type PeerInfo, type Policy, SignalingClient, type SignalPayload } from "./signalingClient";

interface Peer {
    pc: RTCPeerConnection;
    name: string;
    polite: boolean;
    makingOffer: boolean;
    ignoreOffer: boolean;
    stream: MediaStream;
}

export interface MeshCallbacks extends RtcSessionCallbacks {
    onPolicy?(policy: Policy): void;
}

export class MeshTransport {
    private readonly signaling: SignalingClient;
    private readonly peers = new Map<string, Peer>();
    private localTracks: MediaStreamTrack[] = [];
    private selfId = "";
    private iceServers: RTCIceServer[] = [];
    private connected = false;
    policy: Policy = { enabled: false, maxHeight: 0, maxFps: 0 };

    constructor(private readonly cb: MeshCallbacks) {
        this.signaling = new SignalingClient({
            onJoined: p => { this.policy = p; this.cb.onPolicy?.(p); this.cb.onConnected?.(); },
            onPeers: peers => peers.forEach(pi => this.addPeer(pi)),
            onPeerJoined: (id, name) => this.addPeer({ id, name }),
            onPeerLeft: id => this.removePeer(id),
            onSignal: (from, data) => void this.onSignal(from, data),
            onPolicy: p => { this.policy = p; this.cb.onPolicy?.(p); },
            onClose: () => { this.connected = false; this.cb.onDisconnected?.(); },
        });
    }

    get isConnected(): boolean { return this.connected; }
    get isPublishing(): boolean { return this.localTracks.length > 0; }

    async connect(signalingUrl: string, room: string, id: string, name: string, iceServers: RTCIceServer[]): Promise<void> {
        this.selfId = id;
        this.iceServers = iceServers;
        await this.signaling.connect(signalingUrl, room, id, name);
        this.connected = true;
    }

    private addPeer(info: PeerInfo): void {
        if (this.peers.has(info.id) || info.id === this.selfId) return;

        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        const peer: Peer = {
            pc,
            name: info.name,
            polite: this.selfId < info.id, // determinístico: id menor é "polite"
            makingOffer: false,
            ignoreOffer: false,
            stream: new MediaStream(),
        };
        this.peers.set(info.id, peer);

        for (const track of this.localTracks) pc.addTrack(track);

        pc.onnegotiationneeded = async () => {
            try {
                peer.makingOffer = true;
                await pc.setLocalDescription();
                this.signaling.signal(info.id, { description: pc.localDescription ?? undefined });
            } catch (e) {
                console.error("[mesh] negotiationneeded", e);
            } finally {
                peer.makingOffer = false;
            }
        };
        pc.onicecandidate = ({ candidate }) => {
            if (candidate) this.signaling.signal(info.id, { candidate: candidate.toJSON() });
        };
        pc.ontrack = ({ track }) => {
            peer.stream.addTrack(track);
            const streamInfo: RemoteStreamInfo = { id: info.id, name: peer.name, stream: peer.stream };
            this.cb.onStreamAdded(streamInfo);
            this.cb.onStreamUpdated(streamInfo);
            track.addEventListener("ended", () => {
                peer.stream.removeTrack(track);
                if (peer.stream.getTracks().length === 0) this.cb.onStreamRemoved(info.id);
            });
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") this.removePeer(info.id);
        };
    }

    private async onSignal(from: string, data: SignalPayload): Promise<void> {
        const peer = this.peers.get(from);
        if (!peer) return;
        try {
            if (data.description) {
                const offerCollision = data.description.type === "offer"
                    && (peer.makingOffer || peer.pc.signalingState !== "stable");
                peer.ignoreOffer = !peer.polite && offerCollision;
                if (peer.ignoreOffer) return;
                await peer.pc.setRemoteDescription(data.description);
                if (data.description.type === "offer") {
                    await peer.pc.setLocalDescription();
                    this.signaling.signal(from, { description: peer.pc.localDescription ?? undefined });
                }
            } else if (data.candidate) {
                try { await peer.pc.addIceCandidate(data.candidate); }
                catch (e) { if (!peer.ignoreOffer) throw e; }
            }
        } catch (e) {
            console.error("[mesh] onSignal", e);
        }
    }

    private removePeer(id: string): void {
        const peer = this.peers.get(id);
        if (!peer) return;
        try { peer.pc.close(); } catch { /* ok */ }
        this.peers.delete(id);
        this.cb.onStreamRemoved(id);
    }

    // --- publicação (respeitando a quota da policy) ---

    private clamp(opts: ScreenShareOptions): ScreenShareOptions {
        const maxHeight = this.policy.maxHeight > 0 ? Math.min(opts.maxHeight, this.policy.maxHeight) : opts.maxHeight;
        const fps = this.policy.maxFps > 0 ? Math.min(opts.fps, this.policy.maxFps) : opts.fps;
        return { ...opts, maxHeight, fps };
    }

    private addLocalTrack(track: MediaStreamTrack): void {
        this.localTracks.push(track);
        for (const peer of this.peers.values()) peer.pc.addTrack(track);
        track.addEventListener("ended", () => void this.stopSharing());
    }

    async publishMediaStream(stream: MediaStream): Promise<void> {
        for (const track of stream.getTracks()) this.addLocalTrack(track);
    }

    async shareScreen(opts: ScreenShareOptions): Promise<void> {
        const o = this.clamp(opts);
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: Math.round((o.maxHeight * 16) / 9), height: o.maxHeight, frameRate: o.fps },
            audio: o.systemAudio ? ({ suppressLocalAudioPlayback: true } as MediaTrackConstraints) : false,
        });
        for (const t of stream.getVideoTracks()) {
            try { t.contentHint = "detail"; } catch { /* ok */ }
        }
        await this.publishMediaStream(stream);
        this.signaling.setState(true, "screen");
    }

    async shareCamera(): Promise<void> {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        await this.publishMediaStream(stream);
        this.signaling.setState(true, "camera");
    }

    async stopSharing(): Promise<void> {
        for (const track of this.localTracks) {
            for (const peer of this.peers.values()) {
                const sender = peer.pc.getSenders().find(s => s.track === track);
                if (sender) peer.pc.removeTrack(sender);
            }
            track.stop();
        }
        this.localTracks = [];
        this.signaling.setState(false);
    }

    async disconnect(): Promise<void> {
        await this.stopSharing();
        for (const peer of this.peers.values()) {
            try { peer.pc.close(); } catch { /* ok */ }
        }
        this.peers.clear();
        this.signaling.close();
        this.connected = false;
    }
}
