# CLAUDE.md — guia do repositório

Contexto para sessões futuras do Claude neste projeto. Leia antes de mexer.

## O que é

Modificação de cliente do Discord (plugin Vencord) + servidor que permite
**compartilhar tela/câmera de forma privada** — o vídeo **não passa pelos
servidores do Discord**, só a voz continua nativa. Alvo: empresas com regras de
privacidade rígidas.

**Arquitetura atual = SFU (LiveKit) + hub central.** O servidor `server/` faz
hub/login/auth/habilitação/quotas/admin/config **e emite os tokens do LiveKit**. A
**mídia (vídeo) passa pelo SFU (LiveKit)** e entra pelo **IP público configurável**
(`LIVEKIT_NODE_IP`, normalmente um VPS que faz relay do UDP 7882 → servidor de casa).
O controle (config/token/policy) é HTTP/WS (passa pelo Cloudflare); só a mídia UDP
precisa do IP público/relay. O acesso ao token é gated pela **habilitação no hub**
(sem orgSecret). Houve um intervalo em que o transporte foi **mesh/P2P** — isso foi
**revertido**; o código do mesh (`meshTransport.ts`) foi removido.

## Estrutura

```
client/            userplugin do Vencord (TS/React)
  src/
    index.tsx            definePlugin: wiring, ciclo de vida
    settings.ts          settings do plugin (@api/Settings)
    discordState.ts      lê canal de voz atual + usuário (stores do Discord)
    rtc/
      session.ts         transporte SFU (LiveKit) — a mídia — ✔ typecheckável
      signalingClient.ts canal de CONTROLE (WS): policy/habilitação + estado
      nativeCapture.ts   captura via desktopCapturer (Electron) — ✔ typecheckável
      controller.ts      orquestra config → controle(policy) → token → LiveKit
    state/
      streamStore.ts     store reativo puro — ✔ typecheckável
      audioSink.ts       um <audio> oculto por stream (evita eco)
    ui/                  painel, teatro, picker, overlays, hijack dos botões nativos
    native.ts            módulo NATIVO (processo main): desktopCapturer
installer/         instalador gráfico (Electron, Mac/Win) — aplica a mod no Discord
  src/             main/preload (IPC), lib/ (config, inject, paths)
  renderer/        UI do instalador (usa o design system; renderer/ui/ é copiado no build)
server/            hub/auth/admin/config + token do LiveKit (Node, Docker)
  src/             index.ts (Express+ws), livekit.ts (token), store.ts, session.ts, discord.ts, hub.ts
  public/ui/       DESIGN SYSTEM: ui.css (tokens/componentes), ui.js (tema, segmented,
                   sheet, toast, ícones), index.html (catálogo em /ui/)
  livekit.yaml     config do SFU (udp_port 7882 mux, node_ip = IP público da mídia)
docs/              arquitetura, roadmap, OAuth do Discord, relay UDP, experimento Go Live nativo
```

## Build & testes

**Camada RTC pura** (não depende de Vencord) — dá pra typecheckar isolado:
```bash
cd client && npm install && npm run typecheck:rtc
```
Cobre `rtc/session.ts`, `rtc/nativeCapture.ts`, `state/*`, `ui/sourcePicker`, `types.ts`.
O resto (`@webpack/common`, `@api/Settings`, `@utils/types`) **só compila dentro do Vencord**.

**Plugin dentro do Vencord** (não há runtime loading; compila no build):
```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord   # FORA deste repo
cd ~/Vencord && pnpm install && pnpm add livekit-client
mkdir -p src/userplugins
cp -R /caminho/FRD_GOLIVE/client/src src/userplugins/frdGoLive   # COPIE, não symlink
pnpm build && pnpm inject
```
- **Copie `client/src`** (contém o `index.tsx`), não `client/`. Symlink quebra os aliases.
- Nome do plugin: `FRDGoLive`.

