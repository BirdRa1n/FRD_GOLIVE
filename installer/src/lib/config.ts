import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClientConfig {
    nativeStreamEndpoint: string;
    mediaHost: string; // IP/host público da mídia (UDP) — informativo
    version: string;
    transport: string;
}

function normalizeHost(host: string): string {
    let h = host.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(h)) h = "https://" + h;
    return h;
}

export async function fetchConfig(host: string): Promise<{ base: string; config: ClientConfig; }> {
    const base = normalizeHost(host);
    const res = await fetch(`${base}/config`);
    if (!res.ok) throw new Error(`o servidor respondeu ${res.status} em /config`);
    const config = await res.json() as ClientConfig;
    return { base, config };
}

export function writeVencordConfig(dir: string, base: string, config: ClientConfig): string {
    const settingsDir = join(dir, "settings");
    mkdirSync(settingsDir, { recursive: true });

    const domain = new URL(base).hostname;
    const endpoint = config.nativeStreamEndpoint || `${domain}/dstream`;
    const settingsFile = join(settingsDir, "settings.json");
    const settings = readJson(settingsFile);
    settings.plugins = (settings.plugins as Record<string, unknown>) ?? {};
    (settings.plugins as Record<string, unknown>).FRDGoLive = {
        enabled: true,
        nativeStreamEndpoint: endpoint, // o Go Live nativo é redirecionado para cá (vídeo+áudio)
        nativeStreamDave: true, // E2EE (MLS) no áudio da transmissão
        hijackNativeControls: false,
        unlockNativeVideoGate: true, // libera os botões nativos em regiões censuradas
    };
    writeFileSync(settingsFile, JSON.stringify(settings, null, 4));

    const hosts = new Set<string>([domain]);
    try { const h = endpoint.replace(/^wss?:\/\//, "").split("/")[0]; if (h) hosts.add(h); } catch { /* endpoint inválido */ }

    const nativeFile = join(settingsDir, "native-settings.json");
    const native = readJson(nativeFile);
    const rules = (native.customCspRules as Record<string, string[]>) ?? {};
    for (const h of hosts) {
        for (const key of [h, `*.${h}`, `wss://${h}`, `wss://*.${h}`]) {
            rules[key] = ["connect-src"];
        }
    }
    native.customCspRules = rules;
    writeFileSync(nativeFile, JSON.stringify(native, null, 4));

    return domain;
}

function readJson(file: string): Record<string, unknown> {
    if (existsSync(file)) {
        try { return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>; }
        catch { /* recomeça */ }
    }
    return {};
}
