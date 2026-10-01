import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export interface Prefs {
    host?: string;
}

function dir(): string {
    return app.getPath("userData");
}
function prefsFile(): string {
    return join(dir(), "installer-config.json");
}
function iconDir(): string {
    return join(dir(), "group-icons");
}

export function loadPrefs(): Prefs {
    try { return JSON.parse(readFileSync(prefsFile(), "utf-8")) as Prefs; }
    catch { return {}; }
}

export function savePrefs(p: Prefs): void {
    try { mkdirSync(dir(), { recursive: true }); writeFileSync(prefsFile(), JSON.stringify(p, null, 2)); }
    catch { /* melhor esforço */ }
}

export function rememberHost(host: string): void {
    const prev = loadPrefs();
    if (prev.host === host) return;
    savePrefs({ ...prev, host });
}

export async function cachedIconDataUrl(url: string): Promise<string | undefined> {
    const file = join(iconDir(), createHash("sha1").update(url).digest("hex") + ".png");
    if (existsSync(file)) {
        try { return "data:image/png;base64," + readFileSync(file).toString("base64"); }
        catch { /* rebaixa */ }
    }
    try {
        const res = await fetch(url);
        if (!res.ok) return undefined;
        const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        if (buf.byteLength > 512 * 1024) return undefined;
        try { mkdirSync(iconDir(), { recursive: true }); writeFileSync(file, buf); } catch { /* melhor esforço */ }
        return "data:image/png;base64," + buf.toString("base64");
    } catch {
        return undefined;
    }
}
