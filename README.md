# FRD GoLive — Transmissão de tela/câmera privada para Discord (via Vencord)

> **Status:** planejamento / pré-alpha. Nada implementado ainda — veja [docs/ROADMAP.md](docs/ROADMAP.md).

Modificação de cliente (plugin Vencord) + servidor auto-hospedável que permite que
pessoas na **mesma call de voz do Discord** compartilhem **tela e câmera entre si sem
que o vídeo passe pelos servidores do Discord**. O vídeo trafega por um **servidor
privado da própria organização** (LiveKit SFU). A **voz continua normal, pelo Discord**.

Foco: **empresas com regras rígidas de privacidade** que não querem dados de
transmissão (tela/câmera) trafegando pela infraestrutura do Discord.

## Como funciona (resumo)

O plugin **não substitui** o "Go Live" nativo do Discord — isso é tecnicamente
inviável (o SFU do Discord é proprietário e criptografado). Em vez disso, cria um
**pipeline paralelo**:

1. O plugin captura tela/câmera com as APIs do navegador (`getDisplayMedia` /
   `getUserMedia`) — as mesmas que o Discord já usa.
2. Publica o stream no **servidor LiveKit privado**, numa "sala" cujo nome é o
   **ID do canal de voz do Discord** em que você está.
3. Os outros participantes (que também têm o plugin, apontando para o mesmo
   servidor) entram automaticamente na mesma sala e **assistem por um painel
   próprio do plugin** (janela/PiP), não pelo tile nativo do Discord.
4. A **voz segue 100% pelo Discord**. O áudio do sistema **pode** ser incluído no
   stream privado (opcional) — resolvendo a limitação do Discord onde os membros
   não se ouvem na transmissão.

```
  Usuário A (plugin)                 Servidor privado                Usuário B (plugin)
 ┌──────────────────┐              ┌──────────────────┐            ┌──────────────────┐
 │ getDisplayMedia  │──publica────▶│  LiveKit (SFU)   │───assina──▶│  Painel de vídeo │
 │ tela+áudio sist. │   (WebRTC)   │  sala = channelId│  (WebRTC)  │  do plugin       │
 └──────────────────┘              │  + token-service │            └──────────────────┘
        voz ▲                      │  + coturn (TURN) │                    voz ▲
            └───────── Discord (gateway + voz nativa) ────────────────────────┘
```

## Requisitos de uso

- **Todos os participantes precisam ter o plugin instalado** e configurado com o
  **mesmo endereço de servidor** e o **mesmo segredo de organização**. Quem não
  tiver o plugin não vê a transmissão privada.
- O servidor precisa ser auto-hospedado pela organização (Docker).

## Estrutura do repositório (planejada)

```
.
├── client/     # userplugin do Vencord (TypeScript/React)
├── server/     # LiveKit + token-service + coturn (Docker Compose)
└── docs/       # arquitetura e roadmap
```

## Aviso legal / ToS

Este projeto usa um **client mod (Vencord)**, cujo uso é contra os Termos de
Serviço do Discord — o risco é do usuário. O objetivo aqui é **privacidade
corporativa**: manter mídia de tela/câmera fora da infraestrutura de terceiros.
Não há qualquer engenharia reversa do protocolo de mídia do Discord; usamos apenas
APIs padrão de captura do navegador e um servidor WebRTC próprio.

## Licença

MIT — veja [LICENSE](LICENSE).
