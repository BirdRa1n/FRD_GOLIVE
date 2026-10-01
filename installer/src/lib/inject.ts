import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { bundledDistDir, installerCliName, installerCliUrl, userDataDir } from "./paths.js";

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
    const dest = join(userDataDir(), "dist");
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
}

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
