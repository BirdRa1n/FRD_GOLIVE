import { createServer } from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";

import { botGatewayState, memberInfo, startBotGateway, userAvatarHash } from "./botGateway.js";
import { clientLogsEnabled, ingest, listUsers, readDay, removeAll, removeUser, seedLogCounts, startClientLogSweeper } from "./clientLogs.js";
import * as discord from "./discord.js";
import { adminPage, errorPage, homePage, loginPage } from "./hub.js";
import { cachedImage } from "./imageCache.js";
import { closeMembersInChannel, getLiveState, handleNativeStreamUpgrade, NATIVE_STREAM_PATH, nativeStreamEnabled, nativeStreamPublicIp, startNativeStreamUdp } from "./nativeStream.js";
import { COOKIE_NAME, parseCookies, type Session, sign, verify } from "./session.js";
import { store } from "./store.js";
import { getStats } from "./stats.js";
import type { ActiveTransmission, AuthMode, ClientConfig, Group, GroupChannel, LiveMember, LiveRoom, PublicGroup } from "./types.js";

const ADMIN_IDS = (process.env.ADMIN_DISCORD_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);

function getSession(req: express.Request): Session | null {
    return verify(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}
function isAdmin(s: Session | null): boolean {
    return !!s && ADMIN_IDS.includes(s.id);
}
function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
    const secure = req.headers["x-forwarded-proto"] === "https" || req.secure;
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}${secure ? "; Secure" : ""}`);
}

const {
    PORT = "8090",
    ADMIN_TOKEN = "",
    PUBLIC_SIGNALING_URL = "", // ex.: wss://signaling.seu.com
    VERSION = "2.0.8",
} = process.env;

if (!ADMIN_TOKEN) console.warn("[v2] ADMIN_TOKEN vazio — endpoints de admin desprotegidos!");

const app = express();

// Antes do parser global (32kb). Vem do processo main do mod, por isso não depende de CORS.
app.post("/logs/ingest", express.json({ limit: "4mb" }), async (req, res) => {
    // 410 faz o cliente descartar o lote: o que chega durante a pausa não é gravado depois.
    if (!clientLogsEnabled || store.getSettings().clientLogsPaused) return res.status(410).json({ error: "logs desativados neste servidor" });
    try {
        const r = await ingest(req.body);
        res.status(r.status).json(r.error ? { error: r.error } : { stored: r.stored });
    } catch (e) {
        console.warn("[client-logs] falha ao gravar:", (e as Error).message);
        res.status(500).json({ error: "falha ao gravar" });
    }
});

app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
app.use("/ui", express.static(`${PUBLIC_DIR}/ui`, { maxAge: "1h" }));

app.get("/health", (_req, res) => res.json({ ok: true, version: VERSION, transport: "native" }));

app.get("/config", (req, res) => {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const cfg: ClientConfig = {
        nativeStreamEndpoint: nativeStreamEnabled() ? `${host}${NATIVE_STREAM_PATH}` : "",
        mediaHost: nativeStreamPublicIp(),
        version: VERSION,
        transport: "native",
        authMode: store.getSettings().authMode,
        oauth: discord.oauthConfigured(),
    };
    res.json(cfg);
});

app.get("/img/guild/:id", async (req, res) => {
    const buf = await cachedImage(discord.guildIconUrl(req.params.id, await discord.guildIcon(req.params.id)));
    if (!buf) return res.sendStatus(404);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(buf);
});

app.get("/groups", async (req, res) => {
    if (store.getSettings().authMode === "login") return res.json([]);
    const host = req.headers.host ?? `localhost:${PORT}`;
    const proto = req.headers["x-forwarded-proto"] === "https" || req.secure ? "https" : "http";
    const byGuild = new Map<string, PublicGroup>();
    for (const c of store.listChannels()) {
        if (!c.enabled || byGuild.has(c.guildId)) continue;
        byGuild.set(c.guildId, {
            guildId: c.guildId,
            guildName: c.guildName || c.guildId,
            icon: `${proto}://${host}/img/guild/${c.guildId}`,
        });
    }
    res.json([...byGuild.values()]);
});

