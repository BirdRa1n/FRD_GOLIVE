import { join } from "node:path";
import { app } from "electron";

export function userDataDir(): string {
    return join(app.getPath("appData"), "Vencord");
}

export function bundledDistDir(): string {
    const override = process.env.FRD_VENCORD_DIST;
    if (override) return override;
    if (app.isPackaged) return join(process.resourcesPath, "vencord-dist");
    return join(__dirname, "..", "..", "vencord-dist");
}

export function installerCliName(): string {
    if (process.platform === "win32") return "VencordInstallerCli.exe";
    if (process.platform === "linux") return "VencordInstallerCli-linux";
    return "VencordInstallerCli-darwin";
}

export function installerCliUrl(): string {
    return "https://github.com/Vencord/Installer/releases/latest/download/" + installerCliName();
}
