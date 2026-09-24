// Sonda (somente leitura) do Go Live NATIVO do Discord.
//
// Objetivo: levantar o protocolo real da conexão de transmissão ("stream") para
// avaliar trocar o servidor de mídia do Discord pelo nosso. Registra:
//   1. eventos Flux do ciclo de vida da transmissão (STREAM_CREATE,
//      STREAM_SERVER_UPDATE — traz o endpoint do servidor de mídia —, etc.);
//   2. os frames do WS de sinalização (wss://*.discord.media) — JSON por inteiro,
//      binários (DAVE/MLS) só opcode + tamanho;
//   3. as chamadas do JS ao módulo nativo `discord_voice` (o que o JS entrega ao
//      nativo: ip/porta UDP, modo de criptografia, parâmetros de vídeo…);
//   4. requisições HTTP em /streams/* (ex.: upload da miniatura da transmissão).
//
// Nada é alterado nem bloqueado. Tokens e chaves são mascarados, então o dump
// pode ser compartilhado. No console: FRDStreamProbe.copy() copia tudo.

import { copyToClipboard } from "@utils/clipboard";
import { FluxDispatcher } from "@webpack/common";

const TAG = "[FRD probe]";
const MAX_EVENTS = 3000;
const MAX_STR = 4000;
/** Chamadas por função nativa registradas antes de silenciar (algumas rodam por frame). */
const NATIVE_CALL_LOG_LIMIT = 5;
/** Teto maior para nomes que interessam (conexão/vídeo/criptografia). */
const NATIVE_LOUD_LOG_LIMIT = 60;
const NATIVE_ALWAYS_LOG = /connect|transport|stream|desktop|video|encrypt|codec|ssrc|sink|goLive|screen|capture|dave|mls/i;
const SENSITIVE_KEY = /token|secret|password|^session_?id$|authorization|^key$/i;

const FLUX_EVENTS = [
    "STREAM_CREATE",
    "STREAM_SERVER_UPDATE",
    "STREAM_UPDATE",
    "STREAM_DELETE",
    "STREAM_WATCH",
    "STREAM_START",
    "STREAM_STOP",
    "STREAM_CLOSE",
    "STREAM_PREVIEW_FETCH_SUCCESS",
    "RTC_CONNECTION_STATE",
    "RTC_CONNECTION_VIDEO",
    "MEDIA_ENGINE_VIDEO_SOURCE_QUALITY_CHANGED",
] as const;

type ProbeEvent = { t: number; kind: string; data: unknown; };

const events: ProbeEvent[] = [];
const t0 = Date.now();
let active = false;
const undo: Array<() => void> = [];
/** Hosts de mídia anunciados por STREAM_SERVER_UPDATE — marca o WS como "stream". */
const streamHosts = new Set<string>();

// --- util -----------------------------------------------------------------------

export function redact(value: unknown, depth = 0): unknown {
    if (depth > 8) return "[depth]";
    if (typeof value === "string") return value.length > MAX_STR ? value.slice(0, MAX_STR) + `…[+${value.length - MAX_STR}]` : value;
    if (typeof value === "function") return "[fn]";
    if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength}]`;
    if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength}]`;
    if (Array.isArray(value)) return value.slice(0, 200).map(v => redact(v, depth + 1));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SENSITIVE_KEY.test(k) && v != null ? `[redacted ${typeof v}${Array.isArray(v) ? ` len=${v.length}` : ""}]` : redact(v, depth + 1);
        }
        return out;
    }
    return value;
}

function record(kind: string, data: unknown): void {
    const ev = { t: Date.now() - t0, kind, data: redact(data) };
    events.push(ev);
    if (events.length > MAX_EVENTS) events.shift();
    console.log(TAG, `+${ev.t}ms`, kind, ev.data);
}

function hostOf(url: string): string {
    try { return new URL(url).host; } catch { return url; }
}

// --- 1. Flux -------------------------------------------------------------------

