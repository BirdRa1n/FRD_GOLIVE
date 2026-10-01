
export interface User {
    id: string; // = user id do Discord
    name: string;
    enabled: boolean; // o admin liberou?
    maxHeight: number; // quota de resolução (px de altura)
    maxFps: number; // quota de FPS
    requestedAt: number;
    enabledAt?: number;
}

export interface ClientConfig {
    nativeStreamEndpoint: string;
    mediaHost: string;
    version: string;
    transport: "native"; // Go Live nativo do Discord, redirecionado para o servidor privado
    authMode: AuthMode;
    oauth: boolean;
}

export interface RTCIceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}

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

export type AuthMode = "login" | "channels";

export interface ServerSettings {
    authMode: AuthMode;
}

export interface ChannelCfg {
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
    enabled: boolean;
    addedAt: number;
    bans: string[];
    seen: SeenMember[];
}

export interface SeenMember {
    userId: string;
    name?: string;
    lastSeen: number;
}

export interface LiveRoom {
    roomId: string;
    guildId?: string;
    guildName?: string;
    guildIcon?: string;
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
    avatar?: string;
    streamer: boolean;
    since?: number;
    channelId?: string;
    channelName?: string;
    guildId?: string;
}

export interface Group {
    guildId: string;
    guildName?: string;
    guildIcon?: string;
    botPresent: boolean;
    channels: GroupChannel[];
}

export interface GroupChannel {
    channelId: string;
    channelName: string;
    enabled: boolean;
    bans: string[];
    seen: SeenMember[];
    liveMembers: LiveMember[];
    streamers: number;
    viewers: number;
}

export interface PublicGroup {
    guildId: string;
    guildName: string;
    icon?: string;
}
