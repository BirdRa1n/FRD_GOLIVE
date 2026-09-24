// PoC: manda a conexão de transmissão do Go Live NATIVO para o nosso servidor
// (server/src/nativeStream.ts) em vez do servidor de mídia do Discord.
//
// O gateway entrega o servidor de mídia em STREAM_SERVER_UPDATE.endpoint
// ("c-gru13-….discord.media:2096") e o Discord abre wss://<endpoint>/?v=9 no
// mesmo tick — por isso é um INTERCEPTOR (roda antes das stores), não subscribe.
// Vale para quem transmite e para quem assiste: os dois precisam do plugin.

import { FluxDispatcher } from "@webpack/common";

import { settings } from "../settings";

let endpoint = "";
let installed = false;
let wsPatched = false;

function interceptor(action: { type?: string; endpoint?: string | null; streamKey?: string; }): boolean {
    if (endpoint && action.type === "STREAM_SERVER_UPDATE") {
        console.log("[FRD GoLive] transmissão nativa redirecionada:", action.streamKey, action.endpoint, "→", endpoint);
        action.endpoint = endpoint;
    }
    // Híbrido: nas conexões redirecionadas o vídeo nativo nunca fica "pronto" (o encoder não
    // produz frames), e o Discord mataria o stream com o Erro 2012. Bloqueamos o timeout para
    // manter a conexão viva (áudio E2EE + shell) — o vídeo real vem do LiveKit (nativeTileInject).
    if (endpoint && settings.store.nativeStreamHybrid && action.type === "VIDEO_STREAM_READY_TIMEOUT") {
        console.log("[FRD GoLive] híbrido: bloqueando VIDEO_STREAM_READY_TIMEOUT (Erro 2012)");
        return true; // bloqueia o dispatch → o stream não morre
    }
    return false; // nunca bloqueia os demais eventos
}

/**
 * Caminho A: fazer o cliente anunciar `max_dave_protocol_version: 0` já no IDENTIFY,
 * em vez de anunciar suporte a DAVE e depois aceitar um downgrade forçado pelo servidor
 * (op 4 com `dave_protocol_version: 0`, o que dispara "Refusing DAVE protocol downgrade"
 * / close 4804 e pode deixar o encoder de vídeo nativo travado numa transição pendente).
 *
 * O IDENTIFY (op 0) do gateway de stream é um frame de texto enviado pelo JS no WS.
 * Envolvemos `WebSocket.prototype.send` e reescrevemos o campo SÓ para sockets do nosso
 * endpoint — as conexões com o Discord seguem intactas (E2EE preservada lá).
 */
function patchIdentifyDave(): void {
    if (wsPatched) return;
    wsPatched = true;

    const proto = WebSocket.prototype;
    const originalSend = proto.send;
    proto.send = function (this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        try {
            if (
                endpoint &&
                !settings.store.nativeStreamDave && // com DAVE ligado, deixa o cliente anunciar max_dave real
                typeof data === "string" &&
                data.includes("\"max_dave_protocol_version\"") &&
                typeof this.url === "string" &&
                this.url.includes(endpoint)
            ) {
                const msg = JSON.parse(data);
                if (msg?.op === 0 && msg.d && msg.d.max_dave_protocol_version) {
                    msg.d.max_dave_protocol_version = 0;
                    console.log("[FRD GoLive] IDENTIFY: max_dave_protocol_version → 0 (Caminho A)");
                    return originalSend.call(this, JSON.stringify(msg));
                }
            }
        } catch {
            // qualquer erro: manda o frame original intacto
        }
        return originalSend.call(this, data);
    };
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
    // Escopo do patch é `this.url.includes(endpoint)`; sem endpoint vira no-op.
    if (endpoint) patchIdentifyDave();
}
