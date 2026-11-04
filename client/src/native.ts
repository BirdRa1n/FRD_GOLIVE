
import { RendererSettings } from "@main/settings";
import { app, desktopCapturer, type IpcMainInvokeEvent, session } from "electron";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import type { LogEntry, NativeSource } from "./types";

const IS_WIN = process.platform === "win32";
const OWN_AUDIO_EXCLUDED_DEVICE = "loopbackWithoutChrome";
const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";

interface PluginSettings {
    enabled?: boolean;
    excludeDiscordAudio?: boolean;
    logUpload?: boolean;
    nativeStreamEndpoint?: string;
}

function pluginSettings(): PluginSettings {
    try {
        return (RendererSettings.store.plugins?.FRDGoLive ?? {}) as PluginSettings;
    } catch {
        return {};
    }
}

function windowsSupportsProcessLoopback(): boolean {
    if (!IS_WIN) return false;
    const build = Number(release().split(".")[2] ?? 0);
    return build >= 19041;
}

function mergeFeatureList(current: string, extra: string): string {
    const set = new Set([...current.split(","), ...extra.split(",")].map(s => s.trim()).filter(Boolean));
    return [...set].join(",");
}

const wantInProcessAudio =
    windowsSupportsProcessLoopback()
    && pluginSettings().enabled !== false
    && pluginSettings().excludeDiscordAudio !== false;

if (wantInProcessAudio) {
    const cl = app.commandLine;
    const original = cl.appendSwitch.bind(cl);
    cl.appendSwitch = (name: string, value?: string) => {
        if ((name === "disable-features" || name === "enable-features") && value !== undefined) {
            value = mergeFeatureList(cl.getSwitchValue(name), value);
            if (name === "disable-features") value = mergeFeatureList(value, AUDIO_SERVICE_FEATURE);
        }
        return value === undefined ? original(name) : original(name, value);
    };
    cl.appendSwitch("disable-features", AUDIO_SERVICE_FEATURE);
}

interface PendingCapture {
    sourceId: string;
    sourceName: string;
    audio: boolean;
    at: number;
}

let pending: PendingCapture | null = null;
type DisplayHandler = Parameters<Electron.Session["setDisplayMediaRequestHandler"]>[0];
let discordHandler: DisplayHandler | null = null;

function installDisplayMediaHandler(): void {
    const ses = session.defaultSession;
    const originalSet = ses.setDisplayMediaRequestHandler.bind(ses);

    const combined: DisplayHandler = (request, callback) => {
        const p = pending;
        if (p && Date.now() - p.at < 15_000) {
            pending = null; // uso único
            callback({
                video: { id: p.sourceId, name: p.sourceName } as Electron.DesktopCapturerSource,
                ...(p.audio && request.audioRequested ? { audio: OWN_AUDIO_EXCLUDED_DEVICE as "loopback" } : {}),
            });
            return;
        }
        if (discordHandler) return discordHandler(request, callback);
        callback({});
    };

    ses.setDisplayMediaRequestHandler = ((handler: DisplayHandler | null, opts?: Electron.DisplayMediaRequestHandlerOpts) => {
        discordHandler = handler;
        originalSet(combined, opts);
    }) as typeof ses.setDisplayMediaRequestHandler;

    originalSet(combined);
}

app.whenReady().then(installDisplayMediaHandler).catch(e => console.error("[FRD GoLive] handler de display media:", e));

export async function getScreenSources(_: IpcMainInvokeEvent): Promise<NativeSource[]> {
    const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
    });

    return sources.map(source => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith("screen:") ? "screen" as const : "window" as const,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined,
    }));
}

export interface AudioCaps {
    excludesDiscord: boolean;
    reason?: string;
}

export function getAudioCaps(_: IpcMainInvokeEvent): AudioCaps {
    if (!IS_WIN) return { excludesDiscord: false, reason: "O macOS não permite capturar o som do sistema." };
    if (!windowsSupportsProcessLoopback()) {
        return { excludesDiscord: false, reason: "Requer Windows 10 (versão 2004) ou mais novo para separar o áudio do Discord." };
    }
    if (!wantInProcessAudio) {
        return { excludesDiscord: false, reason: "Separação do áudio do Discord desligada nas configurações do plugin." };
    }
    const outOfProcess = app.getAppMetrics().some(m => m.serviceName === "audio.mojom.AudioService");
    if (outOfProcess) {
        return { excludesDiscord: false, reason: "Reinicie o Discord por completo para ativar o som sem o áudio da call." };
    }
    return { excludesDiscord: true };
}