function onFlux(payload: { type: string; }): void {
    record(`flux:${payload.type}`, payload);
}

function markStreamHost(action: { type?: string; endpoint?: string | null; }): boolean {
    if (active && action.type === "STREAM_SERVER_UPDATE" && action.endpoint) {
        streamHosts.add(hostOf(action.endpoint.startsWith("wss://") ? action.endpoint : `wss://${action.endpoint}`));
    }
    return false;
}

function hookFlux(): void {
    // Interceptor roda antes do Discord abrir o WS → o "open" já sai marcado como stream.
    FluxDispatcher.addInterceptor(markStreamHost);
    for (const ev of FLUX_EVENTS) FluxDispatcher.subscribe(ev as any, onFlux);
    undo.push(() => { for (const ev of FLUX_EVENTS) FluxDispatcher.unsubscribe(ev as any, onFlux); });
}

// --- 2. WebSocket de sinalização ------------------------------------------------

/** Frame binário do voice gateway v8: servidor→cliente = [seq u16][op u8]…, cliente→servidor = [op u8]…. */
function describeBinary(buf: ArrayBuffer, fromServer: boolean): Record<string, unknown> {
    const b = new Uint8Array(buf);
    return fromServer
        ? { binary: true, seq: b.length >= 2 ? (b[0] << 8) | b[1] : null, op: b[2] ?? null, len: b.length }
        : { binary: true, op: b[0] ?? null, len: b.length };
}

function describeFrame(data: unknown, fromServer: boolean): unknown {
    if (typeof data === "string") {
        try { return JSON.parse(data); } catch { return data; }
    }
    if (data instanceof ArrayBuffer) return describeBinary(data, fromServer);
    if (ArrayBuffer.isView(data)) return describeBinary(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, fromServer);
    if (data instanceof Blob) return { blob: true, len: data.size };
    return String(data);
}

function hookWebSocket(): void {
    const Native = window.WebSocket;
    let nextId = 1;

    const Wrapped = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
        const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
        const href = String(url);
        if (!/discord\.media/i.test(href)) return ws;

        const id = nextId++;
        const ctx = () => (streamHosts.has(hostOf(href)) ? "stream" : "voice?");
        record(`ws#${id}:open`, { url: href, context: ctx() });

        const send = ws.send.bind(ws);
        ws.send = (data: Parameters<WebSocket["send"]>[0]) => {
            record(`ws#${id}:${ctx()}:send`, describeFrame(data, false));
            send(data);
        };
        ws.addEventListener("message", ev => record(`ws#${id}:${ctx()}:recv`, describeFrame(ev.data, true)));
        ws.addEventListener("close", ev => record(`ws#${id}:${ctx()}:close`, { code: ev.code, reason: ev.reason, clean: ev.wasClean }));
        return ws;
    } as unknown as typeof WebSocket;

    Wrapped.prototype = Native.prototype;
    Object.assign(Wrapped, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Wrapped;
    undo.push(() => { window.WebSocket = Native; });
}

// --- 3. Módulo nativo discord_voice --------------------------------------------

function wrapCallable(name: string, fn: (...a: unknown[]) => unknown, depth: number): (...a: unknown[]) => unknown {
    let calls = 0;
    // Callbacks do nativo (ex.: frames de vídeo) nunca ganham o teto maior.
    const limit = !name.includes("→") && NATIVE_ALWAYS_LOG.test(name) ? NATIVE_LOUD_LOG_LIMIT : NATIVE_CALL_LOG_LIMIT;

    const wrapArgs = (args: unknown[]) => args.map((a, i) =>
        typeof a === "function" && depth < 2
            ? wrapCallable(`${name}→cb${i}`, a as (...x: unknown[]) => unknown, depth + 1)
            : a);

    const logCall = (args: unknown[]) => {
        calls++;
        if (calls <= limit) record(`native:${name}`, { call: calls, args });
        else if (calls === limit + 1) record(`native:${name}`, "(silenciado — muitas chamadas)");
    };

    const wrapResult = (res: unknown) =>
        res && typeof res === "object" && depth < 2 ? wrapObject(name, res as Record<string, unknown>, depth + 1) : res;

    return new Proxy(fn, {
        apply(target, thisArg, args) {
            logCall(args);
            return wrapResult(Reflect.apply(target, thisArg, wrapArgs(args)));
        },
        construct(target, args, newTarget) {
            logCall(args);
            return wrapResult(Reflect.construct(target, wrapArgs(args), newTarget)) as object;
        },
    });
}

