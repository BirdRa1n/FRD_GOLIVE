// Auto-update do instalador via GitHub Releases (electron-updater).
//
// Ao abrir o app empacotado: procura uma release nova em BirdRa1n/FRD_GOLIVE
// (config `publish` do electron-builder.yml), baixa e reinicia já atualizado.
// Se o usuário estiver aplicando a modificação nessa hora, espera terminar.
//
// macOS: o Squirrel.Mac só aceita atualizar apps ASSINADOS (Developer ID). Num
// build sem assinatura a instalação falha — então caímos para "baixe a nova
// versão" com o link da release, em vez de travar.

import { app, type BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";

export type UpdateState =
    | { state: "disabled"; }
    | { state: "checking"; }
    | { state: "none"; }
    | { state: "downloading"; version: string; percent: number; }
    | { state: "installing"; version: string; }
    | { state: "manual"; version: string; url: string; }
    | { state: "error"; message: string; };

const RELEASES_URL = "https://github.com/BirdRa1n/FRD_GOLIVE/releases/latest";

let win: BrowserWindow | null = null;
let last: UpdateState = { state: "disabled" };
let busy = false; // aplicando a modificação: não reiniciar no meio
let pendingInstall = false;
let availableVersion = "";

function emit(s: UpdateState): void {
    last = s;
    win?.webContents.send("update-status", s);
}

export function currentUpdateState(): UpdateState {
    return last;
}

/** Marca que o app está no meio do "Aplicar" (adiamos o reinício). */
export function setBusy(value: boolean): void {
    busy = value;
    if (!busy && pendingInstall) install();
}

function install(): void {
    pendingInstall = false;
    emit({ state: "installing", version: availableVersion });
    // dá tempo da UI mostrar "Reiniciando…"
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
}

export function openReleasePage(): void {
    void shell.openExternal(RELEASES_URL);
}

export function initUpdater(window: BrowserWindow): void {
    win = window;

    // Em dev (npm start) não há release para comparar.
    if (!app.isPackaged || process.env.FRD_DISABLE_UPDATES === "1") {
        emit({ state: "disabled" });
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = console;

    autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
    autoUpdater.on("update-not-available", () => emit({ state: "none" }));
    autoUpdater.on("update-available", info => {
        availableVersion = info.version;
        emit({ state: "downloading", version: info.version, percent: 0 });
    });
    autoUpdater.on("download-progress", p => {
        emit({ state: "downloading", version: availableVersion, percent: Math.round(p.percent) });
    });
    autoUpdater.on("update-downloaded", info => {
        availableVersion = info.version;
        if (busy) {
            pendingInstall = true; // instala quando o "Aplicar" terminar
            emit({ state: "downloading", version: info.version, percent: 100 });
        } else {
            install();
        }
    });
    autoUpdater.on("error", err => {
        const message = err?.message ?? String(err);
        // Build sem assinatura no macOS: não dá para trocar o app sozinho.
        if (process.platform === "darwin" && availableVersion && /code signature|signature|not signed|Could not get code|code requirement|did not pass validation/i.test(message)) {
            emit({ state: "manual", version: availableVersion, url: RELEASES_URL });
            return;
        }
        emit({ state: "error", message });
    });

    // Espera a janela carregar para a UI receber os eventos desde o início.
    window.webContents.once("did-finish-load", () => {
        autoUpdater.checkForUpdates().catch(err => emit({ state: "error", message: String(err?.message ?? err) }));
    });
}
