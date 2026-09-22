# Servidor FRD GoLive (mesh) — signaling + auth + admin

Servidor do FRD GoLive. A mídia vai **cliente↔cliente (P2P/mesh)**, então este
servidor só faz **signaling + auth + config + admin** — tudo **HTTP/WS numa única
porta**, então passa 100% pelo **Cloudflare Tunnel** (sem VPS/UDP).

## Subir

Instalação guiada (recomendado — clona, gera credenciais e sobe):

```bash
curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
```

Ou manual, dentro de `server/`:

```bash
./gen-env.sh                 # gera .env com ADMIN_TOKEN e SESSION_SECRET aleatórios
docker compose up -d --build # sobe na porta 8090
# alternativa sem Docker: npm install && npm run build && npm start
```

Depois, para ligar o **login do Discord** (hub/admin), preencha as variáveis
`DISCORD_*` e `ADMIN_DISCORD_IDS` — passo a passo em
[docs/DISCORD-OAUTH.md](../docs/DISCORD-OAUTH.md).

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

## Hub web (golivefrd)

O mesmo serviço serve o hub (páginas HTML + login):

| Rota | Descrição |
|---|---|
| `GET /` | login (Discord) ou home com status do usuário |
| `GET /login` → `GET /auth/callback` | Discord OAuth2 (scope `identify`) |
| `GET /me` · `POST /me/request-access` | dados/pedido do usuário logado |
| `GET /admin` | painel: usuários+quotas, transmissões ativas, métricas ao vivo |

Fluxo de habilitação: usuário loga → pede acesso → admin libera no painel → o
servidor empurra a policy pelo WS → o plugin no Discord liga as funções.

## Configuração (`.env`)

Gerado pelo `gen-env.sh`. Principais chaves:

| Variável | Descrição |
|---|---|
| `PORT` | porta HTTP/WS (padrão 8090) |
| `ADMIN_TOKEN` | protege `/admin/*` (header `X-Admin-Token`) — aleatório |
| `PUBLIC_SIGNALING_URL` | vazio = deriva do host (com HTTPS vira `wss://.../signaling`) |
| `STUN_URLS` | STUN público basta para NAT amigável |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | só para NAT simétrico/corporativo |
| `DEFAULT_MAX_HEIGHT` / `DEFAULT_MAX_FPS` | quotas padrão de novos usuários |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` | OAuth do hub — ver [docs/DISCORD-OAUTH.md](../docs/DISCORD-OAUTH.md) |
| `SESSION_SECRET` | assina o cookie de sessão — aleatório |
| `ADMIN_DISCORD_IDS` | Discord user IDs dos admins (separados por vírgula) |

## Cloudflare

Uma única rota basta: `https://golivefrd.SEU.com` → `http://SERVIDOR:8090` (HTTP
**e** o WebSocket `/signaling` na mesma porta). O plugin puxa `GET /config` e conecta.

## Transporte no cliente

No plugin (Vencord): setting **Transport = Mesh P2P** e aponte o `tokenServiceUrl`
para este servidor. NAT simétrico ainda precisa de TURN (configure `TURN_URLS`).

## Limitação

Mesh **não escala**: quem transmite envia uma cópia por espectador. Alvo: grupos
pequenos/médios. Para grupos grandes, seria preciso um SFU (não incluso nesta versão).
