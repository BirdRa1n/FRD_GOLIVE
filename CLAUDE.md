# CLAUDE.md — guia do repositório

Contexto para sessões futuras do Claude neste projeto. Leia antes de mexer.

## O que é

Modificação de cliente do Discord (plugin Vencord) + servidor que permite
**compartilhar tela/câmera de forma privada** — o vídeo **não passa pelos
servidores do Discord**, só a voz continua nativa. Alvo: empresas com regras de
privacidade rígidas.

**Arquitetura atual = P2P/mesh.** A mídia vai cliente↔cliente (WebRTC); o servidor
só faz signaling/auth/admin/config (HTTP+WS numa porta só → passa pelo Cloudflare
Tunnel, sem VPS/UDP). A v1 (SFU LiveKit + relay UDP por VPS) **foi removida** — ver
"Histórico" em `docs/ARQUITETURA.md`.

## Estrutura

```
client/            userplugin do Vencord (TS/React)
  src/
    index.tsx            definePlugin: wiring, ciclo de vida
    settings.ts          settings do plugin (@api/Settings)
    discordState.ts      lê canal de voz atual + usuário (stores do Discord)
    rtc/
      meshTransport.ts   transporte P2P (RTCPeerConnection por peer) — ATUAL
      signalingClient.ts cliente WS do signaling (offer/answer/ICE, policy)
      session.ts         transporte SFU/LiveKit (legado, sem servidor no repo)
      nativeCapture.ts   captura via desktopCapturer (Electron) — ✔ typecheckável
      controller.ts      orquestra config → connect → publish/subscribe (mesh|sfu)
    state/
      streamStore.ts     store reativo puro — ✔ typecheckável
      audioSink.ts       um <audio> oculto por stream (evita eco)
    ui/                  painel, teatro, picker, overlays, hijack dos botões nativos
    native.ts            módulo NATIVO (processo main): desktopCapturer
installer/         instalador gráfico (Electron, Mac/Win) — aplica a mod no Discord
  src/             main/preload (IPC), lib/ (config, inject, paths)
  renderer/        UI do instalador
server/            signaling + auth + config + admin + hub web (Node, Docker)
  src/             index.ts (Express+ws), store.ts, session.ts, discord.ts, hub.ts
docs/              arquitetura, roadmap, guia do OAuth do Discord
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

**Servidor** (Node, mesh signaling):
```bash
cd server && ./gen-env.sh && docker compose up -d --build   # ou install.sh (curl|sh)
cd server && npm install && npm run build                    # typecheck/build isolado
curl -s http://localhost:8090/health   # {"ok":true,...}
curl -s http://localhost:8090/config   # signalingUrl + iceServers
```
- `gen-env.sh` gera `.env` com `ADMIN_TOKEN` + `SESSION_SECRET` aleatórios.
- Login do hub/admin: preencher `DISCORD_*` — ver `docs/DISCORD-OAUTH.md`.
- Cloudflare: uma rota `golivefrd.SEU.com` → `http://SERVIDOR:8090` (HTTP+WS, sem UDP).

## Fatos e armadilhas importantes (não reaprender)

- **Transporte = mesh (P2P)** → a mídia vai cliente↔cliente, nunca toca o servidor →
  só precisa de **signaling HTTP/WS** (uma porta, 8090) → passa 100% pelo Cloudflare
  Tunnel, **sem VPS/UDP**. NAT simétrico/corporativo ainda pode exigir TURN.
- **Legado (v1 SFU, removido)**: usava LiveKit (mídia pelo servidor) → exigia UDP
  público (7882 mux; nunca `port_range_start` — estoura RAM) + relay por VPS. O código
  do transporte SFU segue em `client/src/rtc/session.ts`, mas **não há servidor SFU**.
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
- **Áudio**: o navegador NÃO isola áudio de app nativo. Só existe: aba do Chrome
  (scoped, sem call) / tela ou desktopCapturer (sistema todo, com a call) / janela
  (sem áudio). macOS não entrega áudio de sistema ao navegador.
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

## Instalador (Electron)

`installer/` aplica a mod sem terminal: puxa `GET <host>/config`, grava as settings do
plugin + a CSP do domínio, injeta via Vencord Installer CLI e abre o hub. Precisa de um
`installer/vencord-dist/` (Vencord já compilado com o plugin — gitignored, gerado no CI).
Ver `installer/README.md` (inclui o workaround do Electron no Node 26+).
