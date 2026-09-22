// Painel admin opcional do servidor: mostra a versão atual vs. a do repositório
// e dispara uma atualização do código a partir do repo configurado (UPDATE_REPO).
//
// A atualização é feita por um container `updater` INDEPENDENTE, lançado via o
// socket do Docker — assim ele sobrevive à recriação do próprio token-service
// durante o `docker compose up --build`.
//
// Habilitado só quando ADMIN_UI=on, e o socket do Docker deve ser montado
// (ver docker-compose.admin.yml). Mantenha este painel atrás de uma rede
// privada (ex.: Tailscale) — ele controla o deploy.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";

const run = promisify(execFile);

export interface AdminConfig {
    updateRepo: string;
    updateBranch: string;
    /** Caminho do repo DENTRO do container (para ler a versão via git). */
    repoDir: string;
    /** Caminho do repo NO HOST (para montar no container updater). */
    hostRepoDir: string;
    /** Validação do segredo da organização (reaproveitada do index). */
    secretMatches: (provided: unknown) => boolean;
}

export function createAdminRouter(cfg: AdminConfig): Router {
    const router = Router();

    router.get("/", (_req, res) => {
        res.type("html").send(ADMIN_HTML);
    });

    router.get("/version", async (_req, res) => {
        try {
            const current = (await run("git", ["-C", cfg.repoDir, "rev-parse", "--short", "HEAD"])).stdout.trim();
            const ls = (await run("git", ["ls-remote", cfg.updateRepo, cfg.updateBranch])).stdout.trim();
            const remote = ls.split(/\s+/)[0]?.slice(0, 7) ?? "";
            res.json({
                current,
                remote,
                branch: cfg.updateBranch,
                repo: cfg.updateRepo,
                upToDate: remote === "" ? null : current === remote,
            });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    router.post("/update", async (req, res) => {
        if (!cfg.secretMatches(req.body?.orgSecret)) {
            return res.status(403).json({ error: "orgSecret inválido" });
        }
        if (!cfg.hostRepoDir) {
            return res.status(500).json({ error: "HOST_REPO_DIR não configurado (ver docker-compose.admin.yml)" });
        }

        const script =
            "apk add --no-cache git docker-cli-compose >/dev/null 2>&1 && "
            + `git remote set-url origin ${cfg.updateRepo} && `
            + `git fetch --depth 1 origin ${cfg.updateBranch} && `
            + `git reset --hard origin/${cfg.updateBranch} && `
            + "docker compose -f server/docker-compose.yml up -d --build";

        try {
            await run("docker", [
                "run", "-d", "--rm", "--name", "frd-updater",
                "-v", `${cfg.hostRepoDir}:/repo`,
                "-v", "/var/run/docker.sock:/var/run/docker.sock",
                "-w", "/repo",
                "docker:cli",
                "sh", "-c", script,
            ]);
            res.json({ started: true, message: "Atualização iniciada. Acompanhe: docker logs -f frd-updater" });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    return router;
}

const ADMIN_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FRD GoLive — Admin</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #1e1f22; color: #dbdee1; margin: 0; padding: 24px; }
  .card { max-width: 520px; margin: 0 auto; background: #2b2d31; border-radius: 10px; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  label { display: block; font-size: 13px; margin: 12px 0 4px; color: #b5bac1; }
  input { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid #1e1f22; background: #383a40; color: #fff; }
  button { margin-top: 14px; margin-right: 8px; padding: 9px 14px; border: 0; border-radius: 6px; color: #fff; background: #5865f2; cursor: pointer; }
  button.secondary { background: #4e5058; }
  pre { background: #1e1f22; padding: 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
  .muted { color: #949ba4; font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>FRD GoLive — Administração do servidor</h1>
    <label for="secret">Segredo da organização</label>
    <input id="secret" type="password" placeholder="ORG_SECRET" />
    <button id="check" class="secondary">Verificar atualização</button>
    <button id="update">Atualizar servidor</button>
    <pre id="out">Pronto.</pre>
    <p class="muted">Mantenha este painel atrás de uma rede privada (ex.: Tailscale). A atualização puxa o código do repositório configurado e reconstrói os containers.</p>
  </div>
<script>
  const out = document.getElementById("out");
  const secretEl = document.getElementById("secret");
  const log = (v) => { out.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); };

  document.getElementById("check").onclick = async () => {
    log("Verificando…");
    try {
      const r = await fetch("version");
      log(await r.json());
    } catch (e) { log("Erro: " + e.message); }
  };

  document.getElementById("update").onclick = async () => {
    if (!confirm("Atualizar o servidor a partir do repositório e reconstruir os containers?")) return;
    log("Iniciando atualização…");
    try {
      const r = await fetch("update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSecret: secretEl.value }),
      });
      log(await r.json());
    } catch (e) { log("Erro: " + e.message); }
  };
</script>
</body>
</html>`;
