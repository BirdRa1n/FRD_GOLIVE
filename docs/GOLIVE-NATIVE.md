# Native Go Live — how it works and why

**Status: resolved and validated end to end.** Discord's native Go Live sends its
media (RTP) to the private server instead of Discord's. Live with a real viewer: video
(H265/AV1) + audio E2EE (DAVE v1) at ~4–6 Mbps, fully relayed. Camera stays native on
Discord; only the screen is private.

## The problem and the root cause

The question was whether the native Go Live (native capture + encoder, in the C++
`discord_voice` module) could be redirected to a private server.

Signaling, audio relay and bandwidth control worked early on, but **video never came
out of the native encoder**: `bitrateTarget: 0` / `framesEncoded: 0` even with capture
OK (`frameRateInput ~30`), a correct sink want, and plenty of transport bandwidth.

Many leads were explored and ruled out (REMB, transport-cc, per-pixel sink want,
PLI/keyframe requests, a full DAVE v1 implementation, RTCP receiver reports). A real bug
was also fixed along the way: op4 was sending `video_codec: opus` because `pickVideoCodec`
did not filter out the audio codec — it now sends H265.

**The actual wall was a missing `keyframe_interval` field in op4.** Without it,
`alwaysSendVideo:false` and the native encoder never instantiates — it is **not** a
bitrate-allocator problem. With the field in the payload (or `setKeyframeInterval(2000)`
live), the encoder runs: 1080p30, zero loss.

The fix is `NATIVE_STREAM_KEYFRAME_INTERVAL` (default `2000`), which the server sends in
op4 so the encoder starts on every stream without any manual step.

## How it is wired

**Client (`client/src/probe/`)**
- `streamProbe.ts` — a **read-only** probe (setting `streamProbe`, off by default). Logs
  streaming Flux events, media-signaling WS frames and `/streams/*` requests, with
  tokens/keys masked. In the console: `FRDStreamProbe.copy()`.
- `nativeStreamRedirect.ts` (+ a patch in `index.tsx`) — redirects the Go Live
  `STREAM_SERVER_UPDATE.endpoint` to `/dstream` (setting `nativeStreamEndpoint`) and
  unlocks the DAVE downgrade.

**Server**
- `server/src/nativeStream.ts` — the `/dstream` WS + UDP media. Only enabled when
  `NATIVE_STREAM_PUBLIC_IP` is set.
- `server/src/dave.ts` — DAVE v1 (MLS) external sender for audio E2EE. See [DAVE.md](DAVE.md).
- `server/src/twcc.ts` — transport-cc (RTCP) feedback, a pure module.
- `server/src/index.ts` — the WS upgrade is routed manually for `/dstream`.

Key op4 details (`pickVideoCodec`): the `video_codec` follows the client — the lowest
`priority` with `encode:true` (H265), **filtering out opus** (audio, priority 1000,
otherwise mistaken for a video codec).

## Privacy note

The Discord client **uploads screen thumbnails** to the API
(`ApplicationStreamPreviewUploadManager`, `POST /streams/:key/preview`) during native
Go Live. Since we use native Go Live, that thumbnail still reaches Discord (only the
video stream is private). Consider blocking that endpoint in the client if it is a
requirement.

## Diagnosing the native encoder

In the console, during a stream, to see whether video is being encoded:

```js
const ME = Vencord.Webpack.findStore("MediaEngineStore").getMediaEngine();
[...ME.connections]
  .filter(c => c.context === "stream")
  .forEach(c => c.getStats().then(s => console.log(JSON.stringify({
    transport: s.transport,
    video: s.rtp.outbound.find(o => o.type === "video"),
  }, null, 1))));
```

`framesEncoded` / `framesDroppedEncoderQueue` / `bitrateTarget` tell you whether the
encoder is running. Live investigation also goes through the local MCP (`mcp/`,
`frd-discord` tools) — see [MCP-DIAG.md](MCP-DIAG.md).

> **History:** there was a transitional **hybrid** mode (native shell + E2EE audio, with
> the video carried by LiveKit) while native video was still a dead end, and before that
> a mesh/P2P transport. Both were removed once native video worked; there is no more
> `hybridVideo.ts` / `livekit.ts`.
