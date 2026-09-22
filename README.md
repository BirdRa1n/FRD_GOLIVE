# FRD GoLive — Transmissão de tela/câmera privada para Discord (via Vencord)

Modificação de cliente (plugin Vencord) + servidor auto‑hospedável que permite que
pessoas na **mesma call de voz do Discord** compartilhem **tela e câmera entre si sem
que o vídeo passe pelos servidores do Discord**. O vídeo trafega por um **SFU privado
(LiveKit)** da própria organização, que entra por um **IP público definido pelo host**;
o servidor central faz **hub/login/auth/habilitação/quotas/admin** e **emite os tokens**.
A **voz continua normal, pelo Discord**.

Foco: **empresas com regras rígidas de privacidade** que não querem dados de
transmissão (tela/câmera) trafegando pela infraestrutura do Discord.

## Como funciona (resumo)

O plugin **não substitui** o "Go Live" nativo — isso é tecnicamente inviável (o SFU
do Discord é proprietário e criptografado). Em vez disso, cria um **pipeline
paralelo**:

1. O plugin captura tela/câmera com as APIs do navegador (`getDisplayMedia` /
   `getUserMedia`) — as mesmas que o Discord já usa.
2. Pede um **token** ao servidor (só se o usuário estiver **habilitado** no hub) e
   publica no **SFU (LiveKit)** privado, numa sala = **ID do canal de voz do Discord**.
3. Os outros participantes (com o plugin, mesmo servidor, mesmo canal) **assinam** o
   stream pelo SFU e assistem num painel próprio do plugin.
4. A **voz segue 100% pelo Discord**. O áudio do sistema **pode** ser incluído no
   stream privado (opcional).

```
  Usuário A (plugin)                 Servidor privado                Usuário B (plugin)
 ┌──────────────────┐   token/WS   ┌──────────────────┐   token/WS ┌──────────────────┐
 │ getDisplayMedia  │─────────────▶│  hub/auth/admin  │◀───────────│  Painel de vídeo │
 │ tela+áudio sist. │──publica────▶│  + SFU (LiveKit) │───assina──▶│  do plugin       │
 └──────────────────┘  UDP 7882    │  IP público/relay│  UDP 7882  └──────────────────┘
        voz ▲                      └──────────────────┘                    voz ▲
            └───────────── Discord (gateway + voz nativa) ───────────────────┘
```

## Componentes

```
.
├── client/     # userplugin do Vencord (TypeScript/React), transporte mesh
├── installer/  # instalador gráfico (Electron, Mac/Windows) que aplica a mod
├── server/     # signaling + auth + config + admin + hub (Node, Docker)
└── docs/       # arquitetura, roadmap e guias
```

- **Servidor** ([server/README.md](server/README.md)): hub (login Discord) + auth/
  habilitação + quotas + admin + config, e emite os **tokens do LiveKit**. Sobe o
  **SFU (LiveKit)** junto. Controle é HTTP/WS (Cloudflare); a **mídia** entra pela
  **UDP 7882** no **IP público** que o host define (ver [docs/RELAY-UDP.md](docs/RELAY-UDP.md)).
- **Instalador** ([installer/README.md](installer/README.md)): app gráfico que aplica
  a modificação no Discord sem terminal, puxa a config do host e abre o hub.
- **Plugin** ([client/README.md](client/README.md)): captura, mesh P2P, tiles
  nativos, teatro e hijack dos botões nativos do Discord.

## Começar rápido

**Servidor** (Linux com Docker):

```bash
curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
```

No Cloudflare Tunnel, exponha **2 rotas HTTP/WS**: `golivefrd.SEU.com`→`:8090` (hub)
e `media.SEU.com`→`:7880` (WS do LiveKit). A **mídia UDP 7882** entra pelo IP público
(ver [docs/RELAY-UDP.md](docs/RELAY-UDP.md)). OAuth do hub: [docs/DISCORD-OAUTH.md](docs/DISCORD-OAUTH.md).

**Clientes**: rodam o **instalador** (`installer/`), escolhem o servidor birdra1n ou
o próprio host, e depois pedem acesso no hub. O admin libera pelo painel.

## Requisitos de uso

- **Todos os participantes precisam ter o plugin instalado** (via instalador) e
  apontando para o **mesmo servidor**. Quem não tiver não vê a transmissão privada.
- O servidor é auto‑hospedado pela organização (Docker), atrás do Cloudflare, com a
  mídia entrando por um IP público (VPS/relay) — ver [docs/RELAY-UDP.md](docs/RELAY-UDP.md).
- Só quem o admin **habilitar** no hub consegue transmitir/assistir.

## Aviso legal / ToS

Este projeto usa um **client mod (Vencord)**, cujo uso é contra os Termos de
Serviço do Discord — o risco é do usuário. O objetivo é **privacidade corporativa**:
manter mídia de tela/câmera fora da infraestrutura de terceiros. Não há engenharia
reversa do protocolo de mídia do Discord; usamos apenas APIs padrão de captura do
navegador e WebRTC P2P.

## Licença

MIT — veja [LICENSE](LICENSE).
