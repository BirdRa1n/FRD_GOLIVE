import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { bundledDistDir, installerCliName, installerCliUrl, userDataDir } from "./paths.js";

/** Copia o Vencord dist (com o plugin) para o diretório de dados do instalador. */
export function ensureBundledDist(): void {
    const src = bundledDistDir();
    if (!existsSync(src) || readdirSync(src).length === 0) {
        throw new Error(
            app.isPackaged
                ? "Bundle do Vencord ausente neste app. Reinstale a partir do .dmg/.exe oficial."
                : "vencord-dist ausente. Gere o bundle: `npm run build:vencord` "
                  + "(ou aponte FRD_VENCORD_DIST para um Vencord/dist já compilado).",
        );
    }
    // Recria o dest limpo para não deixar arquivos velhos de um build anterior.
    const dest = join(userDataDir(), "dist");
    rmSync(dest, { recursive: true, force: true });
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
 * modificação no Discord SEM prompt interativo. As envs replicam o `pnpm inject`.
 *
 * O `-branch` evita o menu "Select Discord install to patch": "auto" detecta o
 * install; ou "stable"/"ptb"/"canary". Override via FRD_DISCORD_BRANCH. Um caminho
 * explícito de Discord pode ser passado em `location` (vira `-location`).
 */
export function runInject(cliPath: string, opts: { branch?: string; location?: string; } = {}): Promise<void> {
    const branch = opts.branch || process.env.FRD_DISCORD_BRANCH || "auto";
    const args = ["-install", "-branch", branch];
    if (opts.location) args.push("-location", opts.location);

    return new Promise((resolve, reject) => {
        const child = spawn(cliPath, args, {
            env: {
                ...process.env,
                VENCORD_USER_DATA_DIR: userDataDir(),
                VENCORD_DEV_INSTALL: "1",
            },
            stdio: "inherit",
        });
        child.on("exit", code => (code === 0
            ? resolve()
            : reject(new Error(`o instalador saiu com código ${code} (feche o Discord e tente de novo)`))));
        child.on("error", reject);
    });
}