**Servidor** (Node hub + LiveKit SFU):
```bash
cd server && ./gen-env.sh && docker compose up -d --build   # ou install.sh (curl|sh)
cd server && npm install && npm run build                    # typecheck/build isolado
curl -s http://localhost:8090/health   # {"ok":true,"transport":"sfu",...}
curl -s http://localhost:8090/config   # signalingUrl (controle) + serverUrl (LiveKit)
```
- `gen-env.sh` gera `.env` com segredos + chaves do LiveKit; defina `LIVEKIT_WS_URL`
  e `LIVEKIT_NODE_IP` (IP público da mídia).
- Login do hub/admin: preencher `DISCORD_*` — ver `docs/DISCORD-OAUTH.md`.
- Relay UDP da mídia (VPS → casa): `docs/RELAY-UDP.md`.

## Fatos e armadilhas importantes (não reaprender)

- **Transporte = SFU (LiveKit)** → a mídia passa pelo servidor → precisa de porta
  **UDP pública 7882** (mux único; **nunca** `port_range_start` — cria 1 docker-proxy
  por porta e estoura a RAM). O Cloudflare Tunnel **só leva HTTP/WS**, não UDP → a
  mídia entra pelo **IP público `LIVEKIT_NODE_IP`** (normalmente um VPS que faz DNAT
  do UDP 7882 → LiveKit de casa via WireGuard). Ver `docs/RELAY-UDP.md`.
- **2 rotas Cloudflare**: `golivefrd.SEU.com`→`:8090` (hub) e `media.SEU.com`→`:7880`
  (WS do LiveKit = `LIVEKIT_WS_URL`). O cliente precisa da CSP liberando **os dois**
  domínios (o instalador faz isso a partir do `/config`).
- **Token gated pela habilitação**: `POST /token` só emite se o usuário está enabled
  no hub. Sem `orgSecret`. Quotas (altura/FPS) aplicadas no cliente (`clampToPolicy`).
- **CSP do Discord** bloqueia conexões a domínios fora da lista. É **obrigatório**
  adicionar o domínio do servidor em `Vencord/src/main/csp/index.ts` (`CspPolicies`),
  com `wss://` explícito (o host "pelado" não casa com o esquema wss nesse Chromium):
  `"*.SEU.com"`, `"wss://*.SEU.com"`, `"ws://*.SEU.com"`, e o IP da mídia.
- **Montar root React**: `@webpack/common` `ReactDOM` nem sempre tem `createRoot` →
  resolver via `findByPropsLazy("createRoot")`, com fallback pra `ReactDOM.render`.
- **Botões nativos censurados**: desbloqueados via `FluxDispatcher.dispatch({type:
  "APEX_EXPERIMENT_OVERRIDE_CREATE", experimentName:"<video-guard>", variantId:-1})`.
  O nome do experimento rotaciona → é setting.
- **Go Live nativo é ininterceptável**: a captura acontece no módulo nativo
  `discord_voice` (C++), fora do JS. Provado por hook — não há `MediaStream` em JS.
  Experimento de usar o Go Live nativo com o servidor privado: **pausado**, só na
  branch `feat/native-stream-probe` (não fazer merge). Registro, achados e estado
  do servidor em `docs/GOLIVE-NATIVO.md`.
- **Go Live nativo sobe prints da tela** para a API do Discord
  (`POST /streams/:key/preview`) — mais um motivo para mantê-lo bloqueado com o
  plugin ativo.
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
- **Injeções no DOM do Discord** (tiles nativos, hijack dos botões) usam
  `MutationObserver` + intervalo porque o Discord re-renderiza; ancorar em atributos
  estáveis (`data-selenium-video-tile="<userId>"`), não em classes hasheadas.

## Convenções

- TypeScript `strict`. Manter a camada `rtc/` pura (só WebRTC/`livekit-client` + DOM)
  pra seguir typecheckável isolado.
- **Commits**: em inglês, Conventional Commits, **sem linha de co-autoria do Claude**
  (preferência do dono). Trabalhar em branch + PR (`gh pr create`), nunca commitar
  direto na `main`.
- Ao mexer no plugin: **copiar `client/src` → Vencord → `pnpm build` → recarregar o
  Discord** (mudança de renderer: Cmd/Ctrl+R; mudança de CSP/main ou `native.ts`:
  reinício completo).

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
