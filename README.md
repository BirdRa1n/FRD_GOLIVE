# FRD GoLive — Transmissão de tela/câmera privada para Discord (via Vencord)

Modificação de cliente (plugin Vencord) + servidor auto‑hospedável que permite que
pessoas na **mesma call de voz do Discord** compartilhem **tela e câmera entre si sem
que o vídeo passe pelos servidores do Discord**. O vídeo trafega **cliente↔cliente
(P2P/mesh)** por WebRTC; o servidor privado só faz **signaling/auth/admin** — a
**voz continua normal, pelo Discord**.

Foco: **empresas com regras rígidas de privacidade** que não querem dados de
transmissão (tela/câmera) trafegando pela infraestrutura do Discord.

## Como funciona (resumo)

O plugin **não substitui** o "Go Live" nativo — isso é tecnicamente inviável (o SFU
do Discord é proprietário e criptografado). Em vez disso, cria um **pipeline
paralelo**:

1. O plugin captura tela/câmera com as APIs do navegador (`getDisplayMedia` /
   `getUserMedia`) — as mesmas que o Discord já usa.
2. Abre uma conexão **P2P (RTCPeerConnection)** com cada participante da sala (sala =
   **ID do canal de voz do Discord**). A mídia vai direto de um cliente ao outro.
3. O **servidor** só troca os SDP/ICE (signaling por WebSocket) e nunca vê a mídia
   (criptografia DTLS‑SRTP ponta a ponta).
4. A **voz segue 100% pelo Discord**. O áudio do sistema **pode** ser incluído no
   stream privado (opcional).

```
  Usuário A (plugin)                 Servidor privado                Usuário B (plugin)
 ┌──────────────────┐              ┌──────────────────┐            ┌──────────────────┐
 │ getDisplayMedia  │              │  Signaling (WS)  │            │  Painel de vídeo │
 │ tela+áudio sist. │              │  auth · admin    │            │  do plugin       │
 └────────┬─────────┘              └────────┬─────────┘            └─────────┬────────┘
          │  SDP/ICE  ◀───────────────────── │ ──────────────────▶  SDP/ICE  │
          └───────────── mídia P2P (WebRTC, DTLS-SRTP) ──────────────────────┘
        voz ▲                                                            voz ▲
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

- **Servidor** ([server/README.md](server/README.md)): um serviço Node, tudo HTTP/WS
  numa porta só → passa 100% pelo **Cloudflare Tunnel** (sem VPS/UDP). Faz signaling,
  config (`/config`), auth/quotas e um hub web com login do Discord + painel admin.
- **Instalador** ([installer/README.md](installer/README.md)): app gráfico que aplica
  a modificação no Discord sem terminal, puxa a config do host e abre o hub.
- **Plugin** ([client/README.md](client/README.md)): captura, mesh P2P, tiles
  nativos, teatro e hijack dos botões nativos do Discord.

## Começar rápido

**Servidor** (Linux com Docker):

```bash
curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
```

Exponha `golivefrd.SEU.com` → `http://SERVIDOR:8090` no Cloudflare Tunnel. Para o
login do hub/admin, configure o OAuth do Discord: [docs/DISCORD-OAUTH.md](docs/DISCORD-OAUTH.md).

**Clientes**: rodam o **instalador** (`installer/`), escolhem o servidor birdra1n ou
o próprio host, e depois pedem acesso no hub. O admin libera pelo painel.

## Requisitos de uso

- **Todos os participantes precisam ter o plugin instalado** (via instalador) e
  apontando para o **mesmo servidor**. Quem não tiver não vê a transmissão privada.
- O servidor é auto‑hospedado pela organização (Docker), atrás do Cloudflare.
- Mesh **não escala** como um SFU: quem transmite envia uma cópia por espectador.
  Alvo = grupos pequenos/médios.

## Aviso legal / ToS

Este projeto usa um **client mod (Vencord)**, cujo uso é contra os Termos de
Serviço do Discord — o risco é do usuário. O objetivo é **privacidade corporativa**:
manter mídia de tela/câmera fora da infraestrutura de terceiros. Não há engenharia
reversa do protocolo de mídia do Discord; usamos apenas APIs padrão de captura do
navegador e WebRTC P2P.

## Licença

MIT — veja [LICENSE](LICENSE).
