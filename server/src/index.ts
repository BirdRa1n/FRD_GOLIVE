import { createServer } from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";

import * as discord from "./discord.js";
import { adminPage, errorPage, homePage, loginPage } from "./hub.js";
import { getLiveState, handleNativeStreamUpgrade, NATIVE_STREAM_PATH, nativeStreamEnabled, nativeStreamPublicIp, startNativeStreamUdp } from "./nativeStream.js";
import { COOKIE_NAME, parseCookies, type Session, sign, verify } from "./session.js";
import { store } from "./store.js";
import type { ActiveTransmission, AuthMode, ClientConfig, LiveMember, LiveRoom } from "./types.js";

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
    VERSION = "2.0.0",
} = process.env;

if (!ADMIN_TOKEN) console.warn("[v2] ADMIN_TOKEN vazio — endpoints de admin desprotegidos!");

// --- estado de signaling ---
// --- HTTP ---
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    // Responde o preflight (OPTIONS) com 204 — senão cai em 404 e o CORS falha.
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

// Design system (CSS/JS/ícones) compartilhado pelas páginas do hub — e catálogo em /ui/.
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
app.use("/ui", express.static(`${PUBLIC_DIR}/ui`, { maxAge: "1h" }));

app.get("/health", (_req, res) => res.json({ ok: true, version: VERSION, transport: "native" }));

/** Config que o instalador/plugin puxa de um host. */
app.get("/config", (req, res) => {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const cfg: ClientConfig = {
        // Host (sem esquema) do WS de controle do Go Live nativo — o plugin redireciona para cá.
        nativeStreamEndpoint: nativeStreamEnabled() ? `${host}${NATIVE_STREAM_PATH}` : "",
        // IP/host público da mídia (UDP) — informativo.
        mediaHost: nativeStreamPublicIp(),
        version: VERSION,
        transport: "native",
    };
    res.json(cfg);
});

/** Usuário pede acesso (vindo do hub após login). */
app.post("/auth/request-access", (req, res) => {
    const { userId, name } = req.body ?? {};
    if (typeof userId !== "string" || typeof name !== "string") {
        return res.status(400).json({ error: "userId e name são obrigatórios" });
    }
    const u = store.requestAccess(userId, name);
    res.json({ enabled: u.enabled, pending: !u.enabled });
});

app.get("/policy/:userId", (req, res) => res.json(store.policyFor(req.params.userId)));

// --- Hub (login Discord + páginas) ---
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

// --- Admin API (aceita sessão de admin OU X-Admin-Token) ---
function admin(req: express.Request, res: express.Response, next: express.NextFunction): void {
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

// --- Modo de autorização (login OU channels) ---
app.get("/admin/settings", admin, (_req, res) => res.json({ ...store.getSettings(), bot: discord.botConfigured() }));
app.post("/admin/settings", admin, (req, res) => {
    const mode = req.body?.authMode as AuthMode;
    if (mode !== "login" && mode !== "channels") return res.status(400).json({ error: "authMode inválido" });
    res.json(store.setAuthMode(mode));
});

// --- Bot: navegar guilds/canais de voz para o admin escolher ---
app.get("/admin/bot/guilds", admin, async (_req, res) => {
    if (!discord.botConfigured()) return res.status(503).json({ error: "bot não configurado (defina DISCORD_BOT_TOKEN)" });
    try { res.json(await discord.botGuilds()); } catch (e) { res.status(502).json({ error: (e as Error).message }); }
});
app.get("/admin/bot/guilds/:id/channels", admin, async (req, res) => {
    if (!discord.botConfigured()) return res.status(503).json({ error: "bot não configurado" });
    try { res.json(await discord.guildVoiceChannels(req.params.id)); } catch (e) { res.status(502).json({ error: (e as Error).message }); }
});

// --- Canais configurados (modo channels) ---
app.get("/admin/channels", admin, (_req, res) => res.json(store.listChannels()));
app.post("/admin/channels", admin, (req, res) => {
    const { guildId, guildName = "", channelId, channelName = "", enabled = true } = req.body ?? {};
    if (!guildId || !channelId) return res.status(400).json({ error: "guildId e channelId obrigatórios" });
    res.json(store.upsertChannel({ guildId, guildName, channelId, channelName, enabled: Boolean(enabled) }));
});
app.post("/admin/channels/:id/enable", admin, (req, res) => {
    const ch = store.setChannelEnabled(req.params.id, Boolean(req.body?.enabled ?? true));
    if (!ch) return res.status(404).json({ error: "canal não encontrado" });
    res.json(ch);
});
app.post("/admin/channels/:id/ban", admin, (req, res) => {
    const { userId, banned = true } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: "userId obrigatório" });
    const ch = store.setBan(req.params.id, String(userId), Boolean(banned));
    if (!ch) return res.status(404).json({ error: "canal não encontrado" });
    res.json(ch);
});
app.delete("/admin/channels/:id", admin, (req, res) => res.json({ ok: store.removeChannel(req.params.id) }));

// --- Resolver nome de um membro (best-effort via bot) ---
app.get("/admin/resolve", admin, async (req, res) => {
    const guildId = String(req.query.guild ?? ""), userId = String(req.query.user ?? "");
    if (!discord.botConfigured() || !guildId || !userId) return res.json({ userId, name: undefined });
    res.json({ userId, name: await discord.memberName(guildId, userId) });
});

// --- Estado ao vivo: salas de mídia e quem transmite/assiste agora ---
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
    const configured = store.listChannels().find(c => c.guildId === r.roomId)?.guildName;
    const guildName = configured || await guildNameOf(r.roomId);
    const members: LiveMember[] = await Promise.all(r.members.map(async m => {
        const ch = m.channelId ? store.getChannel(m.channelId) : undefined;
        let name = ch?.seen.find(s => s.userId === m.userId)?.name;
        if (!name) {
            name = await nameOf(r.roomId, m.userId);
            if (name && m.channelId) store.rememberName(m.channelId, m.userId, name);
        }
        return { userId: m.userId, name, streamer: m.streamer, since: m.since, channelId: m.channelId, channelName: ch?.channelName || undefined };
    }));
    return { roomId: r.roomId, guildName, members, streamers: r.streamers, viewers: r.viewers };
}

app.get("/admin/live", admin, async (_req, res) => {
    const rooms = await Promise.all(getLiveState().map(enrichRoom));
    res.json({ rooms, settings: store.getSettings(), bot: discord.botConfigured() });
});

app.get("/admin/transmissions", admin, async (_req, res) => {
    const active: ActiveTransmission[] = [];
    for (const r of await Promise.all(getLiveState().map(enrichRoom))) {
        for (const m of r.members) {
            if (!m.streamer) continue;
            active.push({ userId: m.userId, name: m.name || m.userId, room: m.channelName || r.guildName || r.roomId, kind: "screen", since: m.since ?? 0 });
        }
    }
    res.json(active);
});

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

// --- HTTP + upgrade (só a mídia do Go Live nativo, /dstream) ---
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

httpServer.listen(Number(PORT), () => {
    console.log(`[v2] servidor ouvindo na porta ${PORT} (mídia em ${NATIVE_STREAM_PATH})`);
});
