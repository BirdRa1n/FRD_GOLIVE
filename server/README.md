# Servidor FRD GoLive — hub/auth/admin + SFU (LiveKit)

Servidor do FRD GoLive. Faz **hub (login Discord) + auth/habilitação + quotas +
admin + config** e **emite os tokens do LiveKit**. A **mídia (vídeo) passa pelo SFU
(LiveKit)** — e entra pelo **IP público que você definir** (ex.: um VPS que faz o
relay do UDP para o servidor de casa).

Tudo que o cliente fala com o hub é **HTTP/WS** (passa pelo Cloudflare Tunnel). Só a
**mídia UDP** precisa do IP público/relay — ver [docs/RELAY-UDP.md](../docs/RELAY-UDP.md).

## Subir

Instalação guiada (recomendado — clona, gera credenciais, pergunta o IP da mídia e sobe):

```bash
curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
```

Ou manual, dentro de `server/`:

```bash
./gen-env.sh                 # gera .env com ADMIN_TOKEN, SESSION_SECRET e chaves do LiveKit
# edite o .env: LIVEKIT_WS_URL (wss do LiveKit) e LIVEKIT_NODE_IP (IP da mídia)
docker compose up -d --build # sobe o hub (8090) + o LiveKit (7880/7881/7882)
```

Login do Discord (hub/admin): preencha `DISCORD_*` e `ADMIN_DISCORD_IDS` — ver
[docs/DISCORD-OAUTH.md](../docs/DISCORD-OAUTH.md).

## Fluxo de mídia (SFU)

1. O plugin puxa `GET /config` → `serverUrl` (WS do LiveKit) + `signalingUrl` (controle).
2. Conecta o **canal de controle** (WS) → recebe a **policy** (habilitado? quotas?).
3. Se habilitado, `POST /token` → o servidor emite um **token do LiveKit** e o plugin
   conecta na **mídia** (LiveKit). A mídia entra pelo IP público (`node_ip`).
4. O plugin reporta o estado (transmitindo) pelo controle → aparece em `/admin`.

Usuário **não habilitado** não recebe token (`403`) — o painel mostra "aguardando
liberação". Quando o admin habilita, a policy é **empurrada pelo WS** e o plugin
conecta a mídia na hora.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | status/versão |
| GET | `/config` | `signalingUrl` (controle), `serverUrl` (LiveKit), versão |
| POST | `/token` | `{room,userId,name}` → token do LiveKit (só habilitados) |
| WS | `/signaling` | canal de controle: policy/presença + estado p/ o admin |
| POST | `/auth/request-access` | `{userId,name}` — registra o pedido |
| GET | `/policy/:userId` | policy atual (enabled + quotas) |
| GET | `/admin/users` · `/admin/transmissions` · `/admin/metrics` | painel (header `X-Admin-Token`) |
| POST | `/admin/users/:id/enable` | `{enabled,maxHeight,maxFps}` |

## Configuração (`.env`)

Principais chaves (o `gen-env.sh` gera segredos aleatórios):

| Variável | Descrição |
|---|---|
| `PORT` | porta do hub (padrão 8090) |
| `ADMIN_TOKEN` / `SESSION_SECRET` | protege `/admin/*` / assina o cookie — aleatórios |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | chaves com que o servidor assina os tokens |
| `LIVEKIT_WS_URL` | **URL WS do LiveKit que o cliente usa** (ex.: `wss://media.SEU.com`) |
| `LIVEKIT_NODE_IP` | **IP público por onde a mídia entra** (gravado no `livekit.yaml`) |
| `DEFAULT_MAX_HEIGHT` / `DEFAULT_MAX_FPS` | quotas padrão |
| `DISCORD_*` / `ADMIN_DISCORD_IDS` | OAuth do hub — ver docs/DISCORD-OAUTH.md |

## Cloudflare (2 rotas HTTP/WS)

1. `golivefrd.SEU.com` → `http://SERVIDOR:8090` (hub: config/token/controle).
2. `media.SEU.com` → `http://SERVIDOR:7880` (WS de signaling do LiveKit) — é o
   `LIVEKIT_WS_URL`.

A **mídia UDP 7882** NÃO passa pelo Cloudflare: entra pelo IP público (`node_ip`)
via relay — ver [docs/RELAY-UDP.md](../docs/RELAY-UDP.md).
