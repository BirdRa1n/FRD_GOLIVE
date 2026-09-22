import { join } from "node:path";
import { app } from "electron";

/** Diretório de dados do Vencord que ESTE instalador gerencia (dev-install). */
export function userDataDir(): string {
    return join(app.getPath("userData"), "vencord");
}

/**
 * Vencord dist pré-compilado (com o plugin). Ordem de resolução:
 *   1. FRD_VENCORD_DIST (override explícito — útil em dev/CI);
 *   2. produção: dentro dos resources do app empacotado (extraResources);
 *   3. dev: installer/vencord-dist (gerado por scripts/build-vencord-dist.mjs).
 * Em dev, __dirname é dist/lib → sobe dois níveis até a raiz do instalador.
 */
export function bundledDistDir(): string {
    const override = process.env.FRD_VENCORD_DIST;
    if (override) return override;
    if (app.isPackaged) return join(process.resourcesPath, "vencord-dist");
    return join(__dirname, "..", "..", "vencord-dist");
}

export function installerCliName(): string {
    return process.platform === "win32" ? "VencordInstallerCli.exe" : "VencordInstallerCli-darwin";
}

export function installerCliUrl(): string {
    return "https://github.com/Vencord/Installer/releases/latest/download/" + installerCliName();
}