export function prepareCapture(_: IpcMainInvokeEvent, sourceId: string, sourceName: string, audio: boolean): void {
    pending = { sourceId, sourceName, audio, at: Date.now() };
}

export function cancelCapture(_: IpcMainInvokeEvent): void {
    pending = null;
}

const DIAG_TOKEN_FILE = join(homedir(), ".frd-golive", "mcp-token");

interface DiagCall {
    id: string;
    tool: string;
    args: Record<string, unknown>;
}

interface DiagResult {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

let diagUrl = "";
let diagWanted = false;
let diagToken = "";
let diagDown = false;
const diagCalls: DiagCall[] = [];
const diagResults: DiagResult[] = [];

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readDiagToken(): void {
    try {
        diagToken = readFileSync(DIAG_TOKEN_FILE, "utf8").trim();
    } catch {
        diagToken = ""; // o MCP ainda não subiu → tenta de novo depois (401)
    }
}

async function fetchDiag(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: any; }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${diagUrl}${path}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${diagToken}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await res.text();
        let json: unknown = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
        }
        return { status: res.status, json };
    } finally {
        clearTimeout(timer);
    }
}

async function diagLoopFn(): Promise<void> {
    readDiagToken();
    while (diagWanted) {
        try {
            while (diagWanted && diagResults.length) {
                const res = await fetchDiag("/result", diagResults[0], 10_000);
                if (res.status === 401) {
                    readDiagToken();
                    await sleep(2000);
                    continue;
                }
                if (res.status >= 200 && res.status < 300) {
                    diagResults.shift();
                } else {
                    await sleep(3000); // servidor instável: tenta de novo com o mesmo resultado
                }
            }
            if (!diagWanted) break;

            const res = await fetchDiag("/poll", {}, 10_000);
            if (res.status === 401) {
                readDiagToken();
                await sleep(2000);
                continue;
            }
            if (res.status >= 200 && res.status < 300) {
                const calls: unknown = res.json?.calls;
                if (Array.isArray(calls)) {
                    for (const call of calls) {
                        const c = call as DiagCall;
                        if (c && typeof c.id === "string" && typeof c.tool === "string") diagCalls.push(c);
                    }
                }
                if (diagDown) {
                    diagDown = false;
                    console.log("[FRD GoLive] ponte MCP conectada:", diagUrl);
                }
                if (diagCalls.length === 0) await sleep(400);
            } else {
                await sleep(3000);
            }
        } catch (e) {
            if (!diagDown) {
                diagDown = true;
                console.log("[FRD GoLive] ponte MCP aguardando:", diagUrl, "(rode o OpenCode na raiz do repo, com mcp/ buildado)");
            }
            await sleep(5000);
        }
    }
}

export function diagStart(_: IpcMainInvokeEvent, url: string): void {
    const clean = typeof url === "string" && /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : "";
    diagUrl = clean || "http://127.0.0.1:8756";
    if (diagWanted) return;
    diagWanted = true;
    diagLoopFn().catch(e => console.error("[FRD GoLive] ponte MCP:", e));
}

export function diagStop(_: IpcMainInvokeEvent): void {
    diagWanted = false;
    diagCalls.length = 0;
    diagResults.length = 0;
}

export function diagPoll(_: IpcMainInvokeEvent): DiagCall[] {
    return diagCalls.splice(0, diagCalls.length);
}

export function diagReply(_: IpcMainInvokeEvent, payload: DiagResult): void {
    if (payload && typeof payload.id === "string" && typeof payload.ok === "boolean") {
        diagResults.push(payload);
    }
}

const LOG_DIR = join(homedir(), ".frd-golive", "logs");
const LOG_CURRENT = join(LOG_DIR, "current.jsonl");
const LOG_UPLOAD_MS = 5 * 60_000;
const LOG_FIRST_UPLOAD_MS = 60_000;
const LOG_SPOOL_MAX_BYTES = 30 * 1024 * 1024;
const LOG_CHUNK_BYTES = 1024 * 1024;
const LOG_DROP_STATUS = new Set([400, 410, 413]); // o servidor nunca vai aceitar este lote: não insiste

let logTimer: ReturnType<typeof setInterval> | null = null;
let logUploading = false;

