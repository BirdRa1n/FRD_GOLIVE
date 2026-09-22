import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";

import { fetchConfig, writeVencordConfig } from "./lib/config.js";
import { downloadInstallerCli, ensureBundledDist, runInject } from "./lib/inject.js";
import { userDataDir } from "./lib/paths.js";

const HUB_URL = process.env.FRD_HUB_URL ?? "http://golivefrd.birdra1n.com";
const DEFAULT_HOST = process.env.FRD_DEFAULT_HOST ?? "https://golivefrd.birdra1n.com";

function createWindow(): void {
    const win = new BrowserWindow({
        width: 560,
        height: 640,
        resizable: false,
        title: "FRD GoLive",
        webPreferences: { preload: join(__dirname, "preload.js") },
    });
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

ipcMain.handle("defaults", () => ({ defaultHost: DEFAULT_HOST, hubUrl: HUB_URL }));

ipcMain.handle("apply", async (_e, host: string) => {
    // 1. o host devolve toda a config
    const { base, config } = await fetchConfig(host);
    // 2. coloca o build (com o plugin) no diretório de dados
    ensureBundledDist();
    // 3. grava config do plugin + regras de CSP do domínio
    const domain = writeVencordConfig(userDataDir(), base, config);
    // 4. aplica a modificação no Discord
    const cli = await downloadInstallerCli();
    await runInject(cli);
    return { ok: true, domain, transport: config.transport };
});

ipcMain.handle("open-hub", () => shell.openExternal(HUB_URL));
