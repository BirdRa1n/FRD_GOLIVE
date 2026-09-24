import { createServer } from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";

import * as discord from "./discord.js";
import { adminPage, errorPage, homePage, loginPage } from "./hub.js";
import { handleNativeStreamUpgrade, NATIVE_STREAM_PATH, nativeStreamEnabled, nativeStreamPublicIp, startNativeStreamUdp } from "./nativeStream.js";
import { COOKIE_NAME, parseCookies, type Session, sign, verify } from "./session.js";
import { store } from "./store.js";
import type {
    ActiveTransmission,
    ClientConfig,
    ClientMessage,
    PeerInfo,
    ServerMessage,
} from "./types.js";

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
interface ConnMeta {
    id: string;
    name: string;
    room: string;
    sharing: boolean;
    kind?: "screen" | "camera";
    /** Início da transmissão atual (ms), para o admin mostrar a duração. */
    since?: number;
}
const meta = new Map<WebSocket, ConnMeta>();
const rooms = new Map<string, Set<WebSocket>>();
const userConns = new Map<string, Set<WebSocket>>(); // para push de policy

function send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// --- HTTP ---
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    res.type("html").send(homePage(s.name, store.policyFor(s.id), isAdmin(s)));
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
    // push da nova policy para as conexões vivas desse usuário
    const policy = store.policyFor(u.id);
    for (const ws of userConns.get(u.id) ?? []) send(ws, { type: "policy", policy });
    res.json(u);
});

app.get("/admin/transmissions", admin, (_req, res) => {
    const active: ActiveTransmission[] = [];
    for (const [ws, m] of meta) {
        if (m.sharing && ws.readyState === WebSocket.OPEN) {
            active.push({ userId: m.id, name: m.name, room: m.room, kind: m.kind ?? "screen", since: m.since ?? 0 });
        }
    }
    res.json(active);
});

app.get("/admin/metrics", admin, (_req, res) => {
    const mem = { total: os.totalmem(), free: os.freemem() };
    res.json({
        cpuLoad: os.loadavg(), // [1m,5m,15m]
        cpus: os.cpus().length,
        memory: { ...mem, usedPct: 1 - mem.free / mem.total },
        rooms: rooms.size,
        peers: meta.size,
        uptime: process.uptime(),
    });
});

// --- WebSocket signaling ---
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Upgrades roteados à mão: com `path`, o ws recusaria (400) qualquer outro caminho.
httpServer.on("upgrade", (req, socket, head) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/signaling") {
        wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
    } else if (nativeStreamEnabled() && path.startsWith(NATIVE_STREAM_PATH)) {
        handleNativeStreamUpgrade(req, socket, head);
    } else {
        socket.destroy();
    }
});
if (nativeStreamEnabled()) startNativeStreamUdp();

wss.on("connection", ws => {
    ws.on("message", raw => {
        let msg: ClientMessage;
        try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }
        handle(ws, msg);
    });
    ws.on("close", () => cleanup(ws));
    ws.on("error", () => cleanup(ws));
});

function handle(ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === "join") {
        const policy = store.policyFor(msg.id);
        const m: ConnMeta = { id: msg.id, name: msg.name, room: msg.room, sharing: false };
        meta.set(ws, m);

        let set = rooms.get(msg.room);
        if (!set) { set = new Set(); rooms.set(msg.room, set); }

        // lista de peers já na sala
        const peers: PeerInfo[] = [...set].map(w => {
            const pm = meta.get(w)!;
            return { id: pm.id, name: pm.name };
        });

        set.add(ws);
        let uc = userConns.get(msg.id);
        if (!uc) { uc = new Set(); userConns.set(msg.id, uc); }
        uc.add(ws);

        send(ws, { type: "joined", policy });
        send(ws, { type: "peers", peers });
        for (const w of set) {
            if (w !== ws) send(w, { type: "peer-joined", id: msg.id, name: msg.name });
        }
        return;
    }

    const m = meta.get(ws);
    if (!m) return;

    if (msg.type === "signal") {
        const set = rooms.get(m.room);
        if (!set) return;
        for (const w of set) {
            const wm = meta.get(w);
            if (wm?.id === msg.to) send(w, { type: "signal", from: m.id, data: msg.data });
        }
    } else if (msg.type === "state") {
        if (msg.sharing && !m.sharing) m.since = Date.now();
        if (!msg.sharing) m.since = undefined;
        m.sharing = msg.sharing;
        m.kind = msg.kind;
    }
}

function cleanup(ws: WebSocket): void {
    const m = meta.get(ws);
    meta.delete(ws);
    if (!m) return;
    const set = rooms.get(m.room);
    if (set) {
        set.delete(ws);
        for (const w of set) send(w, { type: "peer-left", id: m.id });
        if (set.size === 0) rooms.delete(m.room);
    }
    const uc = userConns.get(m.id);
    if (uc) { uc.delete(ws); if (uc.size === 0) userConns.delete(m.id); }
}

httpServer.listen(Number(PORT), () => {
    console.log(`[v2] servidor ouvindo na porta ${PORT} (signaling em /signaling)`);
});
