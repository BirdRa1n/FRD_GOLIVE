# DAVE (native Go Live E2EE) — protocol and implementation

DAVE is Discord's audio/video E2EE on top of the SRTP transport, based on **MLS
(RFC 9420)**. Clients form an MLS group and derive per-sender keys; each media frame is
encrypted **after** the codec (inner layer, marker `0xfafa`). Our media server joins as
the **external sender + delivery service (DS)**: it relays the MLS messages and
coordinates epoch transitions, but **never** learns the group key (true E2EE — not even
the server sees the media). In FRD GoLive this gives **end-to-end encrypted stream
audio**; the server relays it without being able to read it.

Ciphersuite: **MLS 0x0002** (`MLS_128_DHKEMP256_AES128GCM_SHA256_P256`, **P256/ECDSA**) —
confirmed from the real op26 bytes (65B P256 init_key, `0x04` prefix). It is **not**
0x0001/X25519. The external sender (op25) is also P256.

> **op26 = KeyPackage** (a CRU), not a wrapped MLSMessage. Real head: `00 01` (mls10) ·
> `00 02` (cipher_suite P256) · `40 41 04…` (65B init_key). Decode with `decodeKeyPackage`,
> not `decodeMlsMessage`.

## Real protocol (captured)

Source: a `streamProbe` dump on a Windows sender (normal Go Live, redirect off). See
[GOLIVE-NATIVE.md](GOLIVE-NATIVE.md).

### Real op4 (SESSION_DESCRIPTION)
```json
{ "video_codec": "AV1", "audio_codec": "opus", "mode": "aead_aes256_gcm_rtpsize",
  "secret_key": "[32]", "media_session_id": "…",
  "dave_protocol_version": 1, "secure_frames_version": 1 }
```
There is no `codecs` array — the payload-type map comes in **op1 (SELECT_PROTOCOL)** that
the **client** sends (opus=120; AV1 101/rtx102; H265 103/rtx104; H264 105/rtx106;
VP8 107/rtx108). The encoder `max_bitrate` (3500000) comes in the client's own **op12** —
the server does not provide it.

### DAVE opcodes (binary WS frames)
Format: **S→C** `[seq u16 BE][op u8][payload]`; **C→S** `[op u8][payload]` (no seq).

| op | name | direction | content |
|----|------|-----------|---------|
| 21 | PREPARE_TRANSITION | S→C | `{transition_id, protocol_version}` (JSON) |
| 22 | EXECUTE_TRANSITION | S→C | `{transition_id}` (JSON) |
| 23 | TRANSITION_READY | C→S | `{transition_id}` (JSON) |
| 24 | PREPARE_EPOCH | S→C | `{epoch, protocol_version}` (JSON) |
| 25 | MLS_EXTERNAL_SENDER | S→C | binary: external sender credential + public key |
| 26 | MLS_KEY_PACKAGE | C→S | binary: the client's key package |
| 27 | MLS_PROPOSALS | S→C | binary: proposals (Add/Remove) to apply |
| 28 | MLS_COMMIT_WELCOME | C→S | binary: commit (+ welcome) from the committer |
| 29 | MLS_ANNOUNCE_COMMIT_TRANSITION | S→C | binary: the transition's commit |
| 30 | MLS_WELCOME | S→C | binary: welcome for new members |
| 31 | MLS_INVALID_COMMIT_WELCOME | C→S | asks for a reset (invalid commit/welcome) |

### Observed sequence (stream connection, 1 sender + 1 viewer)
```
C→S op0  IDENTIFY {…, max_dave_protocol_version: 1}
S→C op8  HELLO / op2 READY
C→S op1  SELECT_PROTOCOL {codecs[], …}
C→S op12 VIDEO {streams:[{ssrc, rtx_ssrc, max_bitrate, max_resolution, …}]}
S→C op4  SESSION_DESCRIPTION {dave_protocol_version:1, secure_frames_version:1}
S→C op15 MEDIA_SINK_WANTS {"<ssrc>":100, pixelCounts:{"<ssrc>":<pixels>}, any:100}
S→C op25 MLS_EXTERNAL_SENDER            (74B)
S→C op27 MLS_PROPOSALS                  (~500B)
C→S op26 MLS_KEY_PACKAGE               (~394B)
C→S op28 MLS_COMMIT_WELCOME            (~1160B)
S→C op30 MLS_WELCOME                    (~960B)   (when a viewer joins)
S→C op24 PREPARE_EPOCH {epoch:1, protocol_version:1}
S→C op21 PREPARE_TRANSITION {transition_id:0, protocol_version:1}
… encrypted media flows …
```

