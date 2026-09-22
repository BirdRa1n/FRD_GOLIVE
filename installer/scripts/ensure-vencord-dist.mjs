#!/usr/bin/env node
// Garante que installer/vencord-dist exista antes de rodar/empacotar o app.
// Se faltar (ou estiver vazio), dispara o build cross-platform. Idempotente: em
// execuções seguintes só confirma e sai — não recompila à toa.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIST = resolve(SCRIPT_DIR, "..", "vencord-dist");

const has = existsSync(OUT_DIST) && readdirSync(OUT_DIST).length > 0;
if (has) {
    process.stdout.write("\x1b[1;32m✓\x1b[0m vencord-dist presente — pulando build (use `npm run build:vencord` para recompilar).\n");
    process.exit(0);
}

process.stdout.write("\x1b[1;34m›\x1b[0m vencord-dist ausente — gerando o bundle (1ª vez pode demorar)…\n");
// Roda com o MESMO node (process.execPath) — sem shell, cross-platform.
execFileSync(process.execPath, [join(SCRIPT_DIR, "build-vencord-dist.mjs")], { stdio: "inherit" });
