// MCP "frd-discord" — inspeção ao vivo do Discord para o agente.
//
// Duas bocas: stdio (fala MCP com o OpenCode) e HTTP local (fala com o Discord,
// que faz poll via client/src/native.ts e executa no renderer via
// client/src/diagBridge.ts). Setup e playbook: docs/MCP-DIAG.md.
//
// IMPORTANTE: stdout é o protocolo MCP — nunca logue nele (use console.error).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { PORT, TOKEN_FILE, bridgeError, discordOnline, forward, startBridge } from "./bridge.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
    if (typeof data === "string") return { content: [{ type: "text", text: data }] };
    try {
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) ?? String(data) }] };
    } catch {
        return { content: [{ type: "text", text: "[resultado não serializável]" }] };
    }
}

function fail(message: string): ToolResult {
    return { content: [{ type: "text", text: `✗ ${message}` }], isError: true };
}

/** Handler que encaminha a ferramenta para o renderer com timeout. */
function call(tool: string, timeoutMs: number) {
    return async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
            return ok(await forward(tool, args, timeoutMs));
        } catch (e) {
            return fail(e instanceof Error ? e.message : String(e));
        }
    };
}

startBridge();

const server = new McpServer({ name: "frd-discord", version: "0.1.0" });

server.tool(
    "discord_status",
    "Estado da ponte com o Discord (porta, token, se o Discord está conectado e config relevante). Comece por aqui.",
    {},
    async () => ok({
        bridge: bridgeError ?? "ok",
        port: PORT,
        tokenFile: TOKEN_FILE,
        discordOnline: discordOnline(),
    }),
);

server.tool(
    "discord_eval",
    "Executa JavaScript no renderer do Discord (corpo de uma async IIFE) e devolve o resultado com tokens redigidos. Se o CSP bloquear new Function nesta build, use as ferramentas estruturadas (stats/flux/store/probe).",
    { code: z.string().describe("código JS; o valor de return/última expressão assíncrona é o resultado") },
    call("discord_eval", 60_000),
);

server.tool(
    "discord_media_stats",
    'Snapshot das conexões do MediaEngine (neste Discord é UMA, context "default", com áudio e vídeo juntos): videoStreamParameters, sink wants, bitrateTarget, framesEncoded, resolution, frameRate. Entre num canal de voz; o encoder só roda com Go Live ativo.',
    {},
    call("discord_media_stats", 30_000),
);

server.tool(
    "discord_media_watch",
    "Amostra as estatísticas de mídia durante N segundos (útil para ver bitrateTarget/framesEncoded reagirem enquanto você muda algo no servidor).",
    {
        seconds: z.number().int().min(1).max(45).default(10).describe("duração da amostragem"),
        intervalMs: z.number().int().min(100).max(5000).default(500).describe("intervalo entre amostras"),
    },
    call("discord_media_watch", 75_000),
);

server.tool(
    "discord_flux",
    "Grava/dumpa ações do FluxDispatcher do Discord em tempo real. Ligue com um filter (prefixo do type, ex.: \"STREAM\") para reduzir ruído; o interceptor não pode ser desinstalado, mas vira no-op em stop.",
    {
        op: z.enum(["start", "stop", "dump", "clear"]),
        filter: z.string().optional().describe('prefixo do type capturado, ex.: "STREAM" ou "RTC"'),
        tail: z.number().int().min(1).max(2000).default(500).describe("quantos eventos finais o dump devolve"),
    },
    call("discord_flux", 30_000),
);

server.tool(
    "discord_probe",
    "Sonda de protocolo do Go Live (flux + WS de sinalização + chamadas ao discord_voice + HTTP /streams/*), com tokens mascarados. dump devolve os eventos finais (tail).",
    {
        op: z.enum(["start", "stop", "dump", "clear"]),
        tail: z.number().int().min(1).max(3000).default(500).describe("quantos eventos finais o dump devolve"),
    },
    call("discord_probe", 30_000),
);

server.tool(
    "discord_console",
    "Dump do ring buffer de console (log/info/warn/error/debug) do Discord desde que a ponte ligou.",
    {
        op: z.enum(["dump", "clear"]),
        tail: z.number().int().min(1).max(2000).default(200).describe("quantas linhas finais devolver"),
    },
    call("discord_console", 15_000),
);

server.tool(
    "discord_store",
    'Lê uma store do Discord (webpack) pelo nome. Sem method devolve a store redigida; com method, chama a função (ex.: store="MediaEngineStore", method="getMediaEngine").',
    {
        store: z.string().describe('nome da store, ex.: "MediaEngineStore"'),
        method: z.string().optional().describe("função da store a chamar"),
        args: z.array(z.unknown()).default([]).describe("argumentos da função"),
    },
    call("discord_store", 30_000),
);

server.tool(
    "discord_settings",
    'Lê/escreve as settings do plugin FRDGoLive em tempo real. Cuidado: settings com restartNeeded só valem após Ctrl+R no Discord. Lista de chaves: op="get".',
    {
        op: z.enum(["get", "set"]),
        key: z.string().optional().describe("nome da setting (obrigatória em set)"),
        value: z.unknown().optional().describe("novo valor (obrigatório em set)"),
    },
    call("discord_settings", 15_000),
);

server.tool(
    "discord_dispatch",
    'Despacha uma ação FluxDispatcher no Discord. Ex.: {"type":"STREAM_WATCH","guildId":...}. Só para experimentos dirigidos.',
    { action: z.record(z.unknown()).describe('a ação, ex.: {"type":"ALGUMA_ACAO", ...}') },
    call("discord_dispatch", 15_000),
);

server.tool(
    "discord_native",
    'Introspecciona o módulo nativo discord_voice (C++): list=true devolve a superfície (nomes + tipos) — é o que a investigação do encoder deve fazer primeiro. list=false CHAMA a função escolhida: pode travar o Discord, use com cuidado.',
    {
        list: z.boolean().default(true).describe("true = só lista a API (seguro)"),
        method: z.string().optional().describe("nome da função a chamar (ex.: getStats) — só com list=false"),
        args: z.array(z.unknown()).default([]).describe("argumentos da chamada"),
        withCallback: z.boolean().default(false).describe("injeta um callback como último argumento e espera o resultado (getters que exigem 1 função, ex.: getCodecCapabilities)"),
    },
    call("discord_native", 30_000),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[frd-discord-mcp] MCP no ar (stdio) — veja docs/MCP-DIAG.md para o playbook.");
