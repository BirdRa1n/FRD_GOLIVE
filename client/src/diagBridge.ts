// Ponte de diagnóstico MCP no renderer (parte do plugin).
//
// Fica em poll com o processo main (native.ts → diagPoll), que por sua vez fala
// com o servidor MCP local (mcp/) onde está o agente. O renderer não abre
// rede direto: o CSP do Discord bloquearia conectar em 127.0.0.1.
//
// Ferramentas expostas ao agente (lista espelhada no mcp/src/index.ts — se
// mudar uma, mude a outra): status, eval, media stats/watch, flux, probe,
// console, store, settings, dispatch e discord_voice.
//
// Só roda com a setting [Diagnóstico] "Ponte MCP" ligada (default: desligado).

import { FluxDispatcher } from "@webpack/common";

import { redact, startStreamProbe, stopStreamProbe } from "./probe/streamProbe";
import { settings } from "./settings";

const TAG = "[FRD diag]";
const DEFAULT_URL = "http://127.0.0.1:8756";
const POLL_MS = 100;
const FLUX_RING = 2000;
const CONSOLE_RING = 1000;

type Args = Record<string, any>;
type DiagCall = { id: string; tool: string; args?: Args; };
type DiagResult = { id: string; ok: boolean; result?: unknown; error?: string; };

interface DiagHelper {
    diagStart(url: string): Promise<void>;
    diagStop(): Promise<void>;
    diagPoll(): Promise<DiagCall[]>;
    diagReply(payload: DiagResult): Promise<void>;
}

let running = false;
let consoleWrapped = false;
const origConsole: Record<string, (...a: unknown[]) => unknown> = {};
let consoleBuf: { t: number; level: string; line: string; }[] = [];
/** addInterceptor não tem remove: instalado uma vez, liga/liga por flag. */
let fluxInstalled = false;
let fluxRecording = false;
let fluxFilter: string | null = null;
let fluxBuf: { t: number; type: string; data: unknown; }[] = [];

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getHelper(): DiagHelper | null {
    const helpers = (window as { VencordNative?: { pluginHelpers?: Record<string, unknown>; }; })
        .VencordNative?.pluginHelpers;
    return (helpers?.FRDGoLive as DiagHelper | undefined) ?? null;
}

function findStore(name: string): any {
    const webpack = (window as any).Vencord?.Webpack;
    const find = webpack && (webpack.findStore ?? webpack.findByStoreName);
    if (typeof find !== "function") throw new Error("Vencord.Webpack.findStore indisponível");
    const store = find.call(webpack, name);
    if (!store) throw new Error(`store "${name}" não encontrada`);
    return store;
}

/** Só os campos que interessam para observar o encoder (bitrate/frames/…). */
const WATCH_FIELDS = /bitrate|frameRate|frames|resolution|quality|bytes|packets|nack|pli|codec|roundTrip|available/i;

function watchView(value: any): any {
    if (!value || typeof value !== "object") return value ?? null;
    const out: any = { type: value.type };
    for (const [k, v] of Object.entries(value)) {
        if (WATCH_FIELDS.test(k)) out[k] = v;
    }
    return out;
}

/**
 * O Discord atual (0.0.412) tem UMA conexão unificada (context "default") com
 * áudio e vídeo juntos — filtrar context === "stream" acha nada (verificado via
 * MCP em 2026-09). Pega todas as conexões do MediaEngine.
 */
function mediaConnections(): any[] {
    const engine = findStore("MediaEngineStore").getMediaEngine?.();
    return [...((engine?.connections ?? []) as any[])];
}

/** Campos de controle do encoder no nível da conexão (fora do getStats). */
function connView(c: any): any {
    return {
        context: c.context ?? null,
        audioSSRC: c.audioSSRC ?? null,
        videoSSRC: c.videoSSRC ?? null,
        videoSupported: c.videoSupported ?? null,
        videoReady: c.videoReady ?? null,
        videoStreamParameters: c.videoStreamParameters ?? null,
        localVideoSinkWants: c.localVideoSinkWants ?? null,
        remoteVideoSinkWants: c.remoteVideoSinkWants ?? null,
        streamUserId: c.streamUserId ?? null,
    };
}

