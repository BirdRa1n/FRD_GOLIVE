import { FluxDispatcher, UserStore } from "@webpack/common";

import { mediaConnectionCount, mediaSnapshot } from "./diagBridge";
import { scrubLogLine } from "./logScrub";
import { redact } from "./probe/streamProbe";
import type { LogEntry } from "./types";

const FLUSH_MS = 10_000;
const MEDIA_MS = 30_000;
const MAX_BUFFER = 5000;
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

// Lista fechada: CONNECTION_OPEN e afins carregam dados da conta; STREAM_PREVIEW_* carrega a miniatura da tela.
const FLUX_EVENTS = [
    "CONNECTION_CLOSED",
    "CONNECTION_RESUMED",
    "RTC_CONNECTION_STATE",
    "RTC_CONNECTION_LOSS_RATE",
    "RTC_CONNECTION_PING",
    "STREAM_CREATE",
    "STREAM_SERVER_UPDATE",
    "STREAM_UPDATE",
    "STREAM_DELETE",
    "STREAM_START",
    "STREAM_STOP",
    "STREAM_CLOSE",
] as const;

interface LogHelper {
    logsStart(): Promise<void>;
    logsAppend(userId: string, entries: LogEntry[]): Promise<void>;
    logsDisable(): Promise<void>;
}

let capturing = false;
let consoleHooked = false;
let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let mediaTimer: ReturnType<typeof setInterval> | null = null;

function getHelper(): LogHelper | null {
    const helpers = (window as { VencordNative?: { pluginHelpers?: Record<string, unknown>; }; })
        .VencordNative?.pluginHelpers;
    const helper = helpers?.FRDGoLive as Partial<LogHelper> | undefined;
    // Renderer novo com main antigo (Ctrl+R depois de atualizar, sem reiniciar o Discord): fica sem envio até reiniciar.
    return typeof helper?.logsAppend === "function" ? helper as LogHelper : null;
}

function push(l: string, s: string, m: string): void {
    buffer.push({ t: Date.now(), l, s, m: scrubLogLine(m) });
    if (buffer.length > MAX_BUFFER) buffer.shift();
}

function stringifyArg(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? String(value);
    try {
        return JSON.stringify(redact(value)) ?? String(value);
    } catch {
        return String(value);
    }
}

// Tira o "%c" e os argumentos de estilo que os loggers do Discord/Vencord mandam junto.
export function formatConsoleArgs(args: unknown[]): string {
    const head = args[0];
    if (typeof head === "string" && head.includes("%c")) {
        const styles = head.split("%c").length - 1;
        return [head.replaceAll("%c", "").trim(), ...args.slice(1 + styles).map(stringifyArg)].join(" ");
    }
    return args.map(stringifyArg).join(" ");
}

function hookConsole(): void {
    if (consoleHooked) return;
    consoleHooked = true;
    // O wrapper fica instalado mesmo desligado (só repassa): desfazer quebraria o hook da ponte MCP, que embrulha este.
    for (const level of CONSOLE_LEVELS) {
        const orig = console[level].bind(console);
        (console as any)[level] = (...args: unknown[]) => {
            if (capturing) {
                try {
                    push(level, "console", formatConsoleArgs(args));
                } catch {
                }
            }
            orig(...args);
        };
    }
}

function onFlux(action: { type: string; }): void {
    if (capturing) push("info", "flux", `${action.type} ${stringifyArg(action)}`);
}

function onWindowError(e: ErrorEvent): void {
    if (capturing) push("error", "window", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}${e.error?.stack ? `\n${e.error.stack}` : ""}`);
}

function onRejection(e: PromiseRejectionEvent): void {
    if (capturing) push("error", "window", `unhandledrejection ${stringifyArg(e.reason)}`);
}

function onOnline(): void {
    if (capturing) push("info", "window", "network online");
}

function onOffline(): void {
    if (capturing) push("warn", "window", "network offline");
}

function flush(): void {
    const userId = UserStore.getCurrentUser?.()?.id;
    const helper = getHelper();
    if (!userId || !helper || !buffer.length) return;
    const entries = buffer;
    buffer = [];
    helper.logsAppend(userId, entries).catch(() => {
        if (capturing) buffer = [...entries, ...buffer].slice(-MAX_BUFFER);
    });
}

async function sampleMedia(): Promise<void> {
    if (!capturing) return;
    try {
        if (mediaConnectionCount() > 0) push("info", "media", stringifyArg(await mediaSnapshot(true)));
    } catch {
    }
}

export function startLogCollector(): void {
    if (capturing) return;
    capturing = true;
    hookConsole();
    for (const type of FLUX_EVENTS) FluxDispatcher.subscribe(type, onFlux);
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", flush);
    flushTimer = setInterval(flush, FLUSH_MS);
    mediaTimer = setInterval(() => void sampleMedia(), MEDIA_MS);
    getHelper()?.logsStart().catch(() => {});
}

function detach(): void {
    if (!capturing) return;
    capturing = false;
    for (const type of FLUX_EVENTS) FluxDispatcher.unsubscribe(type, onFlux);
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("beforeunload", flush);
    if (flushTimer) clearInterval(flushTimer);
    if (mediaTimer) clearInterval(mediaTimer);
    flushTimer = mediaTimer = null;
}

// Plugin parado (Discord fechando/plugin desativado): guarda o que falta; o envio continua de onde parou.
export function stopLogCollector(): void {
    if (capturing) flush();
    detach();
    buffer = [];
}

// Usuário desligou o envio: nada fica para trás, nem o que já estava esperando em disco.
export function disableLogCollector(): void {
    detach();
    buffer = [];
    getHelper()?.logsDisable().catch(() => {});
}
