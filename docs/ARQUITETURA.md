# Arquitetura

FRD GoLive = **plugin Vencord + servidor**. A **mídia (vídeo) usa SFU (LiveKit)** e
entra por um **IP público configurável** (normalmente um VPS que faz relay do UDP →
servidor de casa). O servidor central faz **hub (login Discord) + auth/habilitação +
quotas + admin + config** e **emite os tokens do LiveKit**. Instalador Electron aplica
a modificação no cliente.

> **Nota histórica:** houve uma iteração em que o transporte foi **P2P/mesh** (só
> Cloudflare, sem VPS). Isso foi **revertido** para SFU (mídia por um IP definido pelo
> host) — o texto abaixo que menciona "mesh/P2P" reflete aquela fase. O código do mesh
> foi removido; o transporte atual é `client/src/rtc/session.ts` (LiveKit).

## Motivação

- **Remover a dependência de VPS/UDP para a maioria.** No P2P, a mídia vai
  **cliente↔cliente** e nunca toca o servidor → só precisamos do **signaling
  (HTTP/WS)**, que passa 100% pelo Cloudflare Tunnel. VPS/TURN vira opcional (só
  para NAT simétrico/corporativo restritivo).
- **Onboarding sem terminal.** Instalador gráfico aplica a modificação no Discord.
- **Governança.** Admin habilita usuários, limita qualidade/FPS, vê transmissões
  ativas e métricas.

> Trade-off aceito: mesh **não escala** como SFU (quem transmite envia uma cópia
> por espectador). Alvo v2 = grupos pequenos/médios. Para grupos grandes, manter a
> opção SFU (v1) ou um SFU gerenciado (ex.: Cloudflare Realtime) como modo alternativo.

## Componentes

```
┌───────────────────┐        ┌──────────────────────────┐
│  Instalador (App   │        │   Hub Web                │
│  Electron, Mac/Win)│───────▶│   golivefrd.birdra1n.com │
│  aplica mod no     │  abre  │   auth · admin · dash    │
│  Discord + config  │  nav.  └───────────┬──────────────┘
└─────────┬──────────┘                    │ REST/WS
          │ grava config                  ▼
          ▼                    ┌──────────────────────────┐
┌───────────────────┐  WS      │  Servidor (self-host ou   │
│  Plugin Vencord   │◀────────▶│  birdra1n)                │
│  P2P mesh (RTCPC) │ signaling│  - Signaling (WS)         │
│  captura/render   │          │  - Auth + quotas          │
└───────────────────┘          │  - Config endpoint        │
          ▲  mídia P2P (WebRTC) │  - Admin API + métricas   │
          └────────┐           │  - (TURN opcional)        │
                   ▼           └──────────────────────────┘
            outro Plugin (peer)
```

### 1. Servidor (self-host ou hospedado)

Um serviço Node único (ou poucos), tudo atrás do Cloudflare (HTTP/WS):

- **Signaling (WebSocket)**: salas = ID do canal de voz. Repassa SDP/ICE entre
  peers. Não vê a mídia.
- **Auth**: login (o admin habilita usuários), emite tokens de sala, valida se o
  usuário está habilitado, aplica **quotas** (resolução/FPS máximos por usuário).
- **Config endpoint** (`GET /config`): dado um host, retorna tudo que o cliente
  precisa — URL de signaling, ICE servers (STUN/TURN), políticas, versão.
- **Admin API**: habilitar/desabilitar usuários, definir quotas, listar
  **transmissões ativas** (derivadas do signaling), métricas (CPU, rede, nº de
  salas/peers).
- **TURN (opcional)**: coturn próprio ou Cloudflare TURN, só para NAT restritivo.
- **DB**: usuários, quotas, sessões, flags de habilitação (SQLite/Postgres).

### 2. Plugin Vencord (transporte P2P)

- Substitui a camada LiveKit por **`RTCPeerConnection` mesh**: uma conexão por peer
  na sala.
- **Signaling client** (WS) para trocar offer/answer/ICE.
- Recebe **config do servidor** (ICE servers, quotas) — aplica limites de
  qualidade/FPS que o admin definiu.
- Mantém captura nativa, tiles nativos, teatro, hijack dos botões (já prontos).
- Reporta estado (transmitindo/assistindo) ao servidor para visibilidade do admin.

### 3. Instalador (Electron, Mac + Windows)

- Detecta/instala pré-requisitos e **aplica a modificação no Discord** (build do
  Vencord com o plugin embutido, ou um bundle pré-compilado injetado).
- Fluxo:
  1. Escolher **usar o servidor birdra1n** ou **configurar o próprio**.
  2. Ao inserir o **host**, chama `GET https://<host>/config` → o host devolve
     toda a config (signaling, ICE, versão) → o instalador grava e aplica as
     modificações (inclui a entrada de **CSP** do domínio automaticamente).
  3. Botão **"Abrir navegador"** → `http://golivefrd.birdra1n.com` (hub).
- Assina/gera o build e injeta no Discord instalado (Mac e Windows).

### 4. Hub Web (golivefrd.birdra1n.com)

- **Auth**: o usuário faz login e **solicita habilitar o uso do servidor**.
- Quando o admin habilita, o servidor **notifica o plugin no Discord** (via o
  signaling WS já conectado) → o plugin liga as funções automaticamente e mostra
  um aviso "acesso liberado".
- **Painel do admin**:
  - habilitar/desabilitar usuários; definir **quota de qualidade/FPS** por usuário;
  - ver **transmissões ativas** no momento (quem, sala, desde quando);
  - **dashboard**: CPU, memória, rede, nº de salas/peers, histórico.
- Reúne as funções antes espalhadas (config, admin, docs) num lugar só.

## Fluxo de habilitação (ponta a ponta)

```
1. Usuário roda o instalador → escolhe servidor → host retorna config → mod aplicada.
2. Instalador abre golivefrd.birdra1n.com → usuário faz login e pede acesso.
3. Admin habilita o usuário (define quota).
4. Servidor empurra "habilitado" pelo WS → plugin no Discord liga as funções e avisa.
5. Usuário transmite (P2P). Admin vê a transmissão ativa e as métricas no dash.
```

## Segurança

- Auth por conta (não só segredo compartilhado). Tokens de sala curtos.
- Quotas aplicadas no **cliente** (UX) e **validadas no servidor** (o signaling só
  monta a sala se o usuário estiver habilitado e dentro da quota).
- Signaling nunca vê a mídia (P2P criptografado DTLS-SRTP ponta a ponta).
- Admin atrás de auth forte; painel só por rede confiável/Access.

## Estado atual: SFU (LiveKit), com hub central

- **Mídia = SFU (LiveKit)** em `server/` (docker-compose sobe o LiveKit junto do hub).
  Entra pela porta **UDP 7882** no **IP público** `LIVEKIT_NODE_IP` (o host define) —
  normalmente um VPS que faz relay do UDP para o LiveKit de casa (ver
  `docs/RELAY-UDP.md`).
- **Controle** (config/token/policy/estado) é HTTP/WS pelo Cloudflare: rota do hub
  (`:8090`) + rota do WS do LiveKit (`:7880`).
- **Acesso gated pela habilitação**: `POST /token` só emite token para usuários
  habilitados no hub. Sem `orgSecret`. As quotas (resolução/FPS) são aplicadas no
  cliente a partir da policy.
- O mesh/P2P foi removido (`meshTransport.ts`); `signalingClient.ts` virou o canal de
  controle (policy + estado), e a mídia é o `RtcSession` (LiveKit).
