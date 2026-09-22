#!/usr/bin/env node
// Gera o bundle installer/vencord-dist: um Vencord já compilado COM o plugin
// FRDGoLive embutido. É o que o instalador copia para o diretório de dados e injeta.
//
// Cross-platform (macOS/Windows/Linux). Não exige que o usuário clone nada à mão:
// clona o Vencord num cache FORA do repo, copia client/src, roda pnpm build e
// copia o dist resultante para installer/vencord-dist.
//
// Uso:  node scripts/build-vencord-dist.mjs
// Env:  FRD_BUILD_DIR  diretório de trabalho (default: ~/.frd-golive/build)
//       VENCORD_REPO   repositório do Vencord (default: upstream oficial)

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INSTALLER_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(INSTALLER_DIR, "..");
const CLIENT_SRC = join(REPO_ROOT, "client", "src");
const OUT_DIST = join(INSTALLER_DIR, "vencord-dist");

const VENCORD_REPO = process.env.VENCORD_REPO || "https://github.com/Vendicated/Vencord";
const BUILD_DIR = process.env.FRD_BUILD_DIR || join(homedir(), ".frd-golive", "build");
const VENCORD_DIR = join(BUILD_DIR, "Vencord");

const isWin = process.platform === "win32";

function log(msg) { process.stdout.write(`\x1b[1;34m›\x1b[0m ${msg}\n`); }
function ok(msg) { process.stdout.write(`\x1b[1;32m✓\x1b[0m ${msg}\n`); }
function die(msg) { process.stderr.write(`\x1b[1;31m✗ ${msg}\x1b[0m\n`); process.exit(1); }

/** Roda um comando herdando stdio; lança em falha. `cmd` resolvido no PATH. */
function run(cmd, args, cwd) {
    // No Windows, executáveis de npm são .cmd → precisam de shell.
    execFileSync(cmd, args, { cwd, stdio: "inherit", shell: isWin });
}

/** Retorna a saída de um comando (trim), ou null se ele falhar. */
function tryOut(cmd, args) {
    try {
        return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"], shell: isWin })
            .toString().trim();
    } catch { return null; }
}

/** Descobre como invocar o pnpm: pnpm direto, senão via corepack. */
function resolvePnpm() {
    if (tryOut("pnpm", ["--version"])) return { cmd: "pnpm", pre: [] };
    log("pnpm não encontrado — habilitando via corepack (vem com o Node)…");
    try { run("corepack", ["enable"]); } catch { /* pode exigir admin; corepack pnpm ainda funciona */ }
    if (tryOut("corepack", ["pnpm", "--version"])) return { cmd: "corepack", pre: ["pnpm"] };
    die("pnpm indisponível e o corepack falhou. Instale o pnpm (https://pnpm.io/installation) e rode de novo.");
    return null;
}

function main() {
    log(`Repo:        ${REPO_ROOT}`);
    log(`Build cache: ${BUILD_DIR}`);
    log(`Saída:       ${OUT_DIST}`);

    if (!existsSync(CLIENT_SRC)) die(`client/src não encontrado em ${CLIENT_SRC}. Rode dentro do repositório.`);
    if (!tryOut("git", ["--version"])) die("git não encontrado. Instale o git e rode de novo.");
    if (!tryOut("node", ["--version"])) die("node não encontrado.");

    const pnpm = resolvePnpm();
    const pnpmRun = (args, cwd) => run(pnpm.cmd, [...pnpm.pre, ...args], cwd);

    mkdirSync(BUILD_DIR, { recursive: true });

    // 1. Clonar/atualizar o Vencord FORA do repo (evita o pnpm "subir" e usar o
    //    package.json errado, e mantém nosso repo limpo).
    if (existsSync(join(VENCORD_DIR, ".git"))) {
        log("Atualizando o Vencord…");
        try { run("git", ["-C", VENCORD_DIR, "pull", "--ff-only"]); }
        catch { log("git pull falhou (ok, seguindo com o clone existente)."); }
    } else {
        log("Clonando o Vencord…");
        run("git", ["clone", "--depth", "1", VENCORD_REPO, VENCORD_DIR]);
    }

    // 2. Dependências (inclui a do plugin).
    log("Instalando dependências do Vencord (pnpm install)…");
    pnpmRun(["install", "--frozen-lockfile=false"], VENCORD_DIR);
    log("Adicionando livekit-client (dependência do plugin)…");
    pnpmRun(["add", "livekit-client"], VENCORD_DIR);

    // 3. Copiar o plugin (client/src → src/userplugins/frdGoLive). COPIAR, não symlink.
    const pluginDir = join(VENCORD_DIR, "src", "userplugins", "frdGoLive");
    log("Copiando o plugin para o Vencord…");
    rmSync(pluginDir, { recursive: true, force: true });
    mkdirSync(dirname(pluginDir), { recursive: true });
    cpSync(CLIENT_SRC, pluginDir, { recursive: true });

    // 4. Build.
    log("Compilando o Vencord com o plugin (pnpm build)…");
    pnpmRun(["build"], VENCORD_DIR);

    // 5. Copiar o dist para o instalador.
    const builtDist = join(VENCORD_DIR, "dist");
    if (!existsSync(builtDist) || readdirSync(builtDist).length === 0) {
        die("o build não produziu um dist/ — verifique a saída acima.");
    }
    log("Publicando o bundle em installer/vencord-dist…");
    rmSync(OUT_DIST, { recursive: true, force: true });
    mkdirSync(OUT_DIST, { recursive: true });
    cpSync(builtDist, OUT_DIST, { recursive: true });

    const n = readdirSync(OUT_DIST).length;
    ok(`Bundle pronto: ${OUT_DIST} (${n} itens).`);
    ok("Agora rode o instalador: npm start (ou empacote com npm run dist).");
}

try {
    main();
} catch (e) {
    die(e && e.message ? e.message : String(e));
}