### op15 (MEDIA_SINK_WANTS) — correct format
```json
{ "<video_ssrc>": 100, "pixelCounts": { "<video_ssrc>": 688640 }, "any": 100 }
```
Per-ssrc quality and `any` = **100** (a percentage); the pixel count goes **only** in
`pixelCounts`.

## Server architecture

`server/src/nativeStream.ts` is the gateway (WS v8 + UDP); `server/src/dave.ts` is the
DAVE delivery service:

1. **Binary framing**: parse/emit `[seq?][op][payload]`; constants in `DAVE_OP`. The S→C
   path carries a `seq`.
2. **External sender + MLS delivery service**: generate the external sender keypair;
   announce it in op25; collect op26 (key packages); emit op27 (Add proposals); receive
   op28 (commit+welcome) from the committer; distribute op29/op30; coordinate epochs with
   op24/op21/op22. The server is **not** a group member → it never sees the media key.
3. **Relay unchanged**: it keeps relaying opaque RTP (the media stays encrypted on the
   transport with `secret_key`; the DAVE layer is inner and passes through intact). With
   DAVE on, **the server also stops seeing the content** — real E2EE.

### MLS library — **`ts-mls`** (pure TypeScript, RFC 9420)
Runs in Node with no native/WASM deps — keeps `server/` on the same toolchain (tsc).
Provides the MLS objects (external sender, `encodeExternalSender`, `proposeExternal`,
`decodeKeyPackage`, `createCommit`, `groupInfo`, `processMessages`, TLS codec). The DAVE
wire framing around those MLS objects (per-opcode headers/prefixes, e.g. `transition_id`
in binary payloads) is ours, matching Discord's `libdave`.

### DAVE v1 parameters (confirmed, discord/dave-protocol)
- MLS 1.0; ciphersuite **DHKEMP256_AES128GCM_SHA256_P256** (0x0002).
- **One** group extension: `external_senders` (with the voice gateway's external sender).
- No leaf-node extensions. Credential: **basic** only.

## op27 — the complete recipe

(extracted from `discord/libdave`, `cpp/test/external_sender.cpp` and
`cpp/src/mls/session.cpp`.)

- **group_id** = 8 **big-endian** bytes of `BigInt(channel_id)`. The `channel_id` comes
  from the **IDENTIFY** — it is the session's **ephemeral** id (the same one the client
  sends; the real channel only feeds the rule/dashboard, see `server/src/botGateway.ts`).
- **external sender credential** = basic, identity `{0x00,0x01,0x01,0x00}`.
- **signerIndex** (index in the external_senders extension) = **0**.
- **epoch** of the bootstrap Add proposal = **0**.
- **ProposeAdd** = `external_proposal(ciphersuite, group_id, epoch, Proposal{Add{keyPackage}},
  signerIndex=0, signKey)`. In `ts-mls`: `proposeExternal(groupInfo, addProposal, sigPub,
  signKey, cs)` with a fabricated `groupInfo.groupContext` (external proposals don't sign
  over tree/transcript, so those are empty); `addProposal` =
  `{proposalType:"add", add:{keyPackage: decodeKeyPackage(op26)}}`.
- **op27 framing**: `operation_type(u8=0 append) | MLSMessage proposal_messages<V>`
  (a TLS `<V>` vector of one `mls_public_message` MLSMessage).
- **op28 → op29**: op29 = `transition_id(u16) | commit_message` — echoes the first
  MLSMessage of op28 (the commit) back with the transition_id. Then the client sends
  **op23** and we send **op22**.

