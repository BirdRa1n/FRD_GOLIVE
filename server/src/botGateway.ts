
import { WebSocket } from "ws";

const { DISCORD_BOT_TOKEN = "", DISCORD_GATEWAY_URL = "" } = process.env;

const GATEWAY_URL = DISCORD_GATEWAY_URL || "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 0) | (1 << 2);
const MAX_BACKOFF_MS = 30_000;
const FATAL_CLOSES = new Set([4004, 4010, 4011]);
const VOICES_MAX = 5_000;

interface VoiceLoc { guildId: string; channelId: string; sessionId: string; userId: string; }

const log = (...a: unknown[]) => console.log("[botgw]", ...a);

const byUser = new Map<string, VoiceLoc>();   // userId → call atual (uma por pessoa)
const bySession = new Map<string, VoiceLoc>(); // session_id → a mesma (é a chave do IDENTIFY)
const guildNames = new Map<string, string>();
const members = new Map<string, MemberInfo>(); // `${guildId}:${userId}` → nome/avatar atuais

export interface MemberInfo { name?: string; avatar?: string; }
type VoiceListener = (userId: string, sessionId: string, loc: { guildId: string; channelId: string; } | undefined) => void;
const voiceListeners: VoiceListener[] = [];
const MEMBERS_MAX = 5_000;

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retries = 0;
let seq: number | null = null;
let acked = true;
let connected = false;
let started = false;
let lastError = "";

export function botGatewayState(): { connected: boolean; guilds: number; voices: number; error?: string; } {
    return { connected, guilds: guildNames.size, voices: byUser.size, error: lastError || undefined };
}

export function gatewayConnected(): boolean {
    return connected;
}

export function gatewayEnabled(): boolean {
    return started;
}

export function voiceLocation(userId: string, sessionId: string): { guildId: string; channelId: string; } | undefined {
    const bySess = sessionId ? bySession.get(sessionId) : undefined;
    if (bySess && bySess.userId === userId) return bySess;
    return byUser.get(userId);
}

/** Name (nick › global name › username) and avatar hash the gateway last saw for a member. */
export function memberInfo(guildId: string, userId: string): MemberInfo | undefined {
    return members.get(`${guildId}:${userId}`);
}

/** Avatar hash seen for this user in any guild (user avatars are global). */
export function userAvatarHash(userId: string): string | undefined {
    for (const [k, v] of members) if (k.endsWith(`:${userId}`) && v.avatar) return v.avatar;
    return undefined;
}

/** Called on every voice state change (join / move / leave) after the maps are updated. */
export function onVoiceStateChange(fn: VoiceListener): void {
    voiceListeners.push(fn);
}

function putMember(guildId: string, m: any): void {
    const u = m?.user;
    if (!guildId || !u?.id) return;
    const name = m.nick || u.global_name || u.username || undefined;
    if (members.size >= MEMBERS_MAX && !members.has(`${guildId}:${u.id}`)) members.clear();
    members.set(`${guildId}:${String(u.id)}`, { name, avatar: u.avatar ?? undefined });
}

export function startBotGateway(): void {
    if (!DISCORD_BOT_TOKEN || started) return;
    started = true;
    log(`conectando em ${GATEWAY_URL}`);
    connect();
}

function send(frame: Record<string, unknown>): void {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function connect(): void {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    let sock: WebSocket;
    try { sock = new WebSocket(GATEWAY_URL); } catch (e) { scheduleRetry(String(e)); return; }
    ws = sock;

    sock.on("error", e => { lastError = String(e?.message ?? e); });
    sock.on("message", data => onFrame(String(data)));
    sock.on("close", code => {
        stopHeartbeat();
        if (ws === sock) ws = null;
        connected = false;
        if (FATAL_CLOSES.has(code)) {
            lastError = `gateway recusou a conexão (close ${code})`;
            started = false; // não fica em loop com token/intent errado
            log(`${lastError} — verifique DISCORD_BOT_TOKEN`);
            return;
        }
        scheduleRetry(`close ${code}`);
    });
}

function scheduleRetry(reason: string): void {
    if (!started || retryTimer) return;
    retries++;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(retries, 5));
    lastError = reason;
    log(`reconectando em ${delay}ms (${reason})`);
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    retryTimer.unref();
}

