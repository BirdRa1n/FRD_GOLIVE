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

// --- Bot / canais / habilitação por canal ---

/** Como o servidor decide quem pode transmitir. */
export type AuthMode = "login" | "channels";

export interface ServerSettings {
    /** "login" = OAuth + habilitação manual; "channels" = canais habilitados pelo bot. */
    authMode: AuthMode;
}

/** Um canal de voz de um servidor do Discord, configurado pelo admin (modo channels). */
export interface ChannelCfg {
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
    enabled: boolean;
    addedAt: number;
    /** userIds banidos de transmitir NESTE canal (blocklist). */
    bans: string[];
    /** membros vistos transmitindo/assistindo aqui (para o admin agir sem digitar id). */
    seen: SeenMember[];
}

export interface SeenMember {
    userId: string;
    name?: string;
    lastSeen: number;
}

/** Estado ao vivo de uma sala de mídia (nativeStream) para a dashboard. */
export interface LiveRoom {
    /** server_id do IDENTIFY — id efêmero da sessão de mídia (só p/ debug). */
    roomId: string;
    /** guild REAL de onde vêm as pessoas (do gateway do bot), quando conhecida. */
    guildId?: string;
    guildName?: string;
    /** Rótulo da tela: o canal real (ex.: "Sala-01"), quando conhecido. */
    label?: string;
    channelId?: string;
    channelName?: string;
    members: LiveMember[];
    streamers: number;
    viewers: number;
}

export interface LiveMember {
    userId: string;
    name?: string;
    streamer: boolean;
    /** Quando começou a transmitir (ms). */
    since?: number;
    channelId?: string;
    channelName?: string;
    guildId?: string;
}
