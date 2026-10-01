
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
    return false; // nunca bloqueia os eventos — só reescreve o endpoint
}

function patchIdentifyDave(): void {
    if (wsPatched) return;
    wsPatched = true;

    const proto = WebSocket.prototype;
    const originalSend = proto.send;
    proto.send = function (this: WebSocket, data: Parameters<typeof originalSend>[0]): void {
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
        }
        return originalSend.call(this, data);
    };
}

export function isNativeStreamConnection(conn: { endpoint?: unknown; } | null | undefined): boolean {
    return !!endpoint && typeof conn?.endpoint === "string" && conn.endpoint.includes(endpoint);
}

export function setNativeStreamEndpoint(target: string): void {
    endpoint = target.trim().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
    if (endpoint && !installed) {
        FluxDispatcher.addInterceptor(interceptor);
        installed = true;
    }
    if (endpoint) patchIdentifyDave();
}
