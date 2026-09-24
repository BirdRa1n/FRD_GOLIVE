# DAVE (E2EE do Go Live nativo) — protocolo real e plano de implementação

> Contexto: o experimento de relay do Go Live nativo (`server/src/nativeStream.ts`,
> ver [GOLIVE-NATIVO.md](GOLIVE-NATIVO.md)) trava com o **vídeo não saindo do encoder**
> (`bitrateTarget: 0`) mesmo com captura, sink want e REMB corretos. A captura do
> protocolo **real** do Discord (sonda `streamProbe`, com o redirect desligado) mostrou a
> única diferença cripto relevante: o fluxo que produz vídeo roda **DAVE v1 + secure
> frames v1**, e o nosso servidor força os dois a `0`. Hipótese de trabalho: **o encoder
> de vídeo nativo só aloca bitrate com o caminho DAVE/secure-frames ativo.** Implementar o
> DAVE v1 é o próximo passo para validar/destravar.

## O que é o DAVE

E2EE de áudio/vídeo do Discord, por cima do transporte SRTP. Baseado em **MLS (RFC 9420)**.
Os clientes formam um grupo MLS e derivam chaves por-emissor; cada frame de mídia é cifrado
**depois** do codec (camada interna, marcador `0xfafa`). O servidor de mídia entra como
**external sender + delivery service (DS)**: relaya as mensagens MLS e coordena as
transições de epoch, mas **nunca** aprende a chave do grupo (E2EE de verdade — nem o
servidor vê o vídeo). Ciphersuite: **MLS 0x0002** (`MLS_128_DHKEMP256_AES128GCM_SHA256_P256`, **P256/ECDSA**) —
confirmado pelos bytes reais do op 26 (init_key P256 de 65B, prefixo `0x04`). **Não** é a
0x0001/X25519. O external sender (op 25) também é P256.

> **op 26 = KeyPackage CRU**, não um MLSMessage embrulhado. Head real:
> `00 01` (version mls10) · `00 02` (cipher_suite P256) · `40 41 04…` (init_key 65B). Decodifica
> com `decodeKeyPackage`, não `decodeMlsMessage`.

## Protocolo real capturado (2026-09-23)

Fonte: dump da sonda no transmissor Windows (Go Live normal, sem redirect). Ver o registro
em [GOLIVE-NATIVO.md](GOLIVE-NATIVO.md).

### op 4 (SESSION_DESCRIPTION) real
```json
{ "video_codec": "AV1", "audio_codec": "opus", "mode": "aead_aes256_gcm_rtpsize",
  "secret_key": "[32]", "media_session_id": "…",
  "dave_protocol_version": 1, "secure_frames_version": 1 }
```
Sem array `codecs` — o mapa de payload types vem no **op 1 (SELECT_PROTOCOL)** que o
**cliente** envia (opus=120; AV1 101/rtx102; H265 103/rtx104; H264 105/rtx106; VP8 107/rtx108).
O `max_bitrate` do encoder (3500000) vem no **op 12** do próprio cliente — o servidor não
precisa fornecer isso.

### Opcodes DAVE (frames binários no WS)
Formato: **S→C** `[seq u16 BE][op u8][payload]`; **C→S** `[op u8][payload]` (sem seq).

| op | nome | direção | conteúdo |
|----|------|---------|----------|
| 21 | PREPARE_TRANSITION | S→C | `{transition_id, protocol_version}` (JSON) |
| 22 | EXECUTE_TRANSITION | S→C | `{transition_id}` (JSON) |
| 23 | TRANSITION_READY | C→S | `{transition_id}` (JSON) |
| 24 | PREPARE_EPOCH | S→C | `{epoch, protocol_version}` (JSON) |
| 25 | MLS_EXTERNAL_SENDER | S→C | binário: credential + chave pública do external sender |
| 26 | MLS_KEY_PACKAGE | C→S | binário: key package do cliente |
| 27 | MLS_PROPOSALS | S→C | binário: propostas (Add/Remove) a aplicar |
| 28 | MLS_COMMIT_WELCOME | C→S | binário: commit (+ welcome) do committer |
| 29 | MLS_ANNOUNCE_COMMIT_TRANSITION | S→C | binário: commit da transição |
| 30 | MLS_WELCOME | S→C | binário: welcome para os novos membros |
| 31 | MLS_INVALID_COMMIT_WELCOME | C→S | pede reset (commit/welcome inválido) |

