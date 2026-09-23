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