app.post("/auth/request-access", (req, res) => {
    const { userId, name } = req.body ?? {};
    if (typeof userId !== "string" || typeof name !== "string") {
        return res.status(400).json({ error: "userId e name são obrigatórios" });
    }
    const u = store.requestAccess(userId, name);
    res.json({ enabled: u.enabled, pending: !u.enabled });
});

app.get("/policy/:userId", (req, res) => res.json(store.policyFor(req.params.userId)));

app.get("/", (req, res) => {
    const s = getSession(req);
    if (!s) return res.type("html").send(loginPage(discord.oauthConfigured(), VERSION));
    res.type("html").send(homePage(s.name, store.policyFor(s.id), isAdmin(s), store.getSettings().authMode));
});

app.get("/login", (_req, res) => {
    if (!discord.oauthConfigured()) {
        return res.status(500).type("html").send(errorPage("Login indisponível", "O login com Discord não está configurado neste servidor.", 500));
    }
    res.redirect(discord.oauthUrl("s"));
});

app.get("/auth/callback", async (req, res) => {
    try {
        const code = String(req.query.code ?? "");
        if (!code) return res.redirect("/");
        const token = await discord.exchangeCode(code);
        const u = await discord.getUser(token);
        store.requestAccess(u.id, u.name); // registra ao logar
        setSessionCookie(req, res, sign({ id: u.id, name: u.name }));
        res.redirect("/");
    } catch (e) {
        res.status(500).type("html").send(errorPage("Falha no login", (e as Error).message, 500));
    }
});

app.get("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.redirect("/");
});

app.get("/me", (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "não logado" });
    res.json({ id: s.id, name: s.name, admin: isAdmin(s), policy: store.policyFor(s.id) });
});

app.post("/me/request-access", (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: "não logado" });
    res.json(store.requestAccess(s.id, s.name));
});

app.get("/admin", (req, res) => {
    const s = getSession(req);
    if (!isAdmin(s)) {
        return res.status(403).type("html").send(errorPage("Acesso negado", "Esta área é só para admins do servidor.", 403));
    }
    res.type("html").send(adminPage(s!.name));
});

function admin(req: express.Request<any>, res: express.Response, next: express.NextFunction): void {
    const tokenOk = Boolean(ADMIN_TOKEN) && req.headers["x-admin-token"] === ADMIN_TOKEN;
    if (tokenOk || isAdmin(getSession(req))) return next();
    res.status(403).json({ error: "não autorizado" });
}

app.get("/admin/users", admin, (_req, res) => res.json(store.list()));

app.post("/admin/users/:id/enable", admin, (req, res) => {
    const { enabled = true, maxHeight, maxFps } = req.body ?? {};
    const u = store.setEnabled(req.params.id, Boolean(enabled), { maxHeight, maxFps });
    if (!u) return res.status(404).json({ error: "usuário não encontrado" });
    res.json(u);
});

app.get("/admin/settings", admin, (_req, res) => res.json({ ...store.getSettings(), bot: discord.botConfigured() }));

async function syncChannelsFromBot(): Promise<{ added: number; total: number; guilds: number }> {
    if (!discord.botConfigured()) return { added: 0, total: store.listChannels().length, guilds: 0 };
    const guilds = await discord.botGuilds();
    const lists = await Promise.all(guilds.map(async g => ({
        guild: g,
        channels: await discord.guildVoiceChannels(g.id).catch(() => [] as { id: string; name: string; type: number; }[]),
    })));
    const flat = lists.flatMap(({ guild, channels }) =>
        channels.map(c => ({ guildId: guild.id, guildName: guild.name, channelId: c.id, channelName: c.name })));
    return { added: store.seedChannels(flat), total: store.listChannels().length, guilds: guilds.length };
}

app.post("/admin/settings", admin, async (req, res) => {
    const mode = req.body?.authMode as AuthMode;
    if (mode !== "login" && mode !== "channels" && mode !== "both") return res.status(400).json({ error: "authMode inválido" });
    const settings = store.setAuthMode(mode);
    if (mode === "login") return res.json(settings);
    try { res.json({ ...settings, seeded: await syncChannelsFromBot() }); }
    catch (e) { res.json({ ...settings, seededError: (e as Error).message }); } // bot fora do ar: o modo muda mesmo assim
});

