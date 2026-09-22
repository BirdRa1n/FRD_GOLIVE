# CLAUDE.md — guia do repositório

Contexto para sessões futuras do Claude neste projeto. Leia antes de mexer.

## O que é

Modificação de cliente do Discord (plugin Vencord) + servidor que permite
**compartilhar tela/câmera de forma privada** — o vídeo **não passa pelos
servidores do Discord**, só a voz continua nativa. Alvo: empresas com regras de
privacidade rígidas.

## Estrutura

```
client/            userplugin do Vencord (TS/React)
  src/
    index.tsx            definePlugin: wiring, ciclo de vida
    settings.ts          settings do plugin (@api/Settings)
    discordState.ts      lê canal de voz atual + usuário (stores do Discord)
    rtc/
      session.ts         LiveKit puro (só livekit-client) — ✔ typecheckável isolado
      nativeCapture.ts   captura via desktopCapturer (Electron) — ✔ typecheckável
      controller.ts      orquestra token → connect → publish/subscribe
    state/
      streamStore.ts     store reativo puro — ✔ typecheckável
      audioSink.ts       um <audio> oculto por stream (evita eco)
    ui/                  painel, teatro, picker, overlays, hijack dos botões nativos
    native.ts            módulo NATIVO (processo main): desktopCapturer
server/            LiveKit + token-service + relay (Docker Compose)
  token-service/   Express/TS: emite JWT do LiveKit, valida ORG_SECRET, presença
docs/              arquitetura, roadmap, planos v2
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

**Servidor**:
```bash
cd server && ./gen-env.sh && docker compose up --build   # ou install.sh (curl|sh)
cd server/token-service && npm install && npx tsc --noEmit
./server/diagnose.sh <token-url> <livekit-ws>   # health-check completo
```

## Fatos e armadilhas importantes (não reaprender)

- **Transporte = SFU (LiveKit)** → toda mídia passa pelo servidor → precisa de porta
  UDP pública (7882, mux único; NUNCA usar `port_range_start` — estoura RAM). O
  Cloudflare Tunnel **só leva HTTP/WS**, não UDP → daí o **relay por VPS**
  (VPS DNAT UDP 7882 → servidor de casa). Ver `docs/ARQUITETURA.md`.
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

- TypeScript `strict`. Manter a camada `rtc/` pura (só `livekit-client` + DOM) pra
  seguir typecheckável isolado.
- **Commits**: em inglês, Conventional Commits, **sem linha de co-autoria do Claude**
  (preferência do dono). Trabalhar em branch + PR (`gh pr create`), nunca commitar
  direto na `main`.
- Ao mexer no plugin: **copiar `client/src` → Vencord → `pnpm build` → recarregar o
  Discord** (mudança de renderer: Cmd/Ctrl+R; mudança de CSP/main ou `native.ts`:
  reinício completo).

## Direção v2 (em planejamento)

Rearquitetura para **P2P/mesh** (mídia cliente-a-cliente, só Cloudflare, sem VPS
para NAT amigável), **instalador Electron**, **hub web** (golivefrd.birdra1n.com)
com auth/admin/quotas, e notificação de habilitação no Discord.
Ver `docs/V2-ARCHITECTURE.md` e `docs/V2-ROADMAP.md`.
