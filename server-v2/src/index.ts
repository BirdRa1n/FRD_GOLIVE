import { createServer } from "node:http";
import os from "node:os";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";

import { store } from "./store.js";
import type {
    ActiveTransmission,
    ClientConfig,
    ClientMessage,
    PeerInfo,
    ServerMessage,
} from "./types.js";

const {
    PORT = "8090",
    ADMIN_TOKEN = "",
    PUBLIC_SIGNALING_URL = "", // ex.: wss://signaling.seu.com
    STUN_URLS = "stun:stun.l.google.com:19302",
    TURN_URLS = "",
    TURN_USERNAME = "",
    TURN_CREDENTIAL = "",
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
}
const meta = new Map<WebSocket, ConnMeta>();
const rooms = new Map<string, Set<WebSocket>>();
const userConns = new Map<string, Set<WebSocket>>(); // para push de policy

function send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function iceServers() {
    const list: { urls: string | string[]; username?: string; credential?: string; }[] = [
        { urls: STUN_URLS.split(",").map(s => s.trim()) },
    ];
    if (TURN_URLS) {
        list.push({
            urls: TURN_URLS.split(",").map(s => s.trim()),
            username: TURN_USERNAME,
            credential: TURN_CREDENTIAL,
        });
    }
    return list;
}

// --- HTTP ---
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    next();
});

app.get("/health", (_req, res) => res.json({ ok: true, version: VERSION, transport: "mesh" }));

/** Config que o instalador/plugin puxa de um host. */
app.get("/config", (req, res) => {
    const proto = req.headers["x-forwarded-proto"] === "https" || req.secure ? "wss" : "ws";
    const host = req.headers.host ?? `localhost:${PORT}`;
    const cfg: ClientConfig = {
        signalingUrl: PUBLIC_SIGNALING_URL || `${proto}://${host}/signaling`,
        iceServers: iceServers(),
        version: VERSION,
        transport: "mesh",
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

// --- Admin ---
function admin(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (ADMIN_TOKEN && req.headers["x-admin-token"] !== ADMIN_TOKEN) {
        res.status(403).json({ error: "admin token inválido" });
        return;
    }
    next();
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
            active.push({ userId: m.id, name: m.name, room: m.room, kind: m.kind ?? "screen", since: 0 });
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
const wss = new WebSocketServer({ server: httpServer, path: "/signaling" });

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