app.get("/admin/img/guild/:id", admin, async (req, res) => {
    const buf = await cachedImage(discord.guildIconUrl(req.params.id, await discord.guildIcon(req.params.id)));
    if (!buf) return res.sendStatus(404);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(buf);
});
app.get("/admin/img/user/:id", admin, async (req, res) => {
    const hash = userAvatarHash(req.params.id) ?? await discord.userAvatar(req.params.id);
    const buf = await cachedImage(discord.userAvatarUrl(req.params.id, hash));
    if (!buf) return res.sendStatus(404);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=600");
    res.end(buf);
});

app.get("/admin/bot", admin, (_req, res) => {
    res.json({
        configured: discord.botConfigured(),
        oauth: discord.oauthConfigured(),
        invite: discord.botInviteUrl(),
        gateway: botGatewayState(),
        adminCount: ADMIN_IDS.length,
    });
});

app.get("/admin/groups", admin, async (_req, res) => {
    const rooms = await Promise.all(getLiveState().map(enrichRoom));
    const liveByChannel = new Map<string, LiveMember[]>();
    for (const r of rooms) {
        for (const m of r.members) {
            if (!m.channelId) continue;
            // One entry per PERSON: a user streaming and also watching someone else has
            // one /dstream connection per stream room — merge them (streamer wins).
            const arr = liveByChannel.get(m.channelId) ?? [];
            const same = arr.find(x => x.userId === m.userId);
            if (!same) arr.push({ ...m });
            else if (m.streamer && !same.streamer) Object.assign(same, { streamer: true, since: m.since });
            liveByChannel.set(m.channelId, arr);
        }
    }
    const groups = new Map<string, Group>();
    for (const c of store.listChannels()) {
        let g = groups.get(c.guildId);
        if (!g) {
            g = { guildId: c.guildId, guildName: c.guildName || undefined, guildIcon: `/admin/img/guild/${c.guildId}`, botPresent: false, channels: [] };
            groups.set(c.guildId, g);
        }
        const live = liveByChannel.get(c.channelId) ?? [];
        const channel: GroupChannel = {
            channelId: c.channelId,
            channelName: c.channelName || c.channelId,
            enabled: c.enabled,
            bans: c.bans,
            seen: c.seen,
            liveMembers: live,
            streamers: live.filter(m => m.streamer).length,
            viewers: live.filter(m => !m.streamer).length,
        };
        g.channels.push(channel);
    }
    if (discord.botConfigured()) {
        try { for (const bg of await discord.botGuilds()) { const g = groups.get(bg.id); if (g) { g.botPresent = true; if (!g.guildName) g.guildName = bg.name; } } }
        catch { /* bot fora do ar: botPresent fica false */ }
    }
    res.json([...groups.values()]);
});

app.get("/admin/bot/guilds", admin, async (_req, res) => {
    if (!discord.botConfigured()) return res.status(503).json({ error: "bot não configurado (defina DISCORD_BOT_TOKEN)" });
    try { res.json(await discord.botGuilds()); } catch (e) { res.status(502).json({ error: (e as Error).message }); }
});
app.get("/admin/bot/guilds/:id/channels", admin, async (req, res) => {
    if (!discord.botConfigured()) return res.status(503).json({ error: "bot não configurado" });
    try { res.json(await discord.guildVoiceChannels(req.params.id)); } catch (e) { res.status(502).json({ error: (e as Error).message }); }
});

