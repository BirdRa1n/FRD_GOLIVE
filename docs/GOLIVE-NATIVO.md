# Go Live nativo — registro do experimento (2026-09-23)

> **Status: pausado.** Código só na branch `feat/native-stream-probe` (PR #27).
> **Não fazer merge** desta branch como está. Registro do que foi feito.

## O que foi investigado

Se seria possível usar o Go Live nativo do Discord (captura e encoder nativos)
enviando a mídia para o servidor privado em vez do servidor do Discord.

## O que existe na branch

**Cliente (`client/src/probe/`)**
- `streamProbe.ts` — sonda **somente leitura** (setting `streamProbe`, padrão
  desligado). Registra eventos Flux de transmissão, frames do WS de sinalização de
  mídia e requisições `/streams/*`, com tokens/chaves mascarados. No console:
  `FRDStreamProbe.copy()`. É a parte útil independentemente do resto.
- `nativeStreamRedirect.ts` + patch em `index.tsx` — experimento de
  redirecionamento (setting `nativeStreamEndpoint`, padrão vazio = desligado).

**Servidor**
- `server/src/nativeStream.ts` — servidor experimental em `/dstream` + UDP.
  Só liga se `NATIVE_STREAM_PUBLIC_IP` estiver definido no `.env`.
- `server/src/twcc.ts` — feedback transport-cc (RTCP), módulo puro.
- `server/src/index.ts` — upgrades de WS agora roteados manualmente
  (`/signaling` e `/dstream`); com `path` o `ws` recusava outros caminhos.

## Resultado

- Sinalização, repasse de **áudio** da transmissão entre duas contas e controle
  de banda funcionaram pelo servidor privado.
- **Vídeo não saiu do encoder nativo.** Diagnóstico fechado (2026-09-23, sessão
  seguinte): o sintoma é `bitrateTarget: 0` no encoder de vídeo **mesmo com**
  captura OK (`frameRateInput` ~30), sink want correto e transporte com 8 Mbps
  (`receiverBitrateEstimate` do nosso REMB). O alocador nativo dá bitrate ao áudio
  (`bitrateTarget: 128000`) e **0 ao vídeo**.
- Tentativas que **ajudaram nas bordas mas não destravaram**: REMB, transport-cc
  (`twcc.ts`), sink want por pixel, PLI/keyframe (`requestKeyframe`), Caminho A
  (forçar `max_dave_protocol_version: 0` no IDENTIFY, em `nativeStreamRedirect.ts`).
- **Captura do protocolo real** (sonda, redirect desligado) revelou a única
  diferença cripto relevante: o fluxo real que produz vídeo roda **DAVE v1 +
  secure_frames v1**; o nosso servidor força os dois a `0`. Hipótese de trabalho:
  **o encoder de vídeo nativo só aloca bitrate com o caminho DAVE/secure-frames
  ativo.** Próximo passo = implementar o DAVE v1 (delivery service MLS) para
  validar/destravar. Protocolo capturado e plano faseado em [DAVE.md](DAVE.md).

## Achados úteis para o produto atual

- **O cliente do Discord sobe prints da tela** para a API
  (`ApplicationStreamPreviewUploadManager`, `POST /streams/:key/preview`) durante
  o Go Live nativo. Reforça manter o Go Live nativo bloqueado com o plugin ativo.
- Diagnóstico do encoder nativo, no console, durante uma transmissão:
  ```js
  const ME = Vencord.Webpack.findStore("MediaEngineStore").getMediaEngine();
  [...ME.connections].filter(c => c.context === "stream").forEach(c => c.getStats().then(s => console.log(JSON.stringify({transport: s.transport, video: s.rtp.outbound.find(o => o.type === "video")}, null, 1))));
  ```
  `framesEncoded` / `framesDroppedEncoderQueue` / `bitrateTarget` indicam se o
  vídeo está sendo codificado.

## Estado do servidor (LXC 100) em 2026-09-23

- `/opt/frd-golive` está na branch `feat/native-stream-probe`.
- `.env` ganhou `NATIVE_STREAM_*` (IP 147.15.36.121, UDP **7000** — porta já
  encaminhada VPS → Proxmox → LXC, reaproveitada). Backup do original:
  `server/.env.bak-dstream`.
- Para voltar ao estado da `main`:
  ```bash
  cd /opt/frd-golive && git checkout main && cp server/.env.bak-dstream server/.env && docker compose -f server/docker-compose.yml up -d --build server
  ```
