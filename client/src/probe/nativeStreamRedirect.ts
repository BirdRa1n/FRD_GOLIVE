// PoC: manda a conexão de transmissão do Go Live NATIVO para o nosso servidor
// (server/src/nativeStream.ts) em vez do servidor de mídia do Discord.
//
// O gateway entrega o servidor de mídia em STREAM_SERVER_UPDATE.endpoint
// ("c-gru13-….discord.media:2096") e o Discord abre wss://<endpoint>/?v=9 no
// mesmo tick — por isso é um INTERCEPTOR (roda antes das stores), não subscribe.
// Vale para quem transmite e para quem assiste: os dois precisam do plugin.

import { FluxDispatcher } from "@webpack/common";

let endpoint = "";
let installed = false;

function interceptor(action: { type?: string; endpoint?: string | null; streamKey?: string; }): boolean {
    if (endpoint && action.type === "STREAM_SERVER_UPDATE") {
        console.log("[FRD GoLive] transmissão nativa redirecionada:", action.streamKey, action.endpoint, "→", endpoint);
        action.endpoint = endpoint;
    }
    return false; // nunca bloqueia o evento
}

/**
 * O cliente recusa `dave_protocol_version: 0` ("Refusing DAVE protocol downgrade",
 * close 4804) — proteção contra o servidor desligar a E2EE. O patch em index.tsx
 * libera o DAVE 0 SÓ para conexões com o nosso endpoint; as do Discord seguem protegidas.
 * No nosso servidor o vídeo fica cifrado só no transporte (o servidor vê o conteúdo).
 */
export function isNativeStreamConnection(conn: { endpoint?: unknown; } | null | undefined): boolean {
    return !!endpoint && typeof conn?.endpoint === "string" && conn.endpoint.includes(endpoint);
}

/** `target` ex.: "golivefrd.SEU.com/dstream" (sem esquema — o Discord prefixa wss://). Vazio desliga. */
export function setNativeStreamEndpoint(target: string): void {
    endpoint = target.trim().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
    if (endpoint && !installed) {
        // O dispatcher não tem removeInterceptor: fica instalado e vira no-op com endpoint vazio.
        FluxDispatcher.addInterceptor(interceptor);
        installed = true;
    }
}