app.get("/admin/channels", admin, (_req, res) => res.json(store.listChannels()));
app.post("/admin/channels/sync", admin, async (_req, res) => {
    if (!discord.botConfigured()) return res.status(503).json({ error: "bot não configurado (defina DISCORD_BOT_TOKEN)" });
    try { res.json(await syncChannelsFromBot()); } catch (e) { res.status(502).json({ error: (e as Error).message }); }
});
app.post("/admin/channels", admin, (req, res) => {
    const { guildId, guildName = "", channelId, channelName = "", enabled = true } = req.body ?? {};
    if (!guildId || !channelId) return res.status(400).json({ error: "guildId e channelId obrigatórios" });
    res.json(store.upsertChannel({ guildId, guildName, channelId, channelName, enabled: Boolean(enabled) }));
});
app.post("/admin/channels/:id/enable", admin, (req, res) => {
    const enabled = Boolean(req.body?.enabled ?? true);
    const ch = store.setChannelEnabled(req.params.id, enabled);
    if (!ch) return res.status(404).json({ error: "canal não encontrado" });
    const kicked = enabled ? 0 : closeMembersInChannel(ch.channelId);
    res.json({ ...ch, kicked });
});
app.post("/admin/channels/:id/ban", admin, (req, res) => {
    const { userId, banned = true } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: "userId obrigatório" });
    const ch = store.setBan(req.params.id, String(userId), Boolean(banned));
    if (!ch) return res.status(404).json({ error: "canal não encontrado" });
    const kicked = banned ? closeMembersInChannel(ch.channelId, String(userId)) : 0;
    res.json({ ...ch, kicked });
});
app.delete("/admin/channels/:id", admin, (req, res) => res.json({ ok: store.removeChannel(req.params.id) }));

app.get("/admin/resolve", admin, async (req, res) => {
    const guildId = String(req.query.guild ?? ""), userId = String(req.query.user ?? "");
    if (!discord.botConfigured() || !guildId || !userId) return res.json({ userId, name: undefined });
    res.json({ userId, name: await discord.memberName(guildId, userId) });
});

const nameMem = new Map<string, string>(); // guildId:userId → nome resolvido (evita bater no Discord a cada poll)

async function nameOf(guildId: string, userId: string): Promise<string | undefined> {
    if (!discord.botConfigured()) return undefined;
    const key = `${guildId}:${userId}`;
    const hit = nameMem.get(key);
    if (hit) return hit;
    const name = await discord.memberName(guildId, userId);
    if (name) {
        if (nameMem.size > 500) nameMem.clear();
        nameMem.set(key, name);
    }
    return name;
}

async function guildNameOf(guildId: string): Promise<string | undefined> {
    if (!discord.botConfigured()) return undefined;
    try { return (await discord.botGuilds()).find(g => g.id === guildId)?.name; } catch { return undefined; }
}

async function enrichRoom(r: ReturnType<typeof getLiveState>[number]): Promise<LiveRoom> {
    const guildId = r.members.find(m => m.guildId)?.guildId ?? r.roomId;
    const configured = store.listChannels().find(c => c.guildId === guildId)?.guildName;
    const guildName = configured || await guildNameOf(guildId);
    const members: LiveMember[] = await Promise.all(r.members.map(async m => {
        const ch = m.channelId ? store.getChannel(m.channelId) : undefined;
        // Fresh name from the bot gateway first (updates when the nick changes), then the
        // stored one, then the REST API. Whatever wins is written back to "seen".
        const info = memberInfo(m.guildId ?? guildId, m.userId);
        let name = info?.name ?? ch?.seen.find(s => s.userId === m.userId)?.name;
        if (!name) name = await nameOf(guildId, m.userId);
        if (name && m.channelId) store.rememberName(m.channelId, m.userId, name);
        const avatar = `/admin/img/user/${m.userId}${info?.avatar ? `?h=${info.avatar}` : ""}`; // hash muda → navegador busca a nova
        return { userId: m.userId, name, avatar, streamer: m.streamer, since: m.since, channelId: m.channelId, channelName: ch?.channelName || undefined, guildId: m.guildId, kbps: m.kbps, rttMs: m.rttMs };
    }));
    const channelId = members.find(m => !!m.channelId)?.channelId;
    const channelName = members.find(m => !!m.channelName)?.channelName;
    return {
        roomId: r.roomId,
        guildId,
        guildName,
        guildIcon: `/admin/img/guild/${guildId}`,
        label: channelName || channelId,
        channelId,
        channelName,
        members,
        streamers: r.streamers,
        viewers: r.viewers,
    };
}

