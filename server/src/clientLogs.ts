import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzip, gzipSync } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

const DIR = process.env.CLIENT_LOGS_DIR ?? join(dirname(process.env.DB_FILE ?? "./users.json"), "client-logs");
const RETENTION_DAYS = Number(process.env.CLIENT_LOGS_RETENTION_DAYS ?? 14);
const USER_MAX_BYTES = Number(process.env.CLIENT_LOGS_USER_MAX_MB ?? 200) * 1024 * 1024;
const TOTAL_MAX_BYTES = Number(process.env.CLIENT_LOGS_TOTAL_MAX_MB ?? 5000) * 1024 * 1024;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 60;
const MAX_ENTRIES = 20_000;
const MAX_LINE = 8000;
const USER_RE = /^\d{5,25}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl\.gz$/;

export const clientLogsEnabled = (process.env.CLIENT_LOGS_ENABLED ?? "1") !== "0";

export interface ClientLogEntry { t: number; l: string; s: string; m: string; }
export interface ClientLogDay { day: string; bytes: number; }
export interface ClientLogUser { userId: string; bytes: number; days: ClientLogDay[]; lastAt: number; }

const rate = new Map<string, { start: number; n: number; }>();

function allow(userId: string): boolean {
    const now = Date.now();
    const r = rate.get(userId);
    if (!r || now - r.start > RATE_WINDOW_MS) {
        if (rate.size > 10_000) rate.clear();
        rate.set(userId, { start: now, n: 1 });
        return true;
    }
    return ++r.n <= RATE_MAX;
}

// Segunda barreira: o cliente já limpa, mas um token nunca pode parar em disco por bug do cliente.
function scrub(line: string): string {
    const out = line
        .replace(/data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=_-]+/g, "[data-uri]")
        .replace(/\bmfa\.[\w-]{20,}/g, "[token]")
        .replace(/\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g, "[token]")
        .replace(/\b(Bearer|Bot)\s+[\w.-]{20,}/g, "$1 [token]");
    return out.length > MAX_LINE ? out.slice(0, MAX_LINE) + "…" : out;
}

function clean(raw: unknown): ClientLogEntry | null {
    const e = raw as Partial<ClientLogEntry> | null;
    if (!e || typeof e.m !== "string" || typeof e.t !== "number") return null;
    return { t: e.t, l: String(e.l ?? "log").slice(0, 16), s: String(e.s ?? "").slice(0, 16), m: scrub(e.m) };
}

export type IngestResult = { status: number; stored?: number; error?: string; };

export async function ingest(body: any): Promise<IngestResult> {
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!USER_RE.test(userId)) return { status: 400, error: "userId inválido" };
    if (!Array.isArray(body?.entries) || body.entries.length > MAX_ENTRIES) return { status: 400, error: "entries inválido" };
    if (!allow(userId)) return { status: 429, error: "muitos envios" };

    const entries = (body.entries as unknown[]).map(clean).filter((e): e is ClientLogEntry => !!e);
    if (!entries.length) return { status: 200, stored: 0 };

    const dir = join(DIR, userId);
    await mkdir(dir, { recursive: true });
    const now = new Date();
    const meta: ClientLogEntry = {
        t: now.getTime(),
        l: "meta",
        s: "batch",
        m: JSON.stringify({ platform: String(body.platform ?? "").slice(0, 32), discordVersion: String(body.discordVersion ?? "").slice(0, 32), count: entries.length }),
    };
    const text = [meta, ...entries].map(e => JSON.stringify(e)).join("\n") + "\n";
    // Membros gzip concatenados continuam sendo um gzip válido: dá para só anexar.
    await appendFile(join(dir, `${now.toISOString().slice(0, 10)}.jsonl.gz`), gzipSync(text));
    return { status: 200, stored: entries.length };
}

async function userDays(userId: string): Promise<(ClientLogDay & { mtime: number; })[]> {
    const names = await readdir(join(DIR, userId)).catch(() => [] as string[]);
    const out: (ClientLogDay & { mtime: number; })[] = [];
    for (const name of names) {
        const day = DAY_FILE_RE.exec(name)?.[1];
        if (!day) continue;
        const st = await stat(join(DIR, userId, name)).catch(() => null);
        if (st) out.push({ day, bytes: st.size, mtime: st.mtimeMs });
    }
    return out.sort((a, b) => b.day.localeCompare(a.day));
}

export async function listUsers(): Promise<ClientLogUser[]> {
    const ids = (await readdir(DIR).catch(() => [] as string[])).filter(n => USER_RE.test(n));
    const users = await Promise.all(ids.map(async userId => {
        const days = await userDays(userId);
        return {
            userId,
            bytes: days.reduce((n, d) => n + d.bytes, 0),
            days: days.map(({ day, bytes }) => ({ day, bytes })),
            lastAt: Math.max(0, ...days.map(d => d.mtime)),
        };
    }));
    return users.filter(u => u.days.length).sort((a, b) => b.lastAt - a.lastAt);
}

export async function readDay(userId: string, day: string): Promise<string | null> {
    if (!USER_RE.test(userId) || !DAY_RE.test(day)) return null;
    const gz = await readFile(join(DIR, userId, `${day}.jsonl.gz`)).catch(() => null);
    return gz ? (await gunzipAsync(gz)).toString("utf8") : null;
}

export async function removeUser(userId: string): Promise<boolean> {
    if (!USER_RE.test(userId)) return false;
    await rm(join(DIR, userId), { recursive: true, force: true });
    return true;
}

export async function removeAll(): Promise<number> {
    const ids = (await readdir(DIR).catch(() => [] as string[])).filter(n => USER_RE.test(n));
    await Promise.all(ids.map(id => rm(join(DIR, id), { recursive: true, force: true })));
    return ids.length;
}

export async function sweep(now = Date.now()): Promise<void> {
    const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    const all: { userId: string; day: string; bytes: number; }[] = [];
    const drop = (userId: string, day: string) => rm(join(DIR, userId, `${day}.jsonl.gz`), { force: true });

    for (const u of await listUsers()) {
        let userBytes = u.bytes;
        // days vem do mais novo para o mais antigo; sempre sobra o dia atual
        for (let i = u.days.length - 1; i >= 0; i--) {
            const d = u.days[i];
            if (d.day < cutoff || (userBytes > USER_MAX_BYTES && i > 0)) {
                await drop(u.userId, d.day);
                userBytes -= d.bytes;
            } else {
                all.push({ userId: u.userId, day: d.day, bytes: d.bytes });
            }
        }
    }

    let total = all.reduce((n, d) => n + d.bytes, 0);
    all.sort((a, b) => a.day.localeCompare(b.day));
    for (const d of all) {
        if (total <= TOTAL_MAX_BYTES) break;
        await drop(d.userId, d.day);
        total -= d.bytes;
    }
}

export function startClientLogSweeper(): void {
    const run = () => sweep().catch(e => console.warn("[client-logs] limpeza falhou:", (e as Error).message));
    void run();
    setInterval(run, 3600_000).unref();
}