async function mediaSnapshot(trim: boolean): Promise<any[]> {
    const out: any[] = [];
    for (const c of mediaConnections()) {
        let stats: any;
        try {
            stats = await c.getStats?.();
        } catch (e) {
            out.push({ ...connView(c), error: String(e) });
            continue;
        }
        if (!trim) {
            out.push({ ...connView(c), stats: redact(stats) });
            continue;
        }
        out.push({
            ...connView(c),
            transport: stats?.transport ? watchView(stats.transport) : null,
            outbound: ((stats?.rtp?.outbound ?? []) as any[]).map(watchView),
            inbound: ((stats?.rtp?.inbound ?? []) as any[]).map(watchView),
        });
    }
    return out;
}

function stringifyArg(value: unknown): string {
    if (typeof value === "string") return value.length > 2000 ? value.slice(0, 2000) + "…" : value;
    try {
        const json = JSON.stringify(redact(value));
        return json === undefined ? String(value) : json;
    } catch {
        return String(value);
    }
}

// --- Console --------------------------------------------------------------------

function installConsoleHook(): void {
    if (consoleWrapped) return;
    consoleWrapped = true;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
        const orig = console[level].bind(console);
        origConsole[level] = orig;
        (console as any)[level] = (...args: unknown[]) => {
            if (running) {
                try {
                    consoleBuf.push({ t: Date.now(), level, line: args.map(stringifyArg).join(" ") });
                    if (consoleBuf.length > CONSOLE_RING) consoleBuf.shift();
                } catch {
                    // nunca quebrar o console
                }
            }
            orig(...args);
        };
    }
}

function restoreConsole(): void {
    if (!consoleWrapped) return;
    for (const [level, fn] of Object.entries(origConsole)) (console as any)[level] = fn;
    for (const level of Object.keys(origConsole)) delete origConsole[level];
    consoleWrapped = false;
}

// --- Flux -----------------------------------------------------------------------

function installFluxInterceptor(): void {
    if (fluxInstalled) return;
    fluxInstalled = true;
    // O dispatcher não tem removeInterceptor: fica instalado e vira no-op.
    FluxDispatcher.addInterceptor((action: { type?: string; }) => {
        if (fluxRecording && action?.type && (!fluxFilter || action.type.startsWith(fluxFilter))) {
            fluxBuf.push({ t: Date.now(), type: action.type, data: redact(action) });
            if (fluxBuf.length > FLUX_RING) fluxBuf.shift();
        }
        return false;
    });
}

// --- Ferramentas ----------------------------------------------------------------

