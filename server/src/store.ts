// Store em memória de usuários/quotas. Trocar por SQLite/Postgres na Fase E.
// Persiste num JSON simples para sobreviver a restart no MVP.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Policy, User } from "./types.js";

const DB_FILE = process.env.DB_FILE ?? "./users.json";
const DEFAULT_MAX_HEIGHT = Number(process.env.DEFAULT_MAX_HEIGHT ?? 1080);
const DEFAULT_MAX_FPS = Number(process.env.DEFAULT_MAX_FPS ?? 30);

class Store {
    private users = new Map<string, User>();

    constructor() {
        if (existsSync(DB_FILE)) {
            try {
                const arr = JSON.parse(readFileSync(DB_FILE, "utf-8")) as User[];
                for (const u of arr) this.users.set(u.id, u);
            } catch { /* começa vazio */ }
        }
    }

    private persist(): void {
        try {
            writeFileSync(DB_FILE, JSON.stringify([...this.users.values()], null, 2));
        } catch { /* melhor esforço */ }
    }

    /** Registra (ou atualiza o nome de) um usuário pedindo acesso. */
    requestAccess(id: string, name: string): User {
        let u = this.users.get(id);
        if (!u) {
            u = {
                id, name,
                enabled: false,
                maxHeight: DEFAULT_MAX_HEIGHT,
                maxFps: DEFAULT_MAX_FPS,
                requestedAt: Date.now(),
            };
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
        if (!u) return { enabled: false, maxHeight: 0, maxFps: 0 };
        return { enabled: u.enabled, maxHeight: u.maxHeight, maxFps: u.maxFps };
    }
}

export const store = new Store();