/** Troca as funções de `obj` por proxies que registram as chamadas (mutação in-place, para pegar referências já guardadas pelo Discord). */
function wrapObject<T extends Record<string, unknown>>(prefix: string, obj: T, depth: number): T {
    const wrapped: string[] = [];
    const failed: string[] = [];
    const keys = new Set<string>();
    for (let p: object | null = obj; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const k of Object.getOwnPropertyNames(p)) keys.add(k);
    }
    for (const k of keys) {
        if (k === "constructor") continue;
        let v: unknown;
        try { v = obj[k]; } catch { continue; }
        if (typeof v !== "function") continue;
        const proxy = wrapCallable(`${prefix}.${k}`, v as (...a: unknown[]) => unknown, depth);
        try {
            (obj as Record<string, unknown>)[k] = proxy;
            if (obj[k] === proxy) wrapped.push(k); else failed.push(k);
        } catch {
            failed.push(k);
        }
    }
    if (depth === 0) record(`native:hook ${prefix}`, { wrapped, failed });
    return obj;
}

function hookNativeVoice(): void {
    const native = (window as any).DiscordNative?.nativeModules;
    if (!native?.requireModule) {
        record("native:unavailable", "DiscordNative.nativeModules ausente (Discord web?)");
        return;
    }
    try {
        const voice = native.requireModule("discord_voice");
        // Obs.: requireModule devolve um objeto novo a cada chamada (same-object=false),
        // então isto lista a API mas não pega as chamadas que o Discord faz.
        wrapObject("discord_voice", voice, 0);
        // Mesmo objeto em chamadas futuras? (se não for, só o que já foi embrulhado conta)
        record("native:same-object", native.requireModule("discord_voice") === voice);
    } catch (e) {
        record("native:error", String(e));
    }
    // Sem undo: as funções embrulhadas só registram; um reload do Discord (Ctrl+R) volta ao original.
}

// --- 4. HTTP /streams/* ---------------------------------------------------------

function hookHttp(): void {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        const href = String(url);
        if (/\/streams\//.test(href)) record("http:xhr", { method, url: href });
        return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;

    const origFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (/\/streams\//.test(href)) record("http:fetch", { method: init?.method ?? "GET", url: href, bodyBytes: typeof init?.body === "string" ? init.body.length : undefined });
        return origFetch.call(this, input, init);
    };

    undo.push(() => {
        XMLHttpRequest.prototype.open = origOpen;
        window.fetch = origFetch;
    });
}

// --- API ------------------------------------------------------------------------

const api = {
    dump: () => JSON.stringify(events, null, 2),
    copy: () => copyToClipboard(api.dump()).then(() => console.log(TAG, `copiado (${events.length} eventos)`)),
    clear: () => { events.length = 0; },
    events,
};

export function startStreamProbe(): void {
    if (active) return;
    active = true;
    for (const [name, hook] of [["flux", hookFlux], ["ws", hookWebSocket], ["native", hookNativeVoice], ["http", hookHttp]] as const) {
        try { hook(); } catch (e) { console.error(TAG, `falha no hook ${name}:`, e); }
    }
    (window as any).FRDStreamProbe = api;
    record("probe:start", { ua: navigator.userAgent });
}

export function stopStreamProbe(): void {
    if (!active) return;
    active = false;
    while (undo.length) undo.pop()!();
    delete (window as any).FRDStreamProbe;
}
