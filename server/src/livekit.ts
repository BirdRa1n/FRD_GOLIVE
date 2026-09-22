// Emissão de tokens do LiveKit (SFU). O acesso é gated pela habilitação no hub
// (store), não por segredo compartilhado. As quotas são aplicadas no cliente.

import { AccessToken } from "livekit-server-sdk";

const {
    LIVEKIT_API_KEY = "",
    LIVEKIT_API_SECRET = "",
    LIVEKIT_WS_URL = "", // URL WS do LiveKit que o cliente usa (ex.: wss://media.seu.com)
    TOKEN_TTL = "10m",
} = process.env;

export function livekitConfigured(): boolean {
    return Boolean(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_WS_URL);
}

export function livekitWsUrl(): string {
    return LIVEKIT_WS_URL;
}

/** Emite um token de sala para um usuário habilitado (identity = Discord user id). */
export async function createToken(room: string, identity: string, name: string): Promise<string> {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: TOKEN_TTL });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    return at.toJwt();
}