app.get("/admin/live", admin, async (_req, res) => {
    const rooms = await Promise.all(getLiveState().map(enrichRoom));
    res.json({ rooms, settings: store.getSettings(), bot: discord.botConfigured(), voice: botGatewayState().connected });
});

app.get("/admin/transmissions", admin, async (_req, res) => {
    const active: ActiveTransmission[] = [];
    for (const r of await Promise.all(getLiveState().map(enrichRoom))) {
        for (const m of r.members) {
            if (!m.streamer) continue;
            active.push({ userId: m.userId, name: m.name || m.userId, room: m.channelName || r.label || r.guildName || r.roomId, kind: "screen", since: m.since ?? 0 });
        }
    }
    res.json(active);
});

// Séries para os gráficos do painel: bitrate/RTT (1 h), logs por hora e atividade por canal (24 h).
app.get("/admin/stats", admin, (_req, res) => res.json(getStats()));

app.get("/admin/metrics", admin, (_req, res) => {
    const mem = { total: os.totalmem(), free: os.freemem() };
    const live = getLiveState();
    res.json({
        cpuLoad: os.loadavg(), // [1m,5m,15m]
        cpus: os.cpus().length,
        memory: { ...mem, usedPct: 1 - mem.free / mem.total },
        rooms: live.length,
        peers: live.reduce((n, r) => n + r.members.length, 0),
        uptime: process.uptime(),
    });
});

function userLabel(userId: string): string | undefined {
    const known = store.get(userId)?.name;
    if (known) return known;
    for (const c of store.listChannels()) {
        const seen = c.seen.find(m => m.userId === userId)?.name;
        if (seen) return seen;
    }
    return undefined;
}

app.get("/admin/logs", admin, async (_req, res) => {
    const list = await listUsers();
    res.json(list.map(u => ({ ...u, name: userLabel(u.userId), avatar: `/admin/img/user/${u.userId}` })));
});

app.get("/admin/logs/:userId/:day", admin, async (req, res) => {
    const text = await readDay(req.params.userId, req.params.day);
    if (text === null) return res.status(404).json({ error: "log não encontrado" });
    if (req.query.download) {
        res.setHeader("Content-Disposition", `attachment; filename="frd-logs-${req.params.userId}-${req.params.day}.jsonl"`);
        return res.type("application/x-ndjson").send(text);
    }
    const levels = String(req.query.level ?? "").split(",").filter(Boolean);
    const tail = Math.min(Number(req.query.tail) || 500, 5000);
    const entries = text.split("\n").filter(Boolean).flatMap(line => {
        try { return [JSON.parse(line) as { l: string; }]; } catch { return []; }
    }).filter(e => !levels.length || levels.includes(e.l));
    res.json({ total: entries.length, entries: entries.slice(-tail) });
});

app.post("/admin/logs/pause", admin, (req, res) => {
    if (typeof req.body?.paused !== "boolean") return res.status(400).json({ error: "paused inválido" });
    res.json({ paused: Boolean(store.setClientLogsPaused(req.body.paused).clientLogsPaused) });
});

app.delete("/admin/logs", admin, async (_req, res) => res.json({ users: await removeAll() }));

app.delete("/admin/logs/:userId", admin, async (req, res) => res.json({ ok: await removeUser(req.params.userId) }));

const httpServer = createServer(app);
httpServer.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    if (nativeStreamEnabled() && path.startsWith(NATIVE_STREAM_PATH)) {
        handleNativeStreamUpgrade(req, socket, head);
    } else {
        socket.destroy();
    }
});
if (nativeStreamEnabled()) startNativeStreamUdp();
if (discord.botConfigured()) startBotGateway();
if (clientLogsEnabled) { startClientLogSweeper(); void seedLogCounts(); }

httpServer.listen(Number(PORT), () => {
    console.log(`[v2] servidor ouvindo na porta ${PORT} (mídia em ${NATIVE_STREAM_PATH})`);
});
