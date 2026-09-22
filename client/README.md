# Cliente FRD GoLive (userplugin do Vencord)

Userplugin do Vencord que compartilha tela/câmera **cliente↔cliente (P2P/mesh)** por
um servidor privado de signaling — fora do Discord. A voz continua no Discord.

> 🪟 **No Windows?** Veja o passo a passo dedicado em [WINDOWS.md](WINDOWS.md).
> 🖱️ **Não quer terminal?** Use o **instalador gráfico** em [../installer/](../installer)
> — ele aplica a mod e configura o servidor por você.

## Estrutura

```
src/
├── index.tsx               # definePlugin: wiring, subscribe em VOICE_CHANNEL_SELECT
├── settings.ts             # aba de settings (transport, servidor, vídeo)
├── discordState.ts         # lê canal de voz atual + usuário (stores do Discord)
├── rtc/
│   ├── meshTransport.ts    # transporte P2P (RTCPeerConnection por peer) — ATUAL
│   ├── signalingClient.ts  # cliente WS do signaling (offer/answer/ICE, policy)
│   ├── session.ts          # transporte SFU/LiveKit (legado) ✔ typecheckável
│   └── controller.ts       # orquestra: config → connect → publish/subscribe
├── state/
│   └── streamStore.ts      # store reativo puro (streams, connected, sharing)
└── ui/                     # painel, teatro, picker, tiles nativos, hijack de botões
```

**Camada RTC pura** não importa nada do Vencord e é validada isolada:

```bash
npm install
npm run typecheck:rtc
```

O resto (`@webpack/common`, `@api/Settings`, `@utils/types`) só resolve dentro do
build do Vencord.

## Como funciona (fluxo)

1. Ao entrar num canal de voz (`VOICE_CHANNEL_SELECT`), o plugin puxa `GET <host>/config`
   e conecta no **signaling** (WebSocket), numa sala = **ID do canal de voz**.
2. Para cada outro participante com o plugin, abre uma conexão **P2P
   (RTCPeerConnection)**. A mídia vai direto entre os clientes (DTLS‑SRTP).
3. "Compartilhar tela" captura via `getDisplayMedia` (com áudio do sistema, se
   ligado) e envia aos peers. O painel/teatro mostra as transmissões da sala.
4. Ao sair do canal, desconecta e limpa.

O admin do servidor precisa **habilitar** o usuário (via hub) para que as funções
liguem — a policy (enabled + quotas de resolução/FPS) chega pelo próprio WS.

## Instalação

### Opção A — instalador gráfico (recomendado)

Rode o app em [../installer/](../installer): ele aplica a modificação, grava as
settings + a CSP do domínio e abre o hub. Sem terminal.

### Opção B — build manual dentro do Vencord

O Vencord compila plugins no build (não há runtime loading). Como o plugin importa
`livekit-client` (transporte legado), instale‑o **no repositório do Vencord**.

> **Clone o Vencord FORA deste repositório** (ex.: `~/Vencord`). Não clone dentro de
> `client/`: o `pnpm` "sobe" e usa o `package.json` deste projeto (sem script `build`),
> causando `Command "build" not found`.

```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord
cd ~/Vencord
pnpm install
pnpm add livekit-client            # dependência do plugin

# COPIE a pasta src/ como o userplugin (é ela que contém o index.tsx):
mkdir -p src/userplugins
cp -R /caminho/para/FRD_GOLIVE/client/src src/userplugins/frdGoLive

pnpm build
pnpm inject                        # injeta no Discord instalado
```

> **Copie `client/src`, não use symlink** e não copie `client/` inteiro: o Vencord
> espera `src/userplugins/frdGoLive/index.tsx`. Symlink quebra a resolução dos aliases
> (`@webpack/common` etc.).

Depois, no Discord: Configurações → Vencord → Plugins → **FRDGoLive** → ative e
configure:
- **Transport**: `Mesh P2P` (padrão).
- **tokenServiceUrl**: o host do servidor (ex.: `https://golivefrd.SEU.com`) — é de
  onde o plugin puxa `/config` e conecta no signaling.

> Todos os participantes precisam do plugin apontando para o **mesmo servidor**, e
> cada um precisa estar **habilitado** pelo admin no hub.

Ao mudar renderer (UI): `Ctrl/Cmd+R` no Discord. Ao mudar CSP/`native.ts`: reinício
completo do Discord.

## Captura nativa (regiões censuradas)

Em alguns países o Discord **desabilita compartilhar tela**. Como o plugin captura por
conta própria, isso normalmente não afeta — mas se o `getDisplayMedia` também estiver
bloqueado, ative **"Captura nativa"** nas settings.

Nesse modo o plugin usa o **`desktopCapturer` do Electron** (via `native.ts`) e captura
a fonte com `getUserMedia({chromeMediaSource:"desktop"})` — sem passar pelo
`getDisplayMedia` do Discord, contornando o bloqueio regional.

Notas:
- Só no **Discord Desktop** (Electron); no web não há `desktopCapturer`.
- Se o `getDisplayMedia` falhar com erro "duro", o plugin tenta a captura nativa
  automaticamente.
- Áudio do sistema por esse caminho depende da plataforma (melhor no Windows); se não
  suportado, captura só o vídeo.
