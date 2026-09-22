# Cliente FRD GoLive (userplugin do Vencord)

> **Status:** Fase 2 — esqueleto funcional. Precisa ser buildado dentro do Vencord.

Userplugin do Vencord que compartilha tela/câmera por um **servidor LiveKit
privado** (fora do Discord). A voz continua no Discord.

## Estrutura

```
src/
├── index.tsx               # definePlugin: wiring, subscribe em VOICE_CHANNEL_SELECT
├── settings.ts             # aba de settings (servidor, orgSecret, vídeo)
├── discordState.ts         # lê canal de voz atual + usuário (stores do Discord)
├── rtc/
│   ├── session.ts          # LiveKit puro (só depende de livekit-client) ✔ typecheckável
│   └── controller.ts       # orquestra: token → connect → publish/subscribe
├── state/
│   └── streamStore.ts      # store reativo puro (streams, connected, sharing)
└── ui/
    ├── PrivateStreamPanel.tsx  # painel flutuante com os <video> remotos
    ├── panelMount.tsx          # monta o painel no <body>
    └── styles.ts               # CSS do painel
```

**Camada RTC pura** (`rtc/session.ts` + `state/streamStore.ts`) não importa nada do
Vencord e é validada isolada:

```bash
npm install
npm run typecheck:rtc
```

O resto (`@webpack/common`, `@api/Settings`, `@utils/types`) só resolve dentro do
build do Vencord.

## Como funciona (fluxo)

1. Ao entrar num canal de voz (`VOICE_CHANNEL_SELECT`), o plugin pede um token ao
   `token-service` (`room = ID do canal de voz`) e conecta no LiveKit.
2. O painel flutuante aparece (canto inferior direito) listando quem está
   transmitindo naquela sala.
3. "Compartilhar tela" captura via `getDisplayMedia` (com áudio do sistema, se
   ligado nas settings) e publica na sala.
4. Ao sair do canal, desconecta e limpa o painel.

## Build dentro do Vencord

O Vencord compila plugins no build (não há runtime loading). Como usamos
`livekit-client`, ele precisa ser instalado **no repositório do Vencord** para o
esbuild empacotar.

> **Clone o Vencord FORA deste repositório** (ex.: `~/Vencord`). Não clone dentro
> de `client/`: o `pnpm` "sobe" e acaba usando o `package.json` deste projeto
> (que não tem script `build`), causando `Command "build" not found`.

```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord
cd ~/Vencord
pnpm install
pnpm add livekit-client            # dependência do nosso plugin

# vincule a PASTA src/ como o userplugin (é ela que contém o index.tsx):
mkdir -p src/userplugins
ln -s /caminho/para/FRD_GOLIVE/client/src src/userplugins/frdGoLive

pnpm build
pnpm inject                        # injeta no Discord instalado
```

O link é para **`client/src`**, não `client/`: o Vencord espera
`src/userplugins/frdGoLive/index.tsx`, e o nosso `index.tsx` fica em
`client/src/`. Linkar `client/` inteiro deixa o `index.tsx` fundo demais e o
plugin não é reconhecido. Se o build não seguir o symlink, copie no lugar:
`cp -R /caminho/para/FRD_GOLIVE/client/src ~/Vencord/src/userplugins/frdGoLive`.

Depois, no Discord: Configurações → Vencord → Plugins → **FRDGoLive** → ative e
preencha `serverUrl`, `tokenServiceUrl` e `orgSecret` (os mesmos do servidor).

> Todos os participantes precisam do plugin com a **mesma** config para se verem.

## Estado atual (Fases 2–4)

Implementado:
- Conexão/assinatura por canal de voz, publicação de tela com áudio do sistema.
- Reconexão automática: auto-reconnect do LiveKit para quedas transitórias +
  backoff próprio (busca token novo) quando o LiveKit desiste.
- Simulcast + qualidade adaptativa (`adaptiveStream`, `dynacast`).
- Painel com estados de conexão e erros acionáveis (offline, segredo inválido)
  e botão "Tentar de novo".

- Botões de **compartilhar tela** e **câmera**, com indicador de "🔴 Transmitindo"
  (tela/câmera) no painel.

Pendente (próximas fases):
- Painel próprio, não o tile nativo do Discord — por design.
- Seleção de fonte/janela específica pela UI.
