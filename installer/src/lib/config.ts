import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClientConfig {
    signalingUrl: string;
    iceServers: unknown[];
    version: string;
    transport: string;
}

function normalizeHost(host: string): string {
    let h = host.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(h)) h = "https://" + h;
    return h;
}

/** Pergunta ao host toda a config do cliente (o próprio host devolve tudo). */
export async function fetchConfig(host: string): Promise<{ base: string; config: ClientConfig; }> {
    const base = normalizeHost(host);
    const res = await fetch(`${base}/config`);
    if (!res.ok) throw new Error(`o servidor respondeu ${res.status} em /config`);
    const config = await res.json() as ClientConfig;
    return { base, config };
}

/**
 * Grava a config do plugin e as regras de CSP no diretório de dados do Vencord.
 * NOTA: o layout de settings do Vencord pode variar por versão — ver README.
 */
export function writeVencordConfig(dir: string, base: string, config: ClientConfig): string {
    const settingsDir = join(dir, "settings");
    mkdirSync(settingsDir, { recursive: true });

    // 1) settings do plugin
    const settingsFile = join(settingsDir, "settings.json");
    const settings = readJson(settingsFile);
    settings.plugins = (settings.plugins as Record<string, unknown>) ?? {};
    (settings.plugins as Record<string, unknown>).FRDGoLive = {
        enabled: true,
        transport: config.transport === "mesh" ? "mesh" : "sfu",
        tokenServiceUrl: base,
        serverUrl: config.signalingUrl,
        nativeScreenCapture: false,
        nativeTileOverlay: true,
        hijackNativeControls: true,
        unlockNativeVideoGate: true,
    };
    writeFileSync(settingsFile, JSON.stringify(settings, null, 4));

    // 2) CSP: libera o domínio do servidor (connect-src) via customCspRules
    const domain = new URL(base).hostname;
    const nativeFile = join(settingsDir, "native.json");
    const native = readJson(nativeFile);
    const rules = (native.customCspRules as Record<string, string[]>) ?? {};
    for (const host of [`*.${domain}`, domain, `wss://*.${domain}`, `ws://*.${domain}`]) {
        rules[host] = ["connect-src"];
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
