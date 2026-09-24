# CLAUDE.md — guia do repositório

Contexto para sessões futuras do Claude neste projeto. Leia antes de mexer.

## O que é

Modificação de cliente do Discord (plugin Vencord) + servidor que permite
**compartilhar a tela de forma privada** — o vídeo **não passa pelos servidores do
Discord**, só a voz (e a câmera) continua nativa. Alvo: empresas com regras de
privacidade rígidas.

**Arquitetura atual = Go Live NATIVO redirecionado + hub central.** O plugin
redireciona a conexão de transmissão do **Go Live nativo do Discord** para o
servidor privado (WS `/dstream`); o módulo nativo `discord_voice` envia o **RTP
(vídeo + áudio)** para o **IP público configurável** (`NATIVE_STREAM_PUBLIC_IP`,
normalmente um VPS que faz relay do UDP → servidor de casa). O áudio é **E2EE
(DAVE v1 / MLS)**. O controle (WS `/dstream`) é HTTP/WS (passa pelo Cloudflare); só
a mídia UDP precisa do IP público/relay. A habilitação é checada no `/dstream`
(`server/src/nativeStream.ts`). O servidor `server/` também faz o hub de
login/auth/habilitação/admin (páginas web). Ver [docs/GOLIVE-NATIVO.md](docs/GOLIVE-NATIVO.md)
(a chave foi o `keyframe_interval` no op4) e [docs/DAVE.md](docs/DAVE.md).

**Histórico:** houve um transporte **mesh/P2P** e depois um **SFU (LiveKit)** — os
dois foram **removidos** (o LiveKit saiu quando o vídeo nativo passou a funcionar;
não existe mais `livekit.ts`/`meshTransport.ts`/`rtc/session.ts`).

## Estrutura

```
client/            userplugin do Vencord (TS/React) — enxuto: só o redirect + diagnóstico
  src/
    index.tsx            definePlugin: wiring (redirect, unlock do video guard, ciclo de vida)
    settings.ts          settings do plugin (@api/Settings)
    probe/
      nativeStreamRedirect.ts  redireciona o Go Live nativo p/ o /dstream + libera o DAVE downgrade
      streamProbe.ts     sonda de protocolo (só leitura) — diagnóstico
    diagBridge.ts        ponte MCP (renderer) — diagnóstico ao vivo (ver docs/MCP-DIAG.md)
    native.ts            módulo NATIVO (processo main): desktopCapturer + IPC da ponte MCP
    types.ts             tipos puros (NativeSource) — ✔ typecheckável isolado
installer/         instalador gráfico (Electron, Mac/Win) — aplica a mod no Discord
  src/             main/preload (IPC), lib/ (config, inject, paths)
  renderer/        UI do instalador (usa o design system; renderer/ui/ é copiado no build)
server/            hub/auth/admin/config + mídia do Go Live nativo (Node, Docker)
  src/             index.ts (Express+ws), nativeStream.ts (/dstream + UDP), dave.ts (MLS/E2EE),
                   twcc.ts, store.ts, session.ts, discord.ts, hub.ts
  public/ui/       DESIGN SYSTEM: ui.css (tokens/componentes), ui.js (tema, segmented,
                   sheet, toast, ícones), index.html (catálogo em /ui/)
docs/              arquitetura, roadmap, OAuth do Discord, relay UDP, Go Live nativo, DAVE, MCP
mcp/               MCP local (tools frd-discord) p/ diagnóstico do Discord ao vivo
```

## Build & testes

**Tipos puros** (não dependem de Vencord) — typecheck isolado:
```bash
cd client && npm install && npm run typecheck:rtc
```
Cobre só `types.ts`. O resto do plugin (`@webpack/common`, `@api/Settings`,
`@utils/types`, `@main/*`) **só compila dentro do Vencord** (`pnpm build`).

**Plugin dentro do Vencord** (não há runtime loading; compila no build):
```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord   # FORA deste repo
cd ~/Vencord && pnpm install
mkdir -p src/userplugins
cp -R /caminho/FRD_GOLIVE/client/src src/userplugins/frdGoLive   # COPIE, não symlink
pnpm build && pnpm inject
```
- **Copie `client/src`** (contém o `index.tsx`), não `client/`. Symlink quebra os aliases.
- Nome do plugin: `FRDGoLive`. Não precisa mais de `livekit-client` (removido).

