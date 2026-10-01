import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";

import { fetchConfig, writeVencordConfig } from "./lib/config.js";
import { downloadInstallerCli, ensureBundledDist, runInject } from "./lib/inject.js";
import { userDataDir } from "./lib/paths.js";
import { cachedIconDataUrl, loadPrefs, rememberHost } from "./lib/store.js";
import { currentUpdateState, initUpdater, openReleasePage, setBusy } from "./lib/updater.js";

function normalizeHost(host: string): string {
    let h = (host || "").trim().replace(/\/+$/, "");
    if (h && !/^https?:\/\//i.test(h)) h = "https://" + h;
    return h;
}

function createWindow(): void {
    const win = new BrowserWindow({
        width: 560,
        height: 680,
        resizable: false,
        title: "FRD GoLive",
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0a12" : "#f4f3fa",
        ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
        webPreferences: { preload: join(__dirname, "preload.js") },
    });
    initUpdater(win);
    void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("defaults", () => ({ host: loadPrefs().host ?? "", version: app.getVersion() }));
ipcMain.handle("update-state", () => currentUpdateState());
ipcMain.handle("open-release", () => openReleasePage());

interface Probe {
    ok: boolean;
    latencyMs?: number;
    version?: string;
    transport?: string;
    authMode?: string;
    oauth?: boolean;
    error?: string;
}

ipcMain.handle("probe", async (_e, host: string): Promise<Probe> => {
    const base = normalizeHost(host);
    if (!base) return { ok: false, error: "empty" };
    const started = Date.now();
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const [healthRes, configRes] = await Promise.all([
            fetch(base + "/health", { signal: ctrl.signal, cache: "no-store" }),
            fetch(base + "/config", { signal: ctrl.signal, cache: "no-store" }),
        ]);
        clearTimeout(t);
        if (!healthRes.ok) throw new Error("HTTP " + healthRes.status);
        const h = await healthRes.json() as { version?: string; transport?: string; };
        const cfg = configRes.ok ? await configRes.json() as { authMode?: string; oauth?: boolean; } : {};
        rememberHost(base);
        return { ok: true, latencyMs: Date.now() - started, version: h.version, transport: h.transport, authMode: cfg.authMode, oauth: cfg.oauth };
    } catch (e) {
        return { ok: false, error: (e as Error).name === "AbortError" ? "timeout" : (e as Error).message };
    }
});

ipcMain.handle("groups", async (_e, host: string) => {
    const base = normalizeHost(host);
    if (!base) return [];
    try {
        const res = await fetch(base + "/groups", { cache: "no-store" });
        if (!res.ok) return [];
        const list = await res.json() as { guildId: string; guildName: string; icon?: string; }[];
        return Promise.all(list.map(async g => ({
            guildId: g.guildId,
            guildName: g.guildName,
            icon: g.icon ? await cachedIconDataUrl(g.icon) : undefined,
        })));
    } catch {
        return [];
    }
});

ipcMain.handle("apply", async (_e, host: string) => {
    setBusy(true);
    try {
        const { base, config } = await fetchConfig(host);
        rememberHost(base);
        ensureBundledDist();
        const domain = writeVencordConfig(userDataDir(), base, config);
        const cli = await downloadInstallerCli();
        await runInject(cli);
        return { ok: true, domain, transport: config.transport };
    } finally {
        setBusy(false);
    }
});

ipcMain.handle("open-hub", (_e, host: string) => {
    const base = normalizeHost(host);
    if (base) return shell.openExternal(base);
});
