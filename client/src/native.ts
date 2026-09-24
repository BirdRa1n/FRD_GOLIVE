// Módulo NATIVO do plugin — roda no processo main do Electron (Vencord expõe as
// funções exportadas aqui via VencordNative.pluginHelpers.FRDGoLive).
//
// 1) Lista telas/janelas pelo desktopCapturer (contorna o getDisplayMedia do
//    Discord e o bloqueio regional).
// 2) Áudio da transmissão SEM o áudio do Discord (a call não vaza para quem
//    assiste — ninguém se escuta na live), no Windows:
//    - o Chromium tem o dispositivo "loopbackWithoutChrome": áudio do sistema
//      EXCLUINDO a árvore de processos de quem captura (WASAPI process loopback,
//      PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE);
//    - por padrão quem captura é o processo do *serviço de áudio* do Chromium, e
//      a voz da call (discord_voice) toca no *renderer* — que não é filho dele.
//      Então rodamos o serviço de áudio DENTRO do processo principal
//      (--disable-features=AudioServiceOutOfProcess): a árvore excluída passa a
//      ser o Discord inteiro (main → renderer com a voz, GPU, utilitários);
//    - a captura vai por getDisplayMedia; o handler abaixo responde com a fonte
//      escolhida no picker + audio "loopbackWithoutChrome" (o Electron 42 repassa
//      o id como está; o 43+ também, e ainda mapeia restrictOwnAudio).
//
// Este arquivo é carregado pelo Vencord ANTES do código do Discord, o que
// permite ajustar as flags do Chromium a tempo (antes do app ficar "ready").

import { RendererSettings } from "@main/settings";
import { app, desktopCapturer, type IpcMainInvokeEvent, session } from "electron";
import { readFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { join } from "node:path";

import type { NativeSource } from "./types";

const IS_WIN = process.platform === "win32";
const OWN_AUDIO_EXCLUDED_DEVICE = "loopbackWithoutChrome";
const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";

function pluginSettings(): { enabled?: boolean; excludeDiscordAudio?: boolean; } {
    try {
        return (RendererSettings.store.plugins?.FRDGoLive ?? {}) as { enabled?: boolean; excludeDiscordAudio?: boolean; };
    } catch {
        return {};
    }
}

/** Windows 10 2004 (build 19041)+ tem o process loopback do WASAPI. */
function windowsSupportsProcessLoopback(): boolean {
    if (!IS_WIN) return false;
    const build = Number(release().split(".")[2] ?? 0);
    return build >= 19041;
}

// --- 1. Flags do Chromium (antes do "ready") ------------------------------------

/** Junta listas "A,B" sem duplicar. */
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
    // O Discord também define --disable-features (depois de nós); o último
    // appendSwitch venceria. Envolvemos o appendSwitch para SEMPRE mesclar.
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

// --- 2. Handler do getDisplayMedia --------------------------------------------

interface PendingCapture {
    sourceId: string;
    sourceName: string;
    audio: boolean;
    at: number;
}

let pending: PendingCapture | null = null;
type DisplayHandler = Parameters<Electron.Session["setDisplayMediaRequestHandler"]>[0];
/** Handler que o próprio Discord registrou (chamado quando o pedido não é nosso). */
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
        // Sem handler do Discord: nega (comportamento padrão sem handler).
        callback({});
    };

    // Se o Discord registrar (ou trocar) o handler dele, guardamos e mantemos o nosso na frente.
    ses.setDisplayMediaRequestHandler = ((handler: DisplayHandler | null, opts?: Electron.DisplayMediaRequestHandlerOpts) => {
        discordHandler = handler;
        originalSet(combined, opts);
    }) as typeof ses.setDisplayMediaRequestHandler;

    originalSet(combined);
}

// Registrado antes do Discord: roda primeiro no "ready".
app.whenReady().then(installDisplayMediaHandler).catch(e => console.error("[FRD GoLive] handler de display media:", e));

