// Tipos compartilhados do servidor v2.

export interface User {
    id: string; // = user id do Discord
    name: string;
    enabled: boolean; // o admin liberou?
    maxHeight: number; // quota de resolução (px de altura)
    maxFps: number; // quota de FPS
    requestedAt: number;
    enabledAt?: number;
}

/** Config que o cliente recebe do host (GET /config). */
export interface ClientConfig {
    signalingUrl: string; // wss://.../signaling
    iceServers: RTCIceServerConfig[];
    version: string;
    transport: "mesh"; // v2 = mesh
}

export interface RTCIceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}

// --- Mensagens de signaling (cliente <-> servidor) ---

export type ClientMessage =
    | { type: "join"; room: string; id: string; name: string; token?: string; }
    | { type: "signal"; to: string; data: unknown; }
    | { type: "state"; sharing: boolean; kind?: "screen" | "camera"; };

export type ServerMessage =
    | { type: "joined"; policy: Policy; }
    | { type: "denied"; reason: string; }
    | { type: "peers"; peers: PeerInfo[]; }
    | { type: "peer-joined"; id: string; name: string; }
    | { type: "peer-left"; id: string; }
    | { type: "signal"; from: string; data: unknown; }
    | { type: "policy"; policy: Policy; }; // push quando o admin habilita/muda quota

export interface PeerInfo {
    id: string;
    name: string;
}

export interface Policy {
    enabled: boolean;
    maxHeight: number;
    maxFps: number;
}

export interface ActiveTransmission {
    userId: string;
    name: string;
    room: string;
    kind: "screen" | "camera";
    since: number;
}
