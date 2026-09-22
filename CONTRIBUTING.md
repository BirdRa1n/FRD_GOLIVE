# Contribuindo

Obrigado pelo interesse! Este projeto tem duas metades independentes:

- **`server/`** — servidor self-host (LiveKit + token-service). Roda sozinho e é
  testável sem o Discord. **Comece por aqui.**
- **`client/`** — userplugin do Vencord. Precisa de uma build do Vencord a partir
  do código-fonte.

## Rodando o servidor (dev)

Pré-requisitos: Docker + Docker Compose.

```bash
cd server
cp .env.example .env      # edite os segredos
docker compose up --build
```

- LiveKit: `ws://localhost:7880`
- token-service: `http://localhost:8080` (`GET /health`, `POST /token`)

Teste rápido de emissão de token:

```bash
curl -s http://localhost:8080/token \
  -H 'Content-Type: application/json' \
  -d '{"room":"123","identity":"alice","orgSecret":"SEU_ORG_SECRET"}'
```

Para validar publish/subscribe fim-a-fim antes do plugin existir, use o
[LiveKit Agents Playground](https://agents-playground.livekit.io/) ou o
`livekit-cli` apontando para o servidor local com um token emitido acima.

## Rodando o plugin (dev) — visão geral

O Vencord compila plugins **no build**; não há carregamento em runtime. Fluxo:

```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord   # FORA deste repo
cd ~/Vencord
pnpm install
pnpm add livekit-client
mkdir -p src/userplugins
ln -s /caminho/para/FRD_GOLIVE/client/src src/userplugins/frdGoLive
pnpm build
pnpm inject      # injeta no cliente Discord instalado
```

Clone o Vencord **fora** deste repositório (senão o `pnpm` sobe e usa o
`package.json` daqui, que não tem script `build`). Linke a pasta **`client/src`**
(que contém o `index.tsx`), não `client/`. Ver `client/README.md` para detalhes.

## Estilo

- TypeScript com `strict` ligado.
- Commits pequenos e descritivos.
- Sem segredos no versionamento (`.env` está no `.gitignore`).

## Aviso

Uso de client mod é contra o ToS do Discord — contribua ciente disso.