// --- API exposta ao renderer ------------------------------------------------------

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
    /** Dá para transmitir o som SEM o áudio do Discord (a call). */
    excludesDiscord: boolean;
    /** Motivo quando não dá (mostrado no picker). */
    reason?: string;
}

/** O que esta máquina consegue fazer com o áudio da transmissão. */
export function getAudioCaps(_: IpcMainInvokeEvent): AudioCaps {
    if (!IS_WIN) return { excludesDiscord: false, reason: "O macOS não permite capturar o som do sistema." };
    if (!windowsSupportsProcessLoopback()) {
        return { excludesDiscord: false, reason: "Requer Windows 10 (versão 2004) ou mais novo para separar o áudio do Discord." };
    }
    if (!wantInProcessAudio) {
        return { excludesDiscord: false, reason: "Separação do áudio do Discord desligada nas configurações do plugin." };
    }
    // Confere se a flag pegou: com ela, não existe processo de serviço de áudio separado.
    const outOfProcess = app.getAppMetrics().some(m => m.serviceName === "audio.mojom.AudioService");
    if (outOfProcess) {
        return { excludesDiscord: false, reason: "Reinicie o Discord por completo para ativar o som sem o áudio da call." };
    }
    return { excludesDiscord: true };
}

/**
 * Reserva a próxima chamada de getDisplayMedia do renderer para a fonte escolhida
 * no nosso picker (com áudio sem o Discord, se pedido). Vale por 15 s.
 */
export function prepareCapture(_: IpcMainInvokeEvent, sourceId: string, sourceName: string, audio: boolean): void {
    pending = { sourceId, sourceName, audio, at: Date.now() };
}

export function cancelCapture(_: IpcMainInvokeEvent): void {
    pending = null;
}

// --- 3. Ponte de diagnóstico MCP -------------------------------------------------
//
// O MCP local (mcp/) expõe HTTP em 127.0.0.1:8756 com token em
// ~/.frd-golive/mcp-token (0600). Aqui roda o loop: baixa chamadas de
// ferramenta (/poll), enfileira para o renderer (diagPoll, com poll de 100 ms)
// e devolve os resultados (/result). O renderer não fala com a rede direto:
// o CSP do Discord bloquearia http://127.0.0.1 — este processo não tem CSP.
// Tudo só quando a setting [Diagnóstico] "Ponte MCP" está ligada.

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
            // resposta não-JSON (proxy?); status ainda vale
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
            // 1) devolve resultados (o renderer já executou) — sem perder nenhum.
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

            // 2) puxa chamadas (long-poll curto: o servidor responde em ~500 ms).
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
                // Com chamadas novas, volta já ao passo 1 (o renderer responde em ~150 ms);
                // sem chamadas, espera um pouco antes de perguntar de novo.
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

/** Liga a ponte: passo 1 do renderer (startDiagBridge). */
export function diagStart(_: IpcMainInvokeEvent, url: string): void {
    const clean = typeof url === "string" && /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : "";
    diagUrl = clean || "http://127.0.0.1:8756";
    if (diagWanted) return;
    diagWanted = true;
    diagLoopFn().catch(e => console.error("[FRD GoLive] ponte MCP:", e));
}

/** Desliga a ponte e descarta o que estiver pendente. */
export function diagStop(_: IpcMainInvokeEvent): void {
    diagWanted = false;
    diagCalls.length = 0;
    diagResults.length = 0;
}

/** O renderer busca as chamadas pendentes aqui (poll de ~100 ms). */
export function diagPoll(_: IpcMainInvokeEvent): DiagCall[] {
    return diagCalls.splice(0, diagCalls.length);
}

/** O renderer devolve o resultado de uma chamada aqui. */
export function diagReply(_: IpcMainInvokeEvent, payload: DiagResult): void {
    if (payload && typeof payload.id === "string" && typeof payload.ok === "boolean") {
        diagResults.push(payload);
    }
}