function startHeartbeat(interval: number): void {
    stopHeartbeat();
    acked = false;
    send({ op: 1, d: seq });
    heartbeatTimer = setInterval(() => {
        if (!acked) {
            log("sem HEARTBEAT_ACK (zumbi) — reconectando");
            ws?.close(4008, "Zombie connection");
            return;
        }
        acked = false;
        send({ op: 1, d: seq });
    }, interval);
    heartbeatTimer.unref();
}

function stopHeartbeat(): void {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function onFrame(raw: string): void {
    let f: { op: number; d?: any; s?: number; t?: string; };
    try { f = JSON.parse(raw); } catch { return; }
    if (typeof f.s === "number") seq = f.s;
    switch (f.op) {
        case 10: // HELLO → identifica e começa o heartbeat (ordem canônica do gateway)
            startHeartbeat(Number(f.d?.heartbeat_interval) || 41_250);
            send({
                op: 2,
                d: {
                    token: DISCORD_BOT_TOKEN,
                    intents: INTENTS,
                    properties: { os: process.platform, browser: "frd-golive", device: "frd-golive" },
                },
            });
            break;
        case 11: acked = true; break;                    // HEARTBEAT_ACK
        case 0: dispatch(String(f.t ?? ""), f.d); break; // DISPATCH
        case 7: ws?.close(4000, "Reconnect requested"); break; // RECONNECT (volta por cima)
        case 9: ws?.close(4009, "Invalid session"); break;     // INVALID_SESSION → identify novo
        default: break;
    }
}

function dispatch(t: string, d: any): void {
    if (t === "READY") {
        connected = true;
        retries = 0;
        lastError = "";
        log(`conectado (sessão ${String(d?.session_id ?? "").slice(0, 8)}…)`);
        return;
    }
    if (t === "GUILD_CREATE") {
        if (d?.id) {
            if (d.name) guildNames.set(String(d.id), String(d.name));
            for (const mem of d.members ?? []) putMember(String(d.id), mem); // inclui quem está em voz
            for (const vs of d.voice_states ?? []) putVoiceState(vs, String(d.id)); // snapshot de quem já está em voz
        }
        return;
    }
    if (t === "GUILD_DELETE") {
        if (!d?.id) return;
        const gid = String(d.id);
        guildNames.delete(gid);
        for (const [u, loc] of byUser) if (loc.guildId === gid) { byUser.delete(u); bySession.delete(loc.sessionId); }
        return;
    }
    if (t === "GUILD_MEMBER_UPDATE") { putMember(String(d?.guild_id ?? ""), d); return; }
    if (t === "VOICE_STATE_UPDATE") {
        const gid = String(d?.guild_id ?? "");
        if (d?.member) putMember(gid, d.member);
        putVoiceState(d, gid);
        const userId = String(d?.user_id ?? "");
        const sessionId = String(d?.session_id ?? "");
        const loc = d?.channel_id && gid ? { guildId: gid, channelId: String(d.channel_id) } : undefined;
        for (const fn of voiceListeners) {
            try { fn(userId, sessionId, loc); } catch (e) { log("listener de voz falhou:", e); }
        }
    }
}

function putVoiceState(vs: any, guildIdFallback: string): void {
    const guildId = String(vs?.guild_id ?? guildIdFallback ?? "");
    const userId = String(vs?.user_id ?? "");
    const sessionId = String(vs?.session_id ?? "");
    const channelId = vs?.channel_id ? String(vs.channel_id) : "";
    if (!guildId || !userId) return;

    if (!channelId) { // saiu da call (ou mudou: a state nova vem logo em seguida)
        const cur = byUser.get(userId);
        if (cur && (!sessionId || cur.sessionId === sessionId)) {
            byUser.delete(userId);
            if (cur.sessionId) bySession.delete(cur.sessionId);
        }
        return;
    }

    const loc: VoiceLoc = { guildId, channelId, sessionId, userId };
    if (byUser.size >= VOICES_MAX && !byUser.has(userId)) byUser.clear(); // teto de segurança
    byUser.set(userId, loc);
    if (!sessionId) return;
    for (const [k, v] of bySession) if (v.userId === userId && k !== sessionId) bySession.delete(k);
    bySession.set(sessionId, loc);
}