**Servidor** (Node hub + mídia do Go Live nativo):
```bash
cd server && ./gen-env.sh && docker compose up -d --build   # ou install.sh (curl|sh)
cd server && npm install && npm run build                    # typecheck/build isolado
curl -s http://localhost:8090/health   # {"ok":true,"transport":"native",...}
curl -s http://localhost:8090/config   # nativeStreamEndpoint (host/dstream) + mediaHost
```
- `gen-env.sh` gera `.env` com segredos; defina `NATIVE_STREAM_PUBLIC_IP` (IP público
  da mídia UDP) e, para E2EE do áudio, `NATIVE_STREAM_DAVE=1`.
- Login do hub/admin: preencher `DISCORD_*` — ver `docs/DISCORD-OAUTH.md`.
- Relay UDP da mídia (VPS → casa): `docs/RELAY-UDP.md`.

## Fatos e armadilhas importantes (não reaprender)

- **Transporte = Go Live NATIVO redirecionado** → a mídia (RTP do `discord_voice`)
  passa pelo servidor por **UDP** (`NATIVE_STREAM_UDP_PORT`, ex. 7883/7000). O
  Cloudflare Tunnel **só leva HTTP/WS**, não UDP → a mídia entra pelo **IP público
  `NATIVE_STREAM_PUBLIC_IP`** (normalmente um VPS que faz DNAT do UDP → servidor de
  casa via WireGuard). O controle (WS `/dstream`) passa pelo Cloudflare. Ver `docs/RELAY-UDP.md`.
- **`keyframe_interval` no op4 destrava o encoder** — sem ele o `discord_voice` fica
  em `bitrateTarget: 0`/`framesEncoded: 0` (não é "allocator"). O servidor manda
  `NATIVE_STREAM_KEYFRAME_INTERVAL` (default 2000). Ver `docs/GOLIVE-NATIVO.md`.
- **op4 `video_codec` segue o cliente**: menor `priority` com `encode:true` (H265),
  **filtrando opus** (áudio, prio 1000, senão vira video_codec por engano).
- **1 rota Cloudflare** basta: `golivefrd.SEU.com`→`:8090` (hub + WS `/dstream`). A
  CSP do cliente precisa liberar esse domínio com `wss://` explícito; a mídia é UDP
  (não passa por CSP). O instalador grava isso a partir do host.
- **Habilitação gated no `/dstream`**: `identify()` (`server/src/nativeStream.ts`) só
  aceita usuário enabled no hub (a menos que `NATIVE_STREAM_ALLOW_ANY=1`, só teste).
- **Câmera = nativa do Discord** (passa pelos servidores do Discord); só a **tela**
  (Go Live) é privada. Decisão de produto ao remover o LiveKit.
- **CSP do Discord** bloqueia conexões a domínios fora da lista. É **obrigatório**
  adicionar o domínio do servidor em `Vencord/src/main/csp/index.ts` (`CspPolicies`),
  com `wss://` explícito (o host "pelado" não casa com o esquema wss nesse Chromium):
  `"*.SEU.com"`, `"wss://*.SEU.com"`, `"ws://*.SEU.com"`. O instalador faz isso via
  `native-settings.json` (customCspRules).
- **Botões nativos censurados**: desbloqueados via `FluxDispatcher.dispatch({type:
  "APEX_EXPERIMENT_OVERRIDE_CREATE", experimentName:"<video-guard>", variantId:-1})`.
  O nome do experimento rotaciona → é setting. **Não** sequestramos os botões (o Go
  Live nativo é que roda; `nativeStreamRedirect` só troca o endpoint da mídia).
- **Go Live nativo funciona pelo servidor privado**: a captura/encoder ficam no módulo
  nativo `discord_voice` (C++), fora do JS. Áudio E2EE (DAVE v1) + vídeo. Registro em
  `docs/GOLIVE-NATIVO.md`; protocolo DAVE em `docs/DAVE.md`. Investigação ao vivo via
  MCP local (tools `frd-discord`, `opencode.json`) com playbook em `docs/MCP-DIAG.md`.
- **⚠️ Privacidade — Go Live nativo sobe prints da tela** para a API do Discord
  (`POST /streams/:key/preview`): como agora USAMOS o Go Live nativo, o *thumbnail*
  da tela ainda vai para o Discord (só o stream de vídeo é privado). Considerar
  bloquear esse endpoint no cliente se for um requisito.
