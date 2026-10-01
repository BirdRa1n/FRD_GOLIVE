
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

const RELEASES_URL = "https://github.com/your-org/your-repo/releases/latest";

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

export function setBusy(value: boolean): void {
    busy = value;
    if (!busy && pendingInstall) install();
}

function install(): void {
    pendingInstall = false;
    emit({ state: "installing", version: availableVersion });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
}

export function openReleasePage(): void {
    void shell.openExternal(RELEASES_URL);
}

export function initUpdater(window: BrowserWindow): void {
    win = window;

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
        if (process.platform === "darwin" && availableVersion && /code signature|signature|not signed|Could not get code|code requirement|did not pass validation/i.test(message)) {
            emit({ state: "manual", version: availableVersion, url: RELEASES_URL });
            return;
        }
        emit({ state: "error", message });
    });

    window.webContents.once("did-finish-load", () => {
        autoUpdater.checkForUpdates().catch(err => emit({ state: "error", message: String(err?.message ?? err) }));
    });
}