### Sequência observada (conexão de stream, 1 transmissor + 1 espectador)
```
C→S op 0  IDENTIFY {…, max_dave_protocol_version: 1}
S→C op 8  HELLO / op 2 READY
C→S op 1  SELECT_PROTOCOL {codecs[], …}
C→S op 12 VIDEO {streams:[{ssrc, rtx_ssrc, max_bitrate, max_resolution, …}]}
S→C op 4  SESSION_DESCRIPTION {dave_protocol_version:1, secure_frames_version:1}
S→C op 15 MEDIA_SINK_WANTS {"<ssrc>":100, pixelCounts:{"<ssrc>":<pixels>}, any:100}
S→C op 25 MLS_EXTERNAL_SENDER            (74B)
S→C op 27 MLS_PROPOSALS                  (~500B)
C→S op 26 MLS_KEY_PACKAGE               (~394B)
C→S op 28 MLS_COMMIT_WELCOME            (~1160B)
S→C op 30 MLS_WELCOME                    (~960B)   (quando entra espectador)
S→C op 24 PREPARE_EPOCH {epoch:1, protocol_version:1}
S→C op 21 PREPARE_TRANSITION {transition_id:0, protocol_version:1}
… mídia cifrada flui …
```

### op 15 (MEDIA_SINK_WANTS) — formato correto
```json
{ "<video_ssrc>": 100, "pixelCounts": { "<video_ssrc>": 688640 }, "any": 100 }
```
Qualidade por-ssrc e `any` = **100** (percentual); a contagem de pixels vai **só** em
`pixelCounts`. (Já corrigido em `sendWants` — mas isto sozinho **não** destrava o vídeo.)

## Arquitetura no nosso servidor

`server/src/nativeStream.ts` já é o gateway (WS v8 + UDP). Adicionar:

1. **Framing binário** (Phase 0 — feito o esqueleto): parse/emit `[seq?][op][payload]`.
   Constantes em `DAVE_OP`. O `send()` precisa de um caminho binário com `seq` no S→C.
2. **External sender + Delivery Service MLS**: gerar keypair Ed25519 do external sender;
   anunciar em op 25; coletar op 26 (key packages); emitir op 27 (Add proposals);
   receber op 28 (commit+welcome) do committer; distribuir op 29/30; coordenar epochs
   com op 24/21/22. O servidor **não** é membro do grupo → nunca vê a chave de mídia.
3. **Relay inalterado**: continua repassando RTP opaco (a mídia segue cifrada no
   transporte com `secret_key`; a camada DAVE é interna e passa intacta). Consequência:
   com DAVE ligado, **o servidor também deixa de ver o vídeo** — E2EE real.

### Biblioteca MLS — **escolhida e validada: `ts-mls`** (v1.6.4)
TypeScript puro (RFC 9420), roda em Node sem deps nativas/WASM — mantém o `server/` na
mesma toolchain (tsc). API confirmada (inspeção dos `.d.ts`):
- **External sender:** `ExternalSender { signaturePublicKey, credential }` + `encodeExternalSender`
  (payload do op 25); `proposeExternal(groupInfo, proposal, sigPub, sigPriv, cs)` e
  `proposeAddExternal(...)` — o servidor cria propostas externas assinadas sem ser membro
  do grupo (papel external sender + DS; op 27).
