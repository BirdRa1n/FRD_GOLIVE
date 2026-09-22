# Instalador FRD GoLive (Electron, Mac/Windows)

App gráfico que **aplica a modificação no Discord** sem terminal: escolhe o
servidor (birdra1n ou próprio), puxa a config do host, grava as settings do
plugin + a CSP do domínio, e injeta no Discord. Ao final, abre o hub para o
usuário habilitar o acesso.

## Fluxo

1. Escolher **servidor birdra1n** ou **próprio** (informa o host).
2. `GET https://<host>/config` → o host devolve `signalingUrl`, ICE, transporte.
3. Copia o **Vencord dist** (com o plugin, empacotado) para o data dir.
4. Grava `settings.json` (config do plugin) + `native.json` (`customCspRules` do
   domínio) no data dir.
5. Baixa o **Vencord Installer CLI** e injeta com `VENCORD_USER_DATA_DIR` +
   `VENCORD_DEV_INSTALL=1` (mesmo mecanismo do `pnpm inject`).
6. Botão **"Abrir navegador"** → `golivefrd.birdra1n.com` para habilitar.

O hub é servido pelo próprio servidor (`server/`); o login usa OAuth do Discord —
como configurar em [../docs/DISCORD-OAUTH.md](../docs/DISCORD-OAUTH.md).

## Instalação em 1 comando (recomendado)

Os scripts de bootstrap fazem **tudo** — checam dependências, baixam e compilam o
Vencord **com o plugin** (num cache do seu usuário, sem você clonar nada) e abrem o
instalador. Eles **explicam o que será feito** e avisam sobre a senha de admin.

**macOS:**
```bash
bash installer/scripts/install-mac.sh
```

**Windows (PowerShell):**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\installer\scripts\install-windows.ps1
```

> Sobre admin: o patch do Discord pode pedir sua senha (macOS, quando o Discord está
> em `/Aplicativos`). No Windows normalmente não precisa (grava em `%LocalAppData%`).
> O que muda: injeta o Vencord + ativa o plugin + grava settings e uma regra de CSP
> só do seu domínio. Nada é enviado a terceiros. **Feche o Discord antes de aplicar.**

## Desenvolvimento

```bash
npm install
npm run typecheck
npm run build:vencord   # gera installer/vencord-dist (clona o Vencord, compila o plugin)
npm start               # roda o app (precisa do vencord-dist/)
npm run start:full      # build:vencord + start, num passo só
npm run dist            # build:vencord + empacota .dmg (mac) / .exe (win)
```

## O `vencord-dist/` (bundle)

O app precisa de um **Vencord já compilado com o plugin** em `installer/vencord-dist/`
(gitignored). Gere com o script cross-platform:

```bash
npm run build:vencord   # = node scripts/build-vencord-dist.mjs
```

Ele clona o Vencord em `~/.frd-golive/build` (**fora do repo**, evitando o problema do
pnpm "subir"), copia `client/src`, roda `pnpm build` e publica o `dist/` resultante em
`installer/vencord-dist`. Variáveis: `FRD_BUILD_DIR` (cache), `VENCORD_REPO`.

Em dev, dá para apontar para um Vencord já compilado sem gerar o bundle:
`FRD_VENCORD_DIST=~/Vencord/dist npm start`.

## Qual Discord é modificado (sem prompt)

O instalador roda o Vencord CLI de forma **não-interativa** (`-install -branch auto`),
detectando o Discord instalado automaticamente — não abre o menu "Select Discord
install to patch". Para forçar uma branch específica, defina
`FRD_DISCORD_BRANCH=stable|ptb|canary` (default `auto`).

## Troubleshooting

- **`Electron failed to install correctly`** (comum no **Node 26+**): o postinstall
  do Electron usa `extract-zip`, que quebra no Node bleeding-edge — baixa mas extrai
  só o `LICENSES.chromium.html`. Soluções:
  - **Recomendado:** usar **Node LTS (20 ou 22)** para este app.
  - **Workaround** (baixa o binário na mão):
    ```bash
    VER=$(node -p "require('./node_modules/electron/package.json').version")
    A=$(uname -m); [ "$A" = arm64 ] && A=arm64 || A=x64   # macOS
    curl -fL -o /tmp/e.zip "https://github.com/electron/electron/releases/download/v$VER/electron-v$VER-darwin-$A.zip"
    rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
    unzip -q /tmp/e.zip -d node_modules/electron/dist
    printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
    ```
- **npm bloqueando install-scripts** (`allowScripts`): aprove com
  `npm install-scripts approve electron esbuild` e `npm rebuild electron esbuild`.

## Pontos a validar em máquina real (WIP)

Este instalador precisa de teste em Mac e Windows reais. Verificar:
- **Flag do Installer CLI** (`-install`) e comportamento headless por plataforma.
- **Caminho das native settings** do Vencord (`settings/native.json` /
  `customCspRules`) — pode variar por versão do Vencord.
- Assinatura/notarização (macOS) e SmartScreen (Windows) dos binários.
- Fechar o Discord antes de injetar.

Enquanto isso, o método manual (client/README.md + copiar `client/src` + `pnpm
build` + `pnpm inject`) continua válido.