function logIngestUrl(): string | null {
    const s = pluginSettings();
    if (s.enabled === false || s.logUpload === false) return null;
    const host = (s.nativeStreamEndpoint ?? "").trim().replace(/^wss?:\/\//, "").split("/")[0];
    if (!host) return null;
    const local = /^(localhost|127\.|\[::1\])/.test(host);
    return `${local ? "http" : "https"}://${host}/logs/ingest`;
}

async function spoolFiles(): Promise<string[]> {
    const names = await readdir(LOG_DIR).catch(() => [] as string[]);
    return names.filter(n => /^spool-\d+\.jsonl$/.test(n)).sort((a, b) => Number(a.slice(6, -6)) - Number(b.slice(6, -6)));
}

async function trimSpool(files: string[]): Promise<string[]> {
    const sizes = await Promise.all(files.map(f => stat(join(LOG_DIR, f)).then(x => x.size, () => 0)));
    let total = sizes.reduce((a, b) => a + b, 0);
    const kept = [...files];
    while (kept.length > 1 && total > LOG_SPOOL_MAX_BYTES) {
        await rm(join(LOG_DIR, kept.shift()!), { force: true });
        total -= sizes.shift()!;
    }
    return kept;
}

async function postLogs(url: string, userId: string, lines: string[]): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const body = `{"userId":${JSON.stringify(userId)},"platform":${JSON.stringify(process.platform)},"discordVersion":${JSON.stringify(app.getVersion())},"entries":[${lines.join(",")}]}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "content-encoding": "gzip" },
            body: gzipSync(body),
            signal: controller.signal,
        });
        return res.status;
    } finally {
        clearTimeout(timer);
    }
}

// Devolve as linhas que faltam enviar; o arquivo só some depois do servidor confirmar.
async function uploadSpool(url: string, raw: string): Promise<string[]> {
    const rows = raw.split("\n").filter(Boolean);
    let i = 0;
    while (i < rows.length) {
        const start = i;
        let bytes = 0, userId = "";
        const lines: string[] = [];
        for (; i < rows.length; i++) {
            const sep = rows[i].indexOf("\t");
            const rowUser = rows[i].slice(0, sep);
            const line = rows[i].slice(sep + 1);
            if (lines.length && (rowUser !== userId || bytes + line.length > LOG_CHUNK_BYTES)) break;
            userId = rowUser;
            bytes += line.length;
            lines.push(line);
        }
        if (!logIngestUrl()) return rows.slice(start);
        const status = await postLogs(url, userId, lines).catch(() => 0);
        if (!(status >= 200 && status < 300) && !LOG_DROP_STATUS.has(status)) return rows.slice(start);
    }
    return [];
}

async function logUploadTick(): Promise<void> {
    const url = logIngestUrl();
    if (!url || logUploading) return;
    logUploading = true;
    try {
        await rename(LOG_CURRENT, join(LOG_DIR, `spool-${Date.now()}.jsonl`)).catch(() => {});
        for (const name of await trimSpool(await spoolFiles())) {
            const file = join(LOG_DIR, name);
            const left = await uploadSpool(url, await readFile(file, "utf8"));
            if (!logIngestUrl()) return;
            if (left.length) {
                await writeFile(file, left.join("\n") + "\n", { mode: 0o600 });
                return; // servidor fora do ar: tenta de novo no próximo ciclo
            }
            await rm(file, { force: true });
        }
    } catch (e) {
        console.warn("[FRD GoLive] envio de logs:", e);
    } finally {
        logUploading = false;
    }
}

export function logsStart(_: IpcMainInvokeEvent): void {
    if (logTimer) return;
    logTimer = setInterval(() => void logUploadTick(), LOG_UPLOAD_MS);
    setTimeout(() => void logUploadTick(), LOG_FIRST_UPLOAD_MS);
}

export async function logsAppend(_: IpcMainInvokeEvent, userId: string, entries: LogEntry[]): Promise<void> {
    if (!logIngestUrl() || !/^\d{5,25}$/.test(userId) || !Array.isArray(entries) || !entries.length) return;
    await mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
    await appendFile(LOG_CURRENT, entries.map(e => `${userId}\t${JSON.stringify(e)}\n`).join(""), { mode: 0o600 });
}

export async function logsDisable(_: IpcMainInvokeEvent): Promise<void> {
    if (logTimer) clearInterval(logTimer);
    logTimer = null;
    await rm(LOG_DIR, { recursive: true, force: true });
}
