// Ponte local do MCP: HTTP em 127.0.0.1 falando com o Discord.
//
// Fluxo: o processo main do Electron (client/src/native.ts) faz POST /poll aqui
// para baixar chamadas de ferramenta; o renderer (client/src/diagBridge.ts)
// executa e o main devolve em POST /result. O renderer NUNCA fala com a rede:
// o CSP do Discord bloquearia conectar em 127.0.0.1, e o processo principal não
// tem essa restrição.
//
// Segurança: bind só em 127.0.0.1 + token em ~/.frd-golive/mcp-token (0600).
// Uma ponte por vez: se a porta estiver ocupada (outra sessão do OpenCode
// rodando o mesmo mcp/), os tools respondem o erro em vez de funcionar às
// avessas.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TOKEN_FILE = join(homedir(), ".frd-golive", "mcp-token");
export const PORT = Number(process.env.FRD_MCP_PORT ?? 8756);
const HOST = "127.0.0.1";
/** Quanto tempo /poll fica em espera com a fila vazia (polling leve). */
const HOLD_MS = 500;
/** Sem poll há tanto tempo → Discord ausente. */
const PRESENCE_MS = 15_000;

export interface Call {
    id: string;
    tool: string;
    args: Record<string, unknown>;
}

/** Erro da ponte (porta ocupada etc.) — os tools falham rápido com ele. */
export let bridgeError: string | null = null;

let lastSeenAt = 0;
let token = "";

const queue: Call[] = [];
const waiters = new Set<{ resolve: () => void; timer: ReturnType<typeof setTimeout>; }>();
const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}>();

export function discordOnline(): boolean {
    return !bridgeError && Date.now() - lastSeenAt < PRESENCE_MS;
}

function ensureToken(): void {
    try {
        if (existsSync(TOKEN_FILE)) {
            token = readFileSync(TOKEN_FILE, "utf8").trim();
            if (token) return;
        }
    } catch {
        // sem permissão de leitura → recria abaixo
    }
    token = randomBytes(24).toString("hex");
    mkdirSync(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    try {
        chmodSync(TOKEN_FILE, 0o600);
    } catch {
        // best effort (Windows cuida disso de outro jeito)
    }
}

function takeQueue(): Call[] {
    return queue.splice(0, queue.length);
}

function releaseWaiter(): void {
    const waiter = waiters.values().next().value;
    if (waiter) waiter.resolve();
}

/** Manda uma ferramenta para o renderer e espera o resultado (ou o timeout). */
export async function forward(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number,
): Promise<unknown> {
    if (bridgeError) throw new Error(bridgeError);
    if (!discordOnline()) {
        throw new Error(
            "Discord ausente — ligue a setting [Diagnóstico] \"Ponte MCP\" no FRDGoLive, "
            + "reinicie o Discord (Ctrl+R) e tente de novo (ou veja discord_status).",
        );
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const result = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`O Discord não respondeu "${tool}" em ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
    });
    queue.push({ id, tool, args });
    releaseWaiter();
    return result;
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer) => {
            data += String(chunk);
            if (data.length > 8 * 1024 * 1024) reject(new Error("corpo grande demais"));
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
    if (res.writableEnded) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
}

/** Long-poll curto: devolve chamadas pendentes ou espera até HOLD_MS. */
async function handlePoll(res: http.ServerResponse): Promise<void> {
    lastSeenAt = Date.now();
    if (queue.length) {
        send(res, 200, { calls: takeQueue() });
        return;
    }
    await new Promise<void>(resolve => {
        const waiter = {
            timer: setTimeout(() => {
                waiters.delete(waiter);
                resolve();
            }, HOLD_MS),
            resolve: () => {
                clearTimeout(waiter.timer);
                waiters.delete(waiter);
                resolve();
            },
        };
        waiters.add(waiter);
    });
    send(res, 200, { calls: takeQueue() });
}

function handleResult(payload: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown; }, res: http.ServerResponse): void {
    lastSeenAt = Date.now();
    const id = typeof payload?.id === "string" ? payload.id : null;
    const waiter = id ? pending.get(id) : undefined;
    if (!id || !waiter) {
        // timeout já resolveu (ou id desconhecido): responde e segue.
        send(res, 200, { stale: true });
        return;
    }
    clearTimeout(waiter.timer);
    pending.delete(id);
    if (payload.ok) waiter.resolve(payload.result);
    else waiter.reject(new Error(typeof payload.error === "string" ? payload.error : "erro desconhecido no renderer"));
    send(res, 200, {});
}

export function startBridge(): void {
    ensureToken();
    const server = http.createServer((req, res) => {
        void (async () => {
            if (req.method !== "POST") {
                send(res, 405, { error: "só POST" });
                return;
            }
            const auth = req.headers.authorization ?? "";
            if (auth !== `Bearer ${token}`) {
                send(res, 401, { error: "token inválido (o arquivo do token trocou? apague-o e reinicie o OpenCode)" });
                return;
            }
            let payload: Record<string, unknown>;
            try {
                const raw = await readBody(req);
                payload = JSON.parse(raw || "{}") as Record<string, unknown>;
            } catch {
                send(res, 400, { error: "JSON inválido" });
                return;
            }
            try {
                if (req.url === "/poll") {
                    await handlePoll(res);
                    return;
                }
                if (req.url === "/result") {
                    handleResult(payload, res);
                    return;
                }
                send(res, 404, { error: "rota desconhecida" });
            } catch (e) {
                send(res, 500, { error: String(e) });
            }
        })();
    });

    server.on("error", (e: NodeJS.ErrnoException) => {
        bridgeError = e.code === "EADDRINUSE"
            ? `porta ${PORT} em uso (outra sessão do OpenCode com o mcp/? feche-a ou rode com FRD_MCP_PORT=...).`
            : `falha na ponte: ${String(e)}`;
        console.error(`[frd-discord-mcp] ${bridgeError}`);
    });
    server.listen(PORT, HOST, () => {
        console.error(`[frd-discord-mcp] ponte em http://${HOST}:${PORT} (token ${TOKEN_FILE})`);
    });
}
