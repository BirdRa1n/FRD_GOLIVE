import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { bundledDistDir, installerCliName, installerCliUrl, userDataDir } from "./paths.js";

/** Copia o Vencord dist empacotado (com o plugin) para o diretório de dados. */
export function ensureBundledDist(): void {
    const src = bundledDistDir();
    if (!existsSync(src)) {
        throw new Error("Vencord dist não encontrado no app (bundle do CI ausente). Ver README.");
    }
    const dest = join(userDataDir(), "dist");
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
}

/** Baixa o Vencord Installer CLI da release oficial (por plataforma). */
export async function downloadInstallerCli(): Promise<string> {
    const dir = join(app.getPath("temp"), "frd-golive");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, installerCliName());
    if (existsSync(file)) return file;

    const res = await fetch(installerCliUrl());
    if (!res.ok) throw new Error(`download do instalador falhou (${res.status})`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    if (process.platform !== "win32") chmodSync(file, 0o755);
    return file;
}

/**
 * Roda o Installer CLI apontando para o NOSSO build (dev-install), aplicando a
 * modificação no Discord. As envs replicam o que o `pnpm inject` faz.
 */
export function runInject(cliPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cliPath, ["-install"], {
            env: {
                ...process.env,
                VENCORD_USER_DATA_DIR: userDataDir(),
                VENCORD_DEV_INSTALL: "1",
            },
            stdio: "inherit",
        });
        child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`o instalador saiu com código ${code}`))));
        child.on("error", reject);
    });
}