const handlers: Record<string, (args: Args) => Promise<unknown>> = {
    async discord_status() {
        return {
            running,
            ua: navigator.userAgent,
            flux: { recording: fluxRecording, filter: fluxFilter, buffered: fluxBuf.length },
            consoleLines: consoleBuf.length,
            probeActive: !!(window as any).FRDStreamProbe,
            config: {
                nativeStreamEndpoint: settings.store.nativeStreamEndpoint || "(vazio = o Go Live vai pro Discord de verdade)",
                nativeStreamDave: settings.store.nativeStreamDave,
                nativeStreamHybrid: settings.store.nativeStreamHybrid,
                streamProbe: settings.store.streamProbe,
            },
        };
    },

    async discord_eval({ code }) {
        if (typeof code !== "string" || !code.trim()) throw new Error("code vazio");
        const fn = new Function(`return (async () => {\n${code}\n})()`);
        return redact(await fn());
    },

    async discord_media_stats() {
        const connections = await mediaSnapshot(false);
        return connections.length
            ? { connections }
            : { connections: [], note: "MediaEngine sem conexões — entre num canal de voz (o vídeo vai na conexão unificada, context default)" };
    },

    async discord_media_watch({ seconds = 10, intervalMs = 500 }) {
        const total = Math.max(1, Math.min(45, Number(seconds) || 10));
        const gap = Math.max(100, Math.min(5000, Number(intervalMs) || 500));
        const samples: unknown[] = [];
        const until = Date.now() + total * 1000;
        for (;;) {
            let snapshot: unknown;
            try {
                snapshot = await mediaSnapshot(true);
            } catch (e) {
                snapshot = [{ error: String(e) }];
            }
            samples.push({ t: Date.now(), connections: snapshot });
            if (Date.now() >= until || samples.length >= 600) break;
            await sleep(gap);
        }
        return { seconds: total, intervalMs: gap, samples };
    },

    async discord_flux({ op, filter, tail = 500 }) {
        const n = Math.max(1, Math.min(FLUX_RING, Number(tail) || 500));
        switch (op) {
            case "start": {
                fluxBuf = [];
                fluxFilter = typeof filter === "string" && filter ? filter : null;
                fluxRecording = true;
                return { recording: true, filter: fluxFilter };
            }
            case "stop":
                fluxRecording = false;
                return { recording: false, buffered: fluxBuf.length };
            case "dump": {
                const events = fluxBuf.filter(e => !filter || e.type.startsWith(String(filter)));
                return { buffered: fluxBuf.length, filter: filter ?? fluxFilter, returned: Math.min(n, events.length), events: events.slice(-n) };
            }
            case "clear":
                fluxBuf = [];
                return { cleared: true };
            default:
                throw new Error(`op inválido: ${op} (start|stop|dump|clear)`);
        }
    },

    async discord_probe({ op, tail = 500 }) {
        const probe = (window as any).FRDStreamProbe;
        switch (op) {
            case "start":
                startStreamProbe();
                return { active: true };
            case "stop":
                stopStreamProbe();
                return { active: false };
            case "clear":
                if (!probe) throw new Error("sonda inativa");
                probe.clear();
                return { cleared: true };
            case "dump": {
                if (!probe) throw new Error('sonda inativa — use op="start" (ou ligue a setting streamProbe)');
                const events: unknown[] = Array.isArray(probe.events) ? probe.events : [];
                const n = Math.max(1, Math.min(3000, Number(tail) || 500));
                return { total: events.length, returned: Math.min(n, events.length), events: events.slice(-n) };
            }
            default:
                throw new Error(`op inválido: ${op} (start|stop|dump|clear)`);
        }
    },

    async discord_console({ op, tail = 200 }) {
        if (op === "clear") {
            consoleBuf = [];
            return { cleared: true };
        }
        if (op !== "dump") throw new Error(`op inválido: ${op} (dump|clear)`);
        const n = Math.max(1, Math.min(CONSOLE_RING, Number(tail) || 200));
        return { total: consoleBuf.length, returned: Math.min(n, consoleBuf.length), lines: consoleBuf.slice(-n) };
    },

    async discord_store({ store, method, args }) {
        if (typeof store !== "string" || !store) throw new Error("informe a store (ex.: MediaEngineStore)");
        const target = findStore(store);
        if (!method) return redact(target);
        const fn = target[method];
        if (typeof fn !== "function") throw new Error(`${store}.${method} não é função`);
        return redact(await fn.apply(target, Array.isArray(args) ? args : []));
    },

    async discord_settings({ op, key, value }) {
        const store = settings.store as Record<string, unknown>;
        if (op === "get") {
            if (key == null) return redact(store);
            if (!(key in store)) throw new Error(`chave desconhecida: ${key}`);
            return { [key]: store[key] };
        }
        if (op === "set") {
            if (!key || !(key in store)) throw new Error(`chave desconhecida: ${key} — use get para listar`);
            store[key] = value;
            return { [key]: store[key], note: "settings com restartNeeded pedem Ctrl+R no Discord para valer" };
        }
        throw new Error(`op inválido: ${op} (get|set)`);
    },

    async discord_dispatch({ action }) {
        if (!action || typeof action.type !== "string") throw new Error('action precisa de {type: "ALGUMA_ACAO"}');
        FluxDispatcher.dispatch(action);
        return { dispatched: action.type };
    },

    async discord_native({ list = true, method, args, withCallback = false }) {
        const native = (window as any).DiscordNative?.nativeModules;
        if (!native?.requireModule) throw new Error("DiscordNative.nativeModules indisponível");
        const mod = native.requireModule("discord_voice");
        if (list || !method) {
            const names = new Set<string>();
            for (let p: object | null = mod; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
                for (const k of Object.getOwnPropertyNames(p)) names.add(k);
            }
            const out: Record<string, string> = {};
            for (const k of [...names].sort()) {
                if (k === "constructor") continue;
                try {
                    out[k] = typeof mod[k];
                } catch {
                    out[k] = "???";
                }
            }
            return out;
        }
        const fn = mod[method];
        if (typeof fn !== "function") throw new Error(`discord_voice.${method} não é função`);
        const callArgs = Array.isArray(args) ? [...args] : [];
        if (!withCallback) return redact(await fn.apply(mod, callArgs));
        // JSON não transporta funções: injeta o callback como último argumento e
        // espera o resultado (ou 5s) — é o padrão de getters como
        // getCodecCapabilities / getSupportedBandwidthEstimationExperiments.
        return redact(await new Promise(resolve => {
            let done = false;
            const timer = setTimeout(() => finish("<callback não chamado em 5s>"), 5000);
            function finish(v: unknown): void {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(v);
            }
            callArgs.push((...cbArgs: unknown[]) => finish(cbArgs.length > 1 ? cbArgs : cbArgs[0]));
            try {
                const ret = fn.apply(mod, callArgs);
                if (ret && typeof ret.then === "function") ret.then(finish, (e: unknown) => finish({ threw: String(e) }));
                else if (ret !== undefined) finish(ret);
            } catch (e) {
                finish({ threw: String(e) });
            }
        }));
    },
};

