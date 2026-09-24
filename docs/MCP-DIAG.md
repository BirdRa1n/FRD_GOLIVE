# Diagnóstico profundo via MCP — ponte agente ↔ Discord

> Meta: **destravar o vídeo do Go Nativo pelo servidor privado e remover o
> LiveKit.** As docs antigas (GOLIVE-NATIVO.md, DAVE.md) fecham com
> "inviável", mas essa conclusão cobre só os leads testados *sem conseguir olhar
> o cliente durante a sessão*. Este MCP existe justamente para testar os inputs
> que faltaram.

## Arquitetura

```
OpenCode (agente)
   │  MCP stdio — tools discord_*
   ▼
mcp/ (este pacote) ── HTTP 127.0.0.1:8756 + token ~/.frd-golive/mcp-token (0600)
   ▲                          ▲
   │ POST /poll  /result      │ (Electron main — client/src/native.ts,
   │                          │  sem CSP, é o único que pode falar localhost)
Discord (renderer)  ← poll 100ms via VencordNative.pluginHelpers.FRDGoLive
   client/src/diagBridge.ts executa: stats, flux, probe, stores, eval…
```

Por que o processo main está no meio: o renderer roda em `https://discord.com`
e o CSP bloquearia `http://127.0.0.1`; o processo principal do Electron não tem
essa restrição. O renderer só conversa com o main por IPC (o padrão já usado
pelo `getScreenSources`).

## Setup

```bash
# 1) builda o MCP (uma vez)
cd mcp && npm install && npm run build && cd ..

# 2) confirma que o OpenCode registrou (já está no opencode.json)
opencode mcp list          # deve mostrar frd-discord connected

# 3) instala o plugin ATUALIZADO no Discord (client/src tem diagBridge.ts)
#    — pelo instalador, ou manualmente:
ln -s "$PWD/client/src" ~/Vencord/src/userplugins/frdGoLive   # se ainda for cópia, troque por symlink
cd ~/Vencord && pnpm build && pnpm inject

# 4) no Discord: Configurações do plugin FRDGoLive →
#    "[Diagnóstico] Ponte MCP" = LIGADO → Ctrl+R (reiniciar o Discord)
```

Teste: chame a ferramenta `discord_status` → `"discordOnline": true`.

Se nada funcionar: `mcp/dist` existe? setting ligada? Ctrl+R feito? Outra
sessão do OpenCode ocupando a porta (troque com `FRD_MCP_PORT=8757`)?

## Ferramentas (`frd-discord`)

| Tool | O que faz |
|---|---|
| `discord_status` | Ponte/token/config do plugin. **Comece por aqui.** |
| `discord_media_stats` | Snapshot das conexões do MediaEngine (no Discord atual é UMA, `context: "default"`, com `videoStreamParameters` + sink wants + stats: `bitrateTarget`, `framesEncoded`, `resolution`…). O encoder só roda com Go Live ativo. |
| `discord_media_watch` | Amostra os mesmos stats durante N segundos — para ver o encoder **reagir** enquanto você muda algo no servidor. |
| `discord_probe` | Sonda de protocolo (flux + WS `wss://*.discord.media` + chamadas ao `discord_voice` + HTTP `/streams/*`), tokens mascarados. `start`/`dump`/`clear`/`stop`. |
| `discord_flux` | Grava ações do FluxDispatcher ao vivo (`filter`: prefixo do `type`, ex. `"STREAM"`). |
| `discord_console` | Ring buffer de console (log/warn/error) do Discord desde que a ponte ligou. |
| `discord_store` | Lê store do Discord pelo nome (ex. `MediaEngineStore`) e opcionalmente chama um method. |
| `discord_eval` | Executa JS arbitrário no renderer (async IIFE; tokens redigidos no retorno). |
| `discord_settings` | Lê/escreve as settings do plugin em tempo real (`restartNeeded` exige Ctrl+R). |
| `discord_dispatch` | Despacha uma ação FluxDispatcher (experimentos dirigidos). |
| `discord_native` | Introspecciona o módulo C++ `discord_voice`: `list=true` devolve a superfície (seguro); `list=false` + `method` **chama** a função (pode travar o Discord); `withCallback: true` injeta o callback para getters que exigem 1 função (ex.: `getCodecCapabilities`). |