- **Ciphersuite 0x0001** (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`) presente; provider
  **`noble`** (JS puro).
- Peças RFC 9420: `keyPackage` (decode op 26), `createCommit`, `groupInfo`, `processMessages`,
  `extension`/`defaultExtensionType` (extensão `external_senders`), codec TLS.

**Risco aberto (trabalho de integração da Phase 1):** o *framing DAVE* em volta dos objetos
MLS (headers/prefixos por opcode, ex.: `transition_id` nos payloads binários) tem que casar
com o `libdave` do Discord — a `ts-mls` dá os objetos MLS (RFC 9420), mas o embrulho
específico do DAVE é nosso. Referência: `libdave`.
- Descartada: **`@wireapp/core-crypto`** (Rust/WASM) — external senders maduros, mas peso do
  WASM e storage persistente que não precisamos.
- Referência de wire-format: **`libdave`** (C++, do próprio Discord).

## Parâmetros DAVE v1 (confirmados, discord/dave-protocol)
- MLS 1.0; ciphersuite **DHKEMP256_AES128GCM_SHA256_P256** (0x0002).
- **Uma** extensão de grupo: `external_senders` (com o external sender do voice gateway).
- Sem extensões de leaf node. Credential: **basic** apenas.

## Estado da Phase 1 (2026-09-23, testado ao vivo)
Negociação DAVE v1 **funciona** com o flag `NATIVE_STREAM_DAVE=1` + cliente com
`nativeStreamDave` ligado. Log do cliente confirmou:
```
DAVE protocol init with protocol version: 1
Received MLS external sender package          (nosso op25 aceito)
Preparing DAVE protocol epoch: 1              (nosso op24 aceito)
Preparing DAVE protocol transition: 0         (nosso op21 aceito)
DAVE protocol state update: {version:1, epochAuthenticator:""}
Got MLS key package, sending to RTC server    (cliente enviou op26)
```
O cliente entra em v1 e envia o key package, mas **trava** esperando o **op 27**
(Add proposal) para fazer o commit e estabelecer o epoch. Sequência exata que falta
(membro solo, confirmada na spec):
```
op27 (servidor: Add proposal do key package do cliente)
→ op28 (cliente: commit + welcome)
→ op29 (servidor: echo do commit + transition_id)
→ op23 (cliente: ready)   → op22 (servidor: execute_transition)  → mídia E2EE flui
```
**op 27 — receita completa (extraída do `discord/libdave`, cpp/test/external_sender.cpp
e cpp/src/mls/session.cpp):**
- **group_id** = 8 bytes **big-endian** de `BigInt(channel_id)` (`session.cpp`:
  `groupId_ = BigEndianBytesFrom(groupId)`; `DaveSessionManager.ts`:
  `Init(version, BigInt(groupId), selfUserId, key)`). O `channel_id` vem do **IDENTIFY**.
- **credential do external sender** = basic, identity `{0x00,0x01,0x01,0x00}` (já aplicado
  em `createExternalSender`).
- **signerIndex** (índice na extensão external_senders) = **0**.
- **epoch** do Add proposal no bootstrap = **0**.
- **ProposeAdd** = `external_proposal(ciphersuite, group_id, epoch, Proposal{Add{keyPackage}},
  signerIndex=0, signKey)`. Na `ts-mls`: `proposeExternal(groupInfo, addProposal, sigPub,
  signKey, cs)` com um `groupInfo.groupContext` fabricado:
  `{version:"mls10", cipherSuite:P256, groupId, epoch:0n, treeHash:[], confirmedTranscriptHash:[],
  extensions:[{extensionType:"external_senders", extensionData: encodeExternalSender(es.external)}]}`
  (external proposal não assina sobre tree/transcript, então esses ficam vazios). O
  `addProposal` = `{proposalType:"add", add:{keyPackage: decodeKeyPackage(op26)}}`.
- **framing do op 27**: `operation_type(u8=0 append) | MLSMessage proposal_messages<V>`
  (vetor TLS `<V>` de um MLSMessage `mls_public_message`).
- **op 28 → op 29**: op 29 = `transition_id(u16) | commit_message` — ecoa o primeiro
  MLSMessage do op 28 (o commit) de volta com o transition_id (0). (Welcome/op30 não é
  necessário no membro solo.) Depois o cliente manda **op 23** e nós **op 22**.
- **Ordem**: no dump real (com espectador) o op24/op21 vieram **depois** do op28; pode ser
  preciso mover a nossa transição para depois do op29 (hoje mandamos cedo, e o cliente
  aceitou, mas revisar se travar).

## ✅ RESULTADO Phase 1 — hipótese confirmada (2026-09-23)
Com o handshake DAVE v1 completo, o **vídeo destravou**. Log do servidor:
```
DAVE op27 (proposals, 0 add) → 2B          (op27 vazio: solo comita o próprio grupo)
DAVE op29 (announce commit tid 0) → 405B   (cliente enviou op28 commit; ecoamos op29)
decifrou H265 ssrc 1005 ...                (VÍDEO! pt104 sustentado ~122 kbps)
```
**O encoder de vídeo nativo exige DAVE/secure-frames ativo para alocar bitrate.** Com o
grupo MLS estabelecido, `bitrateTarget` saiu de 0 e o H265 fluiu sustentado. Sequência
solo que funciona: op25 → op24/op21 → (cliente op26 ×2) → **op27 vazio** → (cliente op28
commit) → **op29** (echo do commit + transition_id 0) → mídia. (O cliente não precisou
mandar op23/nós op22 no solo — comitou e começou a cifrar.)

## Phase 2 — espectador (parcial: E2EE funciona, falta o relay de vídeo)
Implementado e testado ao vivo. **O que funciona:**
- Fluxo committer/viewer completo: viewer deposita key package → servidor manda ao committer
  o op27 com o **Add do viewer** (no epoch atual) → committer comita (op28 commit+welcome) →
  servidor ecoa **op29** aos membros + **op30 (welcome)** ao viewer → op23/op22.
- **O viewer ENTRA no grupo MLS** (`epochAuthenticator` populado no cliente).
- **Áudio E2EE ponta a ponta**: o viewer recebe e **decifra** o áudio (`decryptSuccessCount`
  centenas, provado nas stats). A camada DAVE/relay está correta.
- Descobertas de implementação:
  - **Key package do viewer:** o libdave descarta a chave privada a cada op26; usar o
    **último** key package (debounce), senão o welcome fica inválido (`Flagging invalid`).
  - **Após cada transição de epoch o encoder PAUSA a mídia** — o servidor re-envia o sink
    want + PLI (`requestKeyframe`) pós-transição para o vídeo voltar.

**Falta (last-mile, independente do DAVE):** o **vídeo não chega ao receptor do viewer**
(`bytesReceived: 0` no vídeo; áudio OK). Diagnóstico fechado com log de pares (PT,ssrc):
- op12 do transmissor: `video_ssrc=1007, rtx_ssrc=1008`.
- O transmissor envia vídeo **só** como `pt104` no ssrc **1008** (`envia …: pt104:1008`) —
  **um único par, sem `pt103:1007` primário**. `pt104` = H265 **RTX** no mapeamento padrão do
  Discord; `head=0000…` no decifrado reforça que não é NAL primário.
- O viewer monta o receptor de vídeo no **primário (1007)** → descarta o que chega em 1008.
- Além disso o vídeo é **intermitente** (volta a só `pt120` mesmo com o re-arm pós-transição).

É um problema de **SFU/relay de vídeo** (RTX-only no ssrc de RTX + intermitência), **não do
DAVE** — afetaria o relay comum também. Hipóteses para uma investigação dedicada:
(a) por que o encoder nativo manda só RTX (tempestade de NACK do relay hairpin? config de
simulcast/rid?); (b) reescrever/de-RTX no repasse (o servidor tem a chave de transporte:
poderia tirar o OSN, trocar ssrc 1008→1007 e pt 104→103, e re-cifrar — band-aid); (c) alinhar
a atribuição de ssrc do READY com o que o nativo realmente usa. **Recomendação: esforço
focado à parte** — o objetivo principal (destravar o encoder via DAVE) já está resolvido e
provado, e a E2EE ponta a ponta (áudio) funciona.

## Plano faseado (validação primeiro)

- **Phase 0 — plumbing binário** *(esqueleto neste commit)*: `DAVE_OP`, parse/log dos
  frames binários. Inerte enquanto `dave_protocol_version=0`. Sem mudança de comportamento.
- **Phase 1 — validar a hipótese**: integrar a lib MLS; servidor como external sender;
  formar o grupo com **só o transmissor** (op 25/26/27/28/29) e anunciar
  `dave_protocol_version:1` / `secure_frames_version:1` no op 4. **Marco:** o
  `bitrateTarget` do transmissor sobe de 0? Se **sim**, a hipótese vale e seguimos. Se
  **não**, DAVE não era o gate — economizamos semanas.
- **Phase 2 — espectador**: adicionar o espectador ao grupo (welcome), relay dos frames
  cifrados, PLI/keyframe. Marco: o espectador **renderiza**.
- **Phase 3 — transições**: entradas/saídas de membros (prepare/execute transition,
  novo epoch), resume, robustez.

## Reverter (segurança)
Enquanto o DAVE não estiver funcional, **manter `dave_protocol_version:0`** no op 4 (estado
atual, áudio funcionando). Não ligar o DAVE v1 no servidor até a Phase 1 formar um grupo
válido — senão o cliente fecha a conexão (sem chaves) e quebra o que já funciona.
