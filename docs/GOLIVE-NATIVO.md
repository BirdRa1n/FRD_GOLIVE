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
- **Captura do protocolo real** (sonda, redirect desligado) revelou que o fluxo real
  que produz vídeo roda **DAVE v1 + secure_frames v1**; o nosso servidor forçava os
  dois a `0`. Hipótese testada: implementar o DAVE v1 destravaria o vídeo.
- **DAVE v1 foi implementado por inteiro** (servidor como external sender MLS, via
  `ts-mls`; handshake op25→op24/21→op26→op27→op28→op29/op30→op23/op22; grupo com
  espectador; áudio **E2EE ponta a ponta funcionando** — o viewer decifra o áudio).
  Protocolo, receita do libdave e plano em [DAVE.md](DAVE.md).
- **Mas o DAVE NÃO resolveu o vídeo** (2026-09-23): as stats do encoder mostram
  `framesEncoded: 0`, `resolution: 0×0`, `framesDroppedEncoderQueue` crescendo, mesmo
  com captura (30fps), sink want e `bitrateTarget` às vezes > 0. O "vídeo" que parecia
  fluir era **probe/RTX** (pt104, `head=0000`), não H265.

### Fechamento do experimento (2026-09-23) — deep-dive esgotado
O gate é o **alocador de bitrate do encoder nativo**, inacessível de fora. Confirmado:
- op12 e select_protocol do nosso transmissor são **idênticos** ao Discord real
  (`max_bitrate:3500000`, `max_resolution:1280×720`, codecs opus/AV1/H265/H264/VP8 com os
  mesmos PTs). O cliente está totalmente configurado — o gate não é o cliente.
- Transporte com **8 Mbps** (`availableOutgoingBitrate`/`receiverBitrateEstimate` = 8e6),
  mas o alocador dá **0** ao vídeo (`bitrateTarget: 0`).
- Tudo que o servidor real manda diferente foi implementado e testado: **REMB, transport-cc,
  sink want (formato real + clamp ao max_resolution), PLI, DAVE v1 completo, RTCP Receiver
  Reports**. Nenhum faz `framesEncoded` sair de 0.
- **Conclusão:** o `bitrateTarget: 0` é o mesmo estado inicial; o encoder nativo se recusa a
  codificar pelo servidor privado por decisão interna do allocator que nenhum sinal do
  gateway (WS/RTCP) influencia. **Encerrado por esgotamento de leads.** O que ficou de valor:
  o **DAVE v1 completo** (external sender MLS, handshake, grupo) e **áudio E2EE ponta a ponta**
  (o espectador decifra o áudio). Ver [DAVE.md](DAVE.md). O produto segue no caminho **LiveKit
  SFU** (`main`).

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
