import { join } from "node:path";
import { app } from "electron";

/** Diretório de dados do Vencord que ESTE instalador gerencia (dev-install). */
export function userDataDir(): string {
    return join(app.getPath("userData"), "vencord");
}

/** Vencord dist pré-compilado (com o plugin) empacotado no app — gerado no CI. */
export function bundledDistDir(): string {
    return app.isPackaged
        ? join(process.resourcesPath, "vencord-dist")
        : join(__dirname, "..", "..", "vencord-dist");
}

export function installerCliName(): string {
    return process.platform === "win32" ? "VencordInstallerCli.exe" : "VencordInstallerCli-darwin";
}

export function installerCliUrl(): string {
    return "https://github.com/Vencord/Installer/releases/latest/download/" + installerCliName();
}
