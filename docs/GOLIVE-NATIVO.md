# Go Live nativo — registro do experimento (2026-09-23 → 2026-09-24)

> **Status (2026-09-24, fim):** **RESOLVIDO e validado E2E.** A causa raiz era
> `keyframe_interval` ausente no op 4 — sem o campo, `alwaysSendVideo:false` e o
> encoder C++ nunca instancia (não "allocator"; ver `docs/MCP-DIAG.md`, "A parede
> era o keyframe_interval"). Ao vivo com espectador real: vídeo (H265/AV1) + áudio
> E2EE (DAVE v1) a ~4–6 Mbps, 100% repassado. Fix `NATIVE_STREAM_KEYFRAME_INTERVAL`
> (default 2000) mergeado (PR #28) e no ar no LXC.
>
> **O LiveKit foi REMOVIDO** (PR #29): o Go Live nativo redirecionado é agora o único
> caminho de mídia — tela privada (vídeo+áudio E2EE); **câmera fica nativa do Discord**.
> O instalador provisiona tudo (`nativeStreamEndpoint`, `nativeStreamDave`,
> `hijackNativeControls=false`) para um clique só. As seções "Modo HÍBRIDO" abaixo são
> **históricas** (o híbrido/LiveKit não existe mais). MCP local (`mcp/`, tools
> `frd-discord`) segue para diagnóstico ao vivo — ver `docs/MCP-DIAG.md`.

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
- `server/src/index.ts` — upgrade de WS roteado manualmente em `/dstream` (o
  antigo `/signaling` saiu junto com o LiveKit); com `path` o `ws` recusava
  outros caminhos.

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

## Modo HÍBRIDO — o que ficou funcionando (2026-09-24)

Como o vídeo nativo é um beco sem saída (allocator, acima), a branch passou a usar o
Go Live nativo **só pelo que ele entrega bem** e cobre o vídeo com o produto atual:

- **Shell/UX nativo** — a pessoa clica no Go Live nativo do Discord; aparece o balão
  "AO VIVO", a call, o tile do participante, tudo nativo.
- **Áudio ponta a ponta com E2EE (DAVE v1)** — o áudio da transmissão passa pelo
  servidor privado **cifrado** (o servidor não vê o conteúdo); o espectador decifra.
  Esta é a parte que **de fato funciona** da modificação nativa. Ver [DAVE.md](DAVE.md).
- **Vídeo pelo LiveKit sobreposto no tile nativo** — quando o Go Live nativo inicia,
  o plugin captura a MESMA fonte e publica **só o vídeo** no LiveKit (SFU do produto);
  no lado de quem assiste, `ui/nativeTileInject.ts` desenha esse vídeo em cima do tile
  nativo (que ficaria preto/Erro 2012). Resultado visível: um Go Live nativo comum, mas
  o vídeo trafega pelo servidor privado (LiveKit) e o áudio pelo DAVE.

### Como está montado (arquivos)
- `client/src/ui/hybridVideo.ts` — assina `STREAM_START` → `publishHybridVideo(sourceId)`
  e `STREAM_STOP` → `stopHybridVideo()`. **O nativo dirige o LiveKit**: iniciar/parar o
  Go Live nativo abre/fecha a transmissão do LiveKit automaticamente.
- `client/src/rtc/controller.ts` — `publishHybridVideo()` captura a fonte
  (`captureNativeSource`, **sem áudio** — o áudio é do nativo), tira as tracks de áudio e
  publica **vídeo-only** no LiveKit; `stopHybridVideo()` encerra.
- `client/src/probe/nativeStreamRedirect.ts` — no interceptor, **bloqueia o
  `VIDEO_STREAM_READY_TIMEOUT`** (Erro 2012) quando `nativeStreamHybrid` está ligado, para
  o Discord não matar o stream nativo (cujo vídeo nunca "fica pronto"). Também redireciona
  `STREAM_SERVER_UPDATE.endpoint` para o `/dstream`.
- `server/src/nativeStream.ts` — `NATIVE_STREAM_NO_VIDEO=1` força o **sink want 0** para
  quem transmite: o Discord não pede vídeo ao encoder nativo, então ele não captura/codifica
  vídeo à toa (já não produzia frames mesmo). Só áudio (E2EE) + shell no nativo; o vídeo é
  todo do LiveKit. Deixa a transmissão mais leve.
- **Volume** = controle **nativo do Discord** (botão direito na pessoa → "Volume do
  usuário"), já que o áudio é nativo. O menu do plugin (`ui/StreamContextMenu.tsx`) mostra
  "Volume: use o do Discord (áudio nativo)" no híbrido, em vez de um slider inerte (o stream
  do LiveKit é vídeo-only, não tem áudio para controlar).

### Settings do plugin para o híbrido
`nativeStreamEndpoint` = `SEU.com/dstream` · `nativeStreamDave` = on · `nativeStreamHybrid`
= on · `nativeTileOverlay` = on · `hijackNativeControls` = **off** (o hijack impede o Go
Live nativo de rodar). Todos com `restartNeeded`.

### Qualidade (2026-09-24)
O vídeo do LiveKit no híbrido saía baixo por dois motivos, corrigidos:
- `session.ts` publicava sem `degradationPreference` → o WebRTC borrava a **resolução**
  para manter FPS. Agora usa **`maintain-resolution`** (derruba FPS antes da resolução —
  texto/código nítidos) e bitrate maior (720p 3.5M / 1080p 6M / fonte 10M).
- `publishHybridVideo` rebaixava a "resolução da fonte" (`maxHeight 0`) para 720p; corrigido
  para preservar a escolha guardada. **Sem picker no híbrido**: usa a última qualidade do
  picker (padrão 1080p). Para a resolução nativa da tela, escolher "resolução da fonte" numa
  transmissão normal uma vez (fica guardada).

### Limitações conhecidas / onde paramos
- **Vídeo nativo: gate encontrado (2026-09-24, tarde)** — era `keyframe_interval`
  no op 4, não o allocator (ver `docs/MCP-DIAG.md`); com o campo, o encoder roda.
  Falta o teste E2E com espectador e o deploy do fix; o híbrido segue **até** o
  vídeo nativo ser validado (checklist de remoção em `docs/MCP-DIAG.md`). O MCP
  local (`discord_eval`/`discord_native`) foi o que destravou o diagnóstico.
- **macOS sem áudio de sistema** na captura (limitação do desktopCapturer/CATap) — não afeta
  o áudio nativo do DAVE, só a captura de som pelo LiveKit (que no híbrido nem é usada).
- O híbrido **captura a fonte duas vezes** em teoria (nativo + LiveKit), mas o
  `NATIVE_STREAM_NO_VIDEO` faz o nativo não pedir vídeo, então na prática só o LiveKit
  captura vídeo.

## Estado do servidor (LXC 100) em 2026-09-23

- `/opt/frd-golive` está na branch `feat/native-stream-probe`.
- `.env` ganhou `NATIVE_STREAM_*` (IP 147.15.36.121, UDP **7000** — porta já
  encaminhada VPS → Proxmox → LXC, reaproveitada). Backup do original:
  `server/.env.bak-dstream`.
- Para o híbrido, o `.env` está com **`NATIVE_STREAM_DAVE=1`** (áudio E2EE) e
  **`NATIVE_STREAM_NO_VIDEO=1`** (não pede vídeo ao encoder nativo; vídeo vai pelo LiveKit).
  `NATIVE_STREAM_VIDEO_CODEC=H264`. Rebuild: `cd /opt/frd-golive/server && docker compose
  up -d --build server`.
- **Teste de vídeo nativo (2026-09-24)**: para o encoder rodar, o `.env` precisa de
  `NATIVE_STREAM_NO_VIDEO=0` (senão o sink want manda px=0) e
  `NATIVE_STREAM_VIDEO_CODEC=` (vazio = segue o cliente como o Discord real — aqui, H265).
  `NATIVE_STREAM_EXPERIMENTS=fixed_keyframe_interval` já é o default do código novo.
  Diff de protocolo e checklist: `docs/MCP-DIAG.md`.
- **Resultado do teste (2026-09-24)**: corrigido um bug real (o op4 mandava
  `video_codec: opus` — o `pickVideoCodec` não filtrava codec de áudio; agora manda
  H265). Testado **com espectador real pedindo pixels** (`sink_wants 1440450px`) e codec
  certo: o encoder **continua em `bitrateTarget: 0` / `framesEncoded: 0`**, com captura OK
  (`frameRateInput 30`) e `framesDroppedEncoderQueue` subindo — **sem** limite de banda ou
  CPU (`bandwidthLimitedResolution/cpuLimitedResolution: false`). Todos os deltas de
  protocolo (codec, experiments, sink want real, TWCC, REMB, DAVE) estão descartados; a
  parede é interna ao encoder. Único lead restante: inspecionar o `discord_voice` (C++)
  pelo MCP. Registro decisivo em `docs/MCP-DIAG.md` ("Resultado decisivo").
  **Resolvido depois (mesmo dia, tarde):** a "parede interna" era o campo
  `keyframe_interval` faltando no op 4 — com ele no payload (ou
  `setKeyframeInterval(2000)` ao vivo via MCP), o encoder roda: 1080p30,
  366 MB, zero perda. Fix em `NATIVE_STREAM_KEYFRAME_INTERVAL` (ver
  `docs/MCP-DIAG.md`).
- **Deploy pendente (2026-09-24, tarde):** `git pull` (branch do fix) e
  `docker compose up -d --build server` — o default novo
  `NATIVE_STREAM_KEYFRAME_INTERVAL=2000` passa a mandar `keyframe_interval` no
  op 4 e o encoder liga sozinho em toda stream (sem JS manual). Alternativa sem
  rebuild: `NATIVE_STREAM_SESSION_OVERRIDE={"keyframe_interval":2000}` no `.env`.
  **Restart mata a stream atual** — fazer após o teste E2E.
- Para voltar ao estado da `main`:
  ```bash
  cd /opt/frd-golive && git checkout main && cp server/.env.bak-dstream server/.env && docker compose -f server/docker-compose.yml up -d --build server
  ```