Implementation fact (verified across hours of logs): the client does **not** send `op23`
for `transition_id 0`, so the next-proposal gate never waits on tid 0.

## What DAVE delivers (and what it did not)

The full handshake (op25 → op24/21 → op26 → op27 → op28 → op29/op30 → op23/22) is correct
and tested, and gives **end-to-end encrypted audio** (the viewer decrypts it;
`decryptSuccessCount` in the hundreds). The MLS implementation is valid.

> **History:** DAVE was first pursued as a hypothesis to unlock native video, which it
> did **not** do — native video was gated by a missing `keyframe_interval` in op4 (see
> [GOLIVE-NATIVE.md](GOLIVE-NATIVE.md)), unrelated to encryption. What DAVE provides is
> audio E2EE, which ships.

## Root cause: "2 viewers → video dies for both"

**Symptom:** with 2 viewers in the same room the video died for **both**; when one left,
it came back for the other. With 1 viewer it always worked.

**Root cause: the gateway violated 3 rules of the spec** (`discord/dave-protocol`,
`protocol.md`). None of them is cryptography — the MLS/crypto layer was correct; the
delivery service was not following the spec:

1. **op27 (proposals) only went to the committer — the spec requires BROADCAST to all
   members.** A commit is valid for an existing member only if it references proposals it
   **already received** (a previously cached proposal reference). A member that did not
   get op27 **rejects the commit** → op31.
2. **Nothing serialized the Adds, and there was no "first commit of the epoch wins"
   (Commit Ordering).** Two joins within ~400 ms ⇒ two op27 in the **same epoch** ⇒ the
   single pending-add slot was overwritten (wrong welcome) and the second commit went out
   on a stale epoch ⇒ op31. A member that rejects (op31) re-inits DAVE → solo group → the
   others can no longer decrypt → media dies for everyone.
3. **op31 was unhandled.** The spec (*Recovery from Invalid Commit or Welcome*) requires
   the gateway to publish a **Remove** proposal for the member that flagged and return it
   to "pending" (its new op26 re-queues the Add). *Member Remove* (member leaving) and
   *Sole member reset* were also missing.

### The fix (`server/src/dave.ts`, `server/src/nativeStream.ts`)
- `buildProposals(es, channelId, epoch, ops)` handles **Add and Remove** and is called
  with broadcast: `daveRecipients()` = all group members (+ committer at bootstrap).
- **Proposal queue** (`daveQueue`) with **one in-flight proposal per epoch**
  (`daveInFlight`), 8s timeout → auto-recovery via `resetDaveGroup`.
- **First commit of the epoch wins**: op28 is only relayed if
  `publicMessage.content.epoch === daveEpoch`; duplicate/stale commits are dropped.
- **Transition gate**: the next op27 only goes out when **all** recipients of op29/op30
  send op23 (10s cap; `daveMemberUnready` releases if a member leaves/is flagged).
- **op31 handled** (JSON and binary): Remove the flagger's leaf + re-add on its new op26;
  if it was the committer, **promote** another member; if it was the only member, reset.
- **Remove on leave** (`leave`/replace 4005) and **sole member reset**; leaf bookkeeping
  (`daveLeaf`, `daveNextLeaf`, `daveFreeLeaves`).
- **op29** now goes to `daveRecipients()` (including the commit's own author).

**How to validate (2-viewer repro):** expect `op27 (add …) → group (N)` with N>1, a single
op29/op30 per epoch, op23 from everyone before the next op27, and **zero** op31 lines. With
`discord_media_stats` (MCP), `decryptSuccessCount` rises on both viewers.

## Safety / revert

While DAVE is disabled, keep `dave_protocol_version:0` in op4 (plain audio). Do not turn
on DAVE v1 on the server until the group forms correctly — otherwise the client closes the
connection (no keys) and breaks what already works. Enable with `NATIVE_STREAM_DAVE=1` plus
the client's `nativeStreamDave` setting.