- **Áudio da transmissão sem a call (Windows)**: o `desktopCapturer`/loopback comum pega
  o sistema inteiro — a call vaza e quem assiste se escuta. Solução (`native.ts`):
  captura via `getDisplayMedia` com o nosso handler respondendo
  `audio: "loopbackWithoutChrome"` (WASAPI process loopback que EXCLUI a árvore do
  processo que captura). Por padrão quem captura é o *serviço de áudio* (processo
  próprio) e a voz (`discord_voice`) toca no *renderer* — fora dessa árvore. Por isso o
  `native.ts` desliga `AudioServiceOutOfProcess` (envolvendo `app.commandLine.appendSwitch`
  para mesclar com o `--disable-features` do Discord): o serviço vai pro processo
  principal e a árvore excluída vira o Discord inteiro. O Electron 42 (Discord atual)
  repassa qualquer string de `audio` como device id; o 43+ também mapeia
  `restrictOwnAudio`. Requer Windows 10 2004+; o `getAudioCaps()` confere se a flag pegou.
  macOS: sem som (o desktopCapturer não entrega; o CATap do Chromium só exclui o pid do
  serviço de áudio, não o renderer).
## Convenções

- TypeScript `strict`. O plugin ficou enxuto (redirect + diagnóstico); só `types.ts`
  é typecheckável isolado (`npm run typecheck:rtc`) — o resto exige o build do Vencord.
- **Commits**: em inglês, Conventional Commits, **sem linha de co-autoria do Claude**
  (preferência do dono). Trabalhar em branch + PR (`gh pr create`), nunca commitar
  direto na `main`.
- Ao mexer no plugin: **copiar `client/src` → Vencord → `pnpm build` → recarregar o
  Discord** (mudança de renderer: Cmd/Ctrl+R; mudança de CSP/main ou `native.ts`:
  reinício completo). Dá para validar o build de verdade em `~/Vencord` (`pnpm build`
  bundla; `npx tsc --noEmit -p tsconfig.json` checa os tipos).

## Design system (UI do hub/login/admin/instalador)

- Fonte única em `server/public/ui/` (`ui.css` + `ui.js`), **sem build**. O hub serve em
  `/ui/*` (com `?v=VERSION` nos links); catálogo vivo de todos os componentes em `/ui/`.
- O instalador **copia** esses arquivos para `installer/renderer/ui/` no `npm run build`
  (`scripts/sync-ui.mjs`; destino gitignored). Não edite a cópia.
- Linguagem SwiftUI-like: `.large-title`, listas `.group`/`.row`, `.card-hero` em gradiente,
  `.segmented`, `.toggle[role=switch]`, `<dialog class="sheet">`, `FRDUI.toast/confirm`.
  Ícones: `<i data-icon="nome">` (hidratado pelo ui.js) ou `FRDUI.icon("nome")`.
- Tema: segue o sistema; `data-theme` no `<html>` força claro/escuro (gravado em
  localStorage pelo seletor `[data-theme-switch]`), troca com View Transitions.
- Componentes usam **só tokens** (`--bg`, `--surface`, `--accent`, `--gradient`…) — nunca
  cor literal, senão quebra um dos temas. Sem fontes externas (offline/privacidade).
- Dentro de `<label>`, não coloque `.segmented` (o clique no texto aciona o 1º botão):
  use `<div class="label">`.

## Instalador (Electron)

`installer/` aplica a mod sem terminal: puxa `GET <host>/config`, grava as settings do
plugin + a CSP do domínio, injeta via Vencord Installer CLI e abre o hub. Precisa de um
`installer/vencord-dist/` (Vencord já compilado com o plugin — gitignored, gerado no CI).
Ver `installer/README.md` (inclui o workaround do Electron no Node 26+).

- **Build/release:** `installer/scripts/build-app.sh` (Mac: .app/.dmg/.zip, ad-hoc sem
  Developer ID via `after-pack.cjs`) e `build-app.bat` (Windows: .exe NSIS);
  `publish-release.{sh,bat}` sobem `release/` com o `gh` para a release `v<versão>`.
- **Auto-update:** `electron-updater` com provider GitHub (`publish` no
  `electron-builder.yml`). Nomes de artefato **sem espaço** (senão o `latest*.yml` não
  bate com o asset). No macOS sem Developer ID o update vira "baixe a nova versão".
- `.bat` precisam de **CRLF** (ver `.gitattributes`) — com LF o `goto` quebra no cmd.