async function handleCall(helper: DiagHelper, call: DiagCall): Promise<void> {
    try {
        const handler = handlers[call.tool];
        if (!handler) throw new Error(`ferramenta desconhecida: ${call.tool}`);
        const result = await handler(call.args ?? {});
        await helper.diagReply({ id: call.id, ok: true, result });
    } catch (e) {
        const error = e instanceof Error ? (e.stack || e.message) : String(e);
        try {
            await helper.diagReply({ id: call.id, ok: false, error });
        } catch {
            // helper sumiu (plugin parado?) — o MCP dá timeout e explica
        }
    }
}

async function pollLoop(): Promise<void> {
    while (running) {
        try {
            const helper = getHelper();
            if (!helper?.diagPoll) {
                await sleep(POLL_MS * 10);
                continue;
            }
            const calls = await helper.diagPoll();
            if (Array.isArray(calls)) {
                for (const call of calls) await handleCall(helper, call);
            }
        } catch (e) {
            console.error(TAG, "falha no poll:", e);
            await sleep(POLL_MS * 10);
        }
        await sleep(POLL_MS);
    }
}

// --- API ------------------------------------------------------------------------

export function startDiagBridge(): void {
    if (running) return;
    const helper = getHelper();
    if (!helper?.diagStart) {
        console.error(TAG, "helpers nativas ausentes — reinstale o plugin pelo instalador");
        return;
    }
    running = true;
    installConsoleHook();
    installFluxInterceptor();
    const url = settings.store.diagMcpUrl || DEFAULT_URL;
    void helper.diagStart(url).catch(e => console.error(TAG, "diagStart:", e));
    void pollLoop();
    console.log(TAG, "ponte ligada →", url, "(abra o OpenCode na raiz do repo para falar via MCP)");
}

export function stopDiagBridge(): void {
    if (!running) return;
    running = false;
    fluxRecording = false;
    restoreConsole();
    try {
        const helper = getHelper();
        if (helper?.diagStop) void helper.diagStop().catch(() => {});
    } catch {
        // processo main já morreu
    }
    console.log(TAG, "ponte desligada");
}