## Playbook: destravar o vídeo nativo

Contexto: áudio nativo já vai pelo servidor (`/dstream` + DAVE v1). O muro é o
encoder: `bitrateTarget: 0`, `framesEncoded: 0`, `resolution "0x0"` — os quadros
chegam (`frameRateInput: 30`) e nunca saem.

Estado das hipóteses após a primeira leva de dados via MCP (2026-09):

1. **`experiments` do READY (op 2)** — **delta confirmado**: o real manda
   `["fixed_keyframe_interval"]`, nós mandávamos `[]`. → servidor agora tem
   `NATIVE_STREAM_EXPERIMENTS` (default já é o do real).
2. **`video_codec` do op 4** — **delta confirmado e doc corrigida**: o real NÃO
   responde AV1 — `getCodecCapabilities` deste cliente dá `AV1 encode:false`
   (só decode) e o op 4 real escolhe o de **menor priority com `encode:true`
   = H265** (priority 2000; H264 é 3000). Nós fixávamos `H264`. → servidor:
   `NATIVE_STREAM_VIDEO_CODEC` **vazio = segue o cliente** (não vazio = força;
   limpe o valor velho no `.env` do servidor!).
3. **`streams[].active`** — **caiu**: o READY real também manda `active:false`;
   não é o kill switch.
4. **Ops S→C** — **delta confirmado**: o real manda `op15 {any:100}` logo após o
   op 4, **antes** do op 12 de quem transmite; o nosso não mandava (o
   `sendWants` só rodava no streamer path, no-op pré-op12) → agora manda (a
   menos que `NATIVE_STREAM_NO_VIDEO=1`). `op16` já era respondido igual
   (`voice 0.22.1 / rtc_worker 1.6.92`).
5. **TWCC com media SSRC errado** — **bug confirmado no código**: o feedback
   saía com `m.twcc.build(SERVER_SSRC, m.audioSsrc)`, mas a extensão
   transport-cc só aparece nos pacotes de **vídeo** (opus não a carrega — ver
   `trackTwcc`) → o mediaSSRC apontava para áudio. Corrigido para o ssrc de
   vídeo.
6. **Superfície do `discord_voice` (C++)** — **feita**: sem gates óbvios de
   encoder; getters úteis já lidos: `getCodecCapabilities` (AV1 decode-only;
   H264/H265/VP8 encode) e `getSupportedBandwidthEstimationExperiments`
   (`loss-based-bwe-v2`, `robust-estimator`, janelas `trendline-*` — sem
   "twcc" gate). Use `discord_native {withCallback: true}` nesses getters.

O que a sessão real mostrou do cliente (via MCP, antes de qualquer Go Live):
conexão **única** `context:"default"` com `videoStreamParameters` (rid 100,
720p@20fps, `maxBitrate 2500000`) em `active:false, targetBitrate:0`;
`local/remoteVideoSinkWants {any:100}` já no connect; `receiverBitrateEstimate:0`
— é o feedback de banda (REMB/TWCC) do servidor que tem que povoar isso (ver
comentário do REMB em `server/src/nativeStream.ts`).

### Passo 1 — diff de protocolo: sessão real vs sessão nossa

Os campos principais de A já são conhecidos (ver o estado das hipóteses acima);
o dump completo serve para achar deltas que faltam.

