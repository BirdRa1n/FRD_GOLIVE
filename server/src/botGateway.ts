// Gateway do bot (websocket) — fonte do CANAL REAL onde cada usuário está em voz.
//
// Por que existe: o IDENTIFY da mídia do Go Live NATIVO traz `server_id`/`channel_id`
// EFÊMEROS — criados quando a transmissão começa, não existem no Discord (a API
// responde 404 Unknown Guild/Channel) e mudam a cada sessão; servem para agrupar a
// mídia, mas não para dizer "está na Sala-01" nem aplicar habilitação/banimento por
// canal. REST não resolve (o Guild Member object não tem `voice` e /guilds/<id>/members
// exige intent), então a fonte é o próprio gateway do bot:
//   - GUILD_CREATE entrega o snapshot de quem já está em voz;
//   - VOICE_STATE_UPDATE mantém (saiu = channel_id null);
//   - o `session_id` deles é o MESMO que vem no IDENTIFY da mídia.
//
// Intents GUILDS (1<<0) + GUILD_VOICE_STATES (1<<2): não privilegiadas.
// `DISCORD_GATEWAY_URL` existe só para teste (aponta para um gateway falso local).

import { WebSocket } from "ws";

const { DISCORD_BOT_TOKEN = "", DISCORD_GATEWAY_URL = "" } = process.env;

const GATEWAY_URL = DISCORD_GATEWAY_URL || "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 0) | (1 << 2);
const MAX_BACKOFF_MS = 30_000;
/** Close codes que não valem retry (token/intents errados — retry só fica em loop). */
const FATAL_CLOSES = new Set([4004, 4010, 4011]);
const VOICES_MAX = 5_000;

interface VoiceLoc { guildId: string; channelId: string; sessionId: string; userId: string; }

const log = (...a: unknown[]) => console.log("[botgw]", ...a);

const byUser = new Map<string, VoiceLoc>();   // userId → call atual (uma por pessoa)
const bySession = new Map<string, VoiceLoc>(); // session_id → a mesma (é a chave do IDENTIFY)
const guildNames = new Map<string, string>();

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retries = 0;
let seq: number | null = null;
let acked = true;
let connected = false;
let started = false;
let lastError = "";

/** Estado para a dashboard/admin (evita dizer "bot ok" quando a voz está morta). */
export function botGatewayState(): { connected: boolean; guilds: number; voices: number; error?: string; } {
    return { connected, guilds: guildNames.size, voices: byUser.size, error: lastError || undefined };
}

export function gatewayConnected(): boolean {
    return connected;
}

/** Gateway configurado/lançado (pode estar conectando ou reconectando). */
export function gatewayEnabled(): boolean {
    return started;
}

/**
 * Onde a pessoa está de voz AGORA. O `sessionId` do IDENTIFY é a chave exata; sem ela
 * (ou sem match), cai no estado atual do usuário — no Discord só existe uma conexão de
 * voz por pessoa. `undefined` = não sei (bot fora do guild / gateway caído).
 */
export function voiceLocation(userId: string, sessionId: string): { guildId: string; channelId: string; } | undefined {
    const bySess = sessionId ? bySession.get(sessionId) : undefined;
    if (bySess && bySess.userId === userId) return bySess;
    return byUser.get(userId);
}

/** Liga o gateway (no boot, se houver token). No-op se já ligado ou sem token. */
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
    if (t === "VOICE_STATE_UPDATE") putVoiceState(d, String(d?.guild_id ?? ""));
}

/** Guarda/atualiza (ou remove, quando `channel_id` é null = saiu da call) uma localização. */
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
