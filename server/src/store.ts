// Store em memória de usuários/canais/config. Persiste num JSON simples para
// sobreviver a restart no MVP. Trocar por SQLite/Postgres depois.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AuthMode, ChannelCfg, Policy, ServerSettings, User } from "./types.js";

const DB_FILE = process.env.DB_FILE ?? "./users.json";
const DEFAULT_MAX_HEIGHT = Number(process.env.DEFAULT_MAX_HEIGHT ?? 1080);
const DEFAULT_MAX_FPS = Number(process.env.DEFAULT_MAX_FPS ?? 30);
const SEEN_MAX = 50; // membros "vistos" guardados por canal

interface DbShape {
    users: User[];
    channels: ChannelCfg[];
    settings: ServerSettings;
}

class Store {
    private users = new Map<string, User>();
    private channels = new Map<string, ChannelCfg>(); // por channelId
    private settings: ServerSettings = { authMode: "login" };

    constructor() {
        if (existsSync(DB_FILE)) {
            try {
                const raw = JSON.parse(readFileSync(DB_FILE, "utf-8"));
                // Formato antigo = array de usuários; novo = { users, channels, settings }.
                const db: DbShape = Array.isArray(raw)
                    ? { users: raw, channels: [], settings: { authMode: "login" } }
                    : raw;
                for (const u of db.users ?? []) this.users.set(u.id, u);
                for (const c of db.channels ?? []) this.channels.set(c.channelId, { ...c, bans: c.bans ?? [], seen: c.seen ?? [] });
                if (db.settings?.authMode) this.settings = db.settings;
            } catch { /* começa vazio */ }
        }
    }

    private persist(): void {
        try {
            const db: DbShape = {
                users: [...this.users.values()],
                channels: [...this.channels.values()],
                settings: this.settings,
            };
            writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        } catch { /* melhor esforço */ }
    }

    // --- Config ---

    getSettings(): ServerSettings {
        return this.settings;
    }

    setAuthMode(mode: AuthMode): ServerSettings {
        this.settings.authMode = mode;
        this.persist();
        return this.settings;
    }

    // --- Usuários (modo login) ---

    requestAccess(id: string, name: string): User {
        let u = this.users.get(id);
        if (!u) {
            u = { id, name, enabled: false, maxHeight: DEFAULT_MAX_HEIGHT, maxFps: DEFAULT_MAX_FPS, requestedAt: Date.now() };
            this.users.set(id, u);
        } else {
            u.name = name;
        }
        this.persist();
        return u;
    }

    get(id: string): User | undefined {
        return this.users.get(id);
    }

    list(): User[] {
        return [...this.users.values()].sort((a, b) => b.requestedAt - a.requestedAt);
    }

    setEnabled(id: string, enabled: boolean, quota?: { maxHeight?: number; maxFps?: number; }): User | undefined {
        const u = this.users.get(id);
        if (!u) return undefined;
        u.enabled = enabled;
        if (enabled) u.enabledAt = Date.now();
        if (quota?.maxHeight) u.maxHeight = quota.maxHeight;
        if (quota?.maxFps) u.maxFps = quota.maxFps;
        this.persist();
        return u;
    }

    policyFor(id: string): Policy {
        const u = this.users.get(id);
        if (!u) return { enabled: false, maxHeight: DEFAULT_MAX_HEIGHT, maxFps: DEFAULT_MAX_FPS };
        return { enabled: u.enabled, maxHeight: u.maxHeight, maxFps: u.maxFps };
    }

    // --- Canais (modo channels) ---

    listChannels(): ChannelCfg[] {
        return [...this.channels.values()].sort((a, b) => b.addedAt - a.addedAt);
    }

    getChannel(channelId: string): ChannelCfg | undefined {
        return this.channels.get(channelId);
    }

    /** Adiciona um canal (habilitado por padrão) ou atualiza os nomes. */
    upsertChannel(c: { guildId: string; guildName: string; channelId: string; channelName: string; enabled?: boolean; }): ChannelCfg {
        let ch = this.channels.get(c.channelId);
        if (!ch) {
            ch = { ...c, enabled: c.enabled ?? true, addedAt: Date.now(), bans: [], seen: [] };
            this.channels.set(c.channelId, ch);
        } else {
            ch.guildName = c.guildName || ch.guildName;
            ch.channelName = c.channelName || ch.channelName;
            if (typeof c.enabled === "boolean") ch.enabled = c.enabled;
        }
        this.persist();
        return ch;
    }

    setChannelEnabled(channelId: string, enabled: boolean): ChannelCfg | undefined {
        const ch = this.channels.get(channelId);
        if (!ch) return undefined;
        ch.enabled = enabled;
        this.persist();
        return ch;
    }

    /** Preenche nomes resolvidos via bot (não mexe em `enabled` nem em listas). */
    fillNames(channelId: string, guildName: string, channelName: string): void {
        const ch = this.channels.get(channelId);
        if (!ch) return;
        const g = guildName || ch.guildName;
        const c = channelName || ch.channelName;
        if (g === ch.guildName && c === ch.channelName) return;
        ch.guildName = g;
        ch.channelName = c;
        this.persist();
    }

    removeChannel(channelId: string): boolean {
        const ok = this.channels.delete(channelId);
        if (ok) this.persist();
        return ok;
    }

    setBan(channelId: string, userId: string, banned: boolean): ChannelCfg | undefined {
        const ch = this.channels.get(channelId);
        if (!ch) return undefined;
        const has = ch.bans.includes(userId);
        if (banned && !has) ch.bans.push(userId);
        if (!banned && has) ch.bans = ch.bans.filter(x => x !== userId);
        this.persist();
        return ch;
    }

    isBanned(channelId: string, userId: string): boolean {
        return this.channels.get(channelId)?.bans.includes(userId) ?? false;
    }

    /** Registra um membro visto num canal (para a dashboard agir sem digitar id). */
    noteSeen(channelId: string, userId: string, name?: string): void {
        const ch = this.channels.get(channelId);
        if (!ch) return;
        const now = Date.now();
        const m = ch.seen.find(s => s.userId === userId);
        if (m) { m.lastSeen = now; if (name) m.name = name; }
        else ch.seen.push({ userId, name, lastSeen: now });
        ch.seen.sort((a, b) => b.lastSeen - a.lastSeen);
        if (ch.seen.length > SEEN_MAX) ch.seen.length = SEEN_MAX;
        this.persist();
    }

    /** Grava o nome resolvido de um membro visto (sem mexer no `lastSeen`). */
    rememberName(channelId: string, userId: string, name: string): void {
        const m = this.channels.get(channelId)?.seen.find(s => s.userId === userId);
        if (!m || m.name === name) return;
        m.name = name;
        this.persist();
    }

    /** Decisão central de habilitação, considerando o modo de auth. */
    canStream(userId: string, channelId: string): boolean {
        if (this.settings.authMode === "channels") {
            const ch = this.channels.get(channelId);
            return !!ch?.enabled && !ch.bans.includes(userId);
        }
        return !!this.users.get(userId)?.enabled;
    }
}

export const store = new Store();