```text
A) REAL:    settings → nativeStreamEndpoint = "" (vazio), hijack = OFF,
            unlockNativeVideoGate = ON, streamProbe pode ficar OFF.
            discord_probe {op:"start"} → iniciar Go Live → deixar rodar ~15 s
            → discord_probe {op:"dump", tail:3000}  → gravar dump A.
B) NOSSA:   nativeStreamEndpoint = SEU.com/dstream (+ DAVE ON se o servidor
            tiver NATIVE_STREAM_DAVE=1) → Ctrl+R → repetir → dump B.
```

Comparar A vs B campo a campo, com foco em: **op 2 READY** (`experiments`,
`streams[]` incl. `active`/`quality`/`rtx_ssrc`, campos extras que só o real
tem), **op 4** (`video_codec`), e qualquer **op S→C numérico** presente só em A.
Cruzar com os logs `op X não tratado` do container do servidor.

### Passo 2 — observar o encoder reagir enquanto você muda o servidor

```text
discord_media_watch {seconds:15, intervalMs:500}
   → nos ~primeiros 5 s: reiniciar o container com a env nova
     (cd /opt/frd-golive/server && docker compose up -d --build)
   → iniciar Go Live e ver se bitrateTarget / framesEncoded /
     qualityLimitationReason saem de zero.
```

Repetir por hipótese (codec H265, experiments, TWCC…). `qualityLimitationReason`
distingue "bandwidth" (TWCC/BWE) de "cpu"/"other" (gate interno).

### Passo 3 — quem decide ligar o encoder

```text
discord_flux {op:"start", filter:"RTC"}   (e depois "MEDIA", "STREAM")
discord_store {store:"MediaEngineStore", method:"getMediaEngine"}
discord_eval  → procurar no JS quem chama discord_voice com args de vídeo
                (ex.: varre webpack por módulos que citam "setVideoQuality",
                 "goLive", "bitrate"…)
discord_native {list:true}                → superfície C++ do discord_voice
```

Achado o candidato: `discord_native {list:false, method:..., args:[...]}` para
tentar ligar/desenligar diretamente (com cuidado — pode travar o Discord;
Ctrl+R volta ao normal).

## Segurança

- Setting **default OFF**; bind só em `127.0.0.1`; token em
  `~/.frd-golive/mcp-token` (0600) — o Discord só fala com quem tem o arquivo.
- `discord_eval` = execução de código arbitrário no Discord de quem ligou a
  ponte. Só em máquina própria; desligue a setting fora de sessões de
  diagnóstico. Tokens/chaves são redigidos automaticamente nos retornos.
- Uma ponte por vez (porta 8756; `FRD_MCP_PORT` muda).
- Uso de client mod é contra o ToS do Discord (ver CONTRIBUTING.md).

## Depois que o vídeo nativo passar: remover o LiveKit (checklist)

O híbrido (LiveKit sobreposto no tile) fica **até** o vídeo nativo fluir — é o
único caminho de vídeo existente hoje; remover antes = ficar sem vídeo nenhum.
Quando passar, remover em um commit dedicado:

- **cliente**: `client/src/ui/hybridVideo.ts`; `publishHybridVideo`/
  `stopHybridVideo` em `client/src/rtc/controller.ts`; `startHybrid`/
  `stopHybrid` em `client/src/index.tsx`; setting `nativeStreamHybrid` (e a
  lógica que a consulta); dependência `livekit-client` do `client/package.json`;
  textos do plugin que citam LiveKit (description do `definePlugin`).
- **servidor**: rota `POST /token` em `server/src/index.ts`; `server/src/livekit.ts`;
  serviço `livekit` do `server/docker-compose.yml`; envs `LIVEKIT_*` do
  `.env.example`.
- **overlay**: com vídeo nativo, o Discord renderiza o tile sozinho —
  `nativeTileInject` sobre-vídeo (`ui/nativeTileInject.ts`) fica dispensável
  (manter só o que injeta painel/controles, se ainda for útil).
- **docs**: trechos híbridos em GOLIVE-NATIVO.md/DAVE.md/ROADMAP.md.
