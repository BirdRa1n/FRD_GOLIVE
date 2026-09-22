// Cliente de signaling (WebSocket) do transporte mesh v2.
// Depende só de DOM (WebSocket) — typecheckável isolado.

export interface PeerInfo {
    id: string;
    name: string;
}

export interface Policy {
    enabled: boolean;
    maxHeight: number;
    maxFps: number;
}

export interface SignalPayload {
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

type ServerMessage =
    | { type: "joined"; policy: Policy; }
    | { type: "denied"; reason: string; }
    | { type: "peers"; peers: PeerInfo[]; }
    | { type: "peer-joined"; id: string; name: string; }
    | { type: "peer-left"; id: string; }
    | { type: "signal"; from: string; data: SignalPayload; }
    | { type: "policy"; policy: Policy; };

export interface SignalingHandlers {
    onJoined(policy: Policy): void;
    onPeers(peers: PeerInfo[]): void;
    onPeerJoined(id: string, name: string): void;
    onPeerLeft(id: string): void;
    onSignal(from: string, data: SignalPayload): void;
    onPolicy(policy: Policy): void;
    onClose(): void;
}

export class SignalingClient {
    private ws: WebSocket | null = null;

    constructor(private readonly h: SignalingHandlers) {}

    /** Envia só quando o socket está OPEN — evita InvalidStateError em CONNECTING/CLOSING. */
    private send(obj: unknown): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    connect(url: string, room: string, id: string, name: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            this.ws = ws;
            ws.onopen = () => {
                this.send({ type: "join", room, id, name });
                resolve();
            };
            ws.onerror = () => reject(new Error("erro no WebSocket de signaling"));
            ws.onclose = () => this.h.onClose();
            ws.onmessage = ev => {
                let msg: ServerMessage;
                try { msg = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
                this.dispatch(msg);
            };
        });
    }

    private dispatch(msg: ServerMessage): void {
        switch (msg.type) {
            case "joined": this.h.onJoined(msg.policy); break;
            case "peers": this.h.onPeers(msg.peers); break;
            case "peer-joined": this.h.onPeerJoined(msg.id, msg.name); break;
            case "peer-left": this.h.onPeerLeft(msg.id); break;
            case "signal": this.h.onSignal(msg.from, msg.data); break;
            case "policy": this.h.onPolicy(msg.policy); break;
            case "denied": this.h.onClose(); break;
        }
    }

    signal(to: string, data: SignalPayload): void {
        this.send({ type: "signal", to, data });
    }

    setState(sharing: boolean, kind?: "screen" | "camera"): void {
        this.send({ type: "state", sharing, kind });
    }

    close(): void {
        this.ws?.close();
        this.ws = null;
    }
}
