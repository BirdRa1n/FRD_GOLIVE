# Servidor v2 (mesh) — signaling + auth + admin

Servidor da arquitetura **v2 (P2P/mesh)**. Como a mídia vai cliente↔cliente, este
servidor só faz **signaling + auth + config + admin** — tudo **HTTP/WS**, então
passa 100% pelo **Cloudflare Tunnel** (sem VPS/UDP para NAT amigável).

## Subir

```bash
cp .env.example .env   # troque ADMIN_TOKEN
docker compose up --build
# ou: npm install && npm run build && npm start
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | status/versão |
| GET | `/config` | config do cliente: `signalingUrl`, `iceServers`, versão |
| WS | `/signaling` | signaling do mesh (salas por channelId) |
| POST | `/auth/request-access` | `{userId,name}` — usuário pede acesso |
| GET | `/policy/:userId` | policy atual (enabled + quotas) |
| GET | `/admin/users` | lista usuários (header `X-Admin-Token`) |
| POST | `/admin/users/:id/enable` | `{enabled,maxHeight,maxFps}` — habilita + quota |
| GET | `/admin/transmissions` | transmissões ativas agora |
| GET | `/admin/metrics` | CPU, memória, salas, peers, uptime |

Ao habilitar um usuário, a nova policy é **empurrada pelo WS** para as conexões
vivas dele (o plugin liga as funções na hora).

## Cloudflare

Uma única rota basta: `https://<host>` → `http://SERVIDOR:8090` (HTTP **e** o
WebSocket `/signaling` na mesma porta). O plugin puxa `GET /config` e conecta.

## Transporte no cliente

No plugin (Vencord): setting **Transport = Mesh P2P (v2)** e aponte o
`tokenServiceUrl` para este servidor. NAT simétrico ainda precisa de TURN
(configure `TURN_URLS`).

## Limitação

Mesh **não escala**: quem transmite envia uma cópia por espectador. Alvo: grupos
pequenos/médios. Para grupos grandes, use o transporte **SFU** (server/ v1).
