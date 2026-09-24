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
    // Host (sem esquema) do WS de controle do Go Live nativo — o Discord prefixa wss://.
    // Ex.: "golivefrd.SEU.com/dstream". O plugin redireciona o Go Live nativo para cá.
    nativeStreamEndpoint: string;
    // IP/host público por onde a mídia (UDP) entra — informativo (instalador/diagnóstico).
    mediaHost: string;
    version: string;
    transport: "native"; // Go Live nativo do Discord, redirecionado para o servidor privado
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
