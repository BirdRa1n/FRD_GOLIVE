# Deep diagnostics via MCP — agent ↔ Discord bridge

A local MCP server (`mcp/`, `frd-discord` tools) lets an agent inspect and drive the
live Discord client: media stats, Flux actions, protocol probe, stores, arbitrary eval,
and the native `discord_voice` (C++) surface. It is how the native-video wall was
diagnosed (see [GOLIVE-NATIVE.md](GOLIVE-NATIVE.md)) and it remains the tool for live
media investigation.

## Architecture

```
Agent (MCP client)
   │  MCP stdio — discord_* tools
   ▼
mcp/ (this package) ── HTTP 127.0.0.1:8756 + token ~/.frd-golive/mcp-token (0600)
   ▲                          ▲
   │ POST /poll  /result      │ (Electron main — client/src/native.ts,
   │                          │  no CSP, the only side that can reach localhost)
Discord (renderer)  ← poll 100ms via VencordNative.pluginHelpers.FRDGoLive
   client/src/diagBridge.ts runs: stats, flux, probe, stores, eval…
```

The main process is in the middle because the renderer runs on `https://discord.com`
and its CSP would block `http://127.0.0.1`; the Electron main process has no such
restriction. The renderer only talks to main over IPC (the same pattern as
`getScreenSources`).

## Setup

```bash
# 1) build the MCP (once)
cd mcp && npm install && npm run build && cd ..

# 2) confirm the agent registered it (it is in the MCP config)
#    the tools should show up as "frd-discord connected"

# 3) install the UPDATED plugin in Discord (client/src has diagBridge.ts)
#    — via the installer, or manually:
cp -R "$PWD/client/src" ~/Vencord/src/userplugins/frdGoLive
cd ~/Vencord && pnpm build && pnpm inject

# 4) in Discord: FRDGoLive plugin settings →
#    "[Diagnostics] MCP bridge" = ON → Ctrl+R (reload Discord)
```

Test: call `discord_status` → `"discordOnline": true`.

If nothing works: does `mcp/dist` exist? is the setting on? did you Ctrl+R? is another
agent session holding the port (change it with `FRD_MCP_PORT=8757`)?

## Tools (`frd-discord`)

| Tool | What it does |
|---|---|
| `discord_status` | Bridge/token/plugin config. **Start here.** |
| `discord_media_stats` | Snapshot of the MediaEngine connections (`videoStreamParameters` + sink wants + stats: `bitrateTarget`, `framesEncoded`, `resolution`…). The encoder only runs with Go Live active. |
| `discord_media_watch` | Samples the same stats for N seconds — to watch the encoder **react** while you change something on the server. |
| `discord_probe` | Protocol probe (flux + `wss://*.discord.media` WS + `discord_voice` calls + `/streams/*` HTTP), tokens masked. `start`/`dump`/`clear`/`stop`. |
| `discord_flux` | Records FluxDispatcher actions live (`filter`: `type` prefix, e.g. `"STREAM"`). |
| `discord_console` | Ring buffer of Discord console (log/warn/error) since the bridge turned on. |
| `discord_store` | Reads a Discord store by name (e.g. `MediaEngineStore`) and optionally calls a method. |
| `discord_eval` | Runs arbitrary JS in the renderer (async IIFE; tokens redacted in the result). |
| `discord_settings` | Reads/writes the plugin settings live (`restartNeeded` needs Ctrl+R). |
| `discord_dispatch` | Dispatches a FluxDispatcher action (targeted experiments). |
| `discord_native` | Introspects the C++ `discord_voice` module: `list=true` returns the surface (safe); `list=false` + `method` **calls** the function (can freeze Discord); `withCallback: true` injects the callback for getters that require a function (e.g. `getCodecCapabilities`). |

## Case study: the `keyframe_interval` wall

The native encoder stayed at `bitrateTarget: 0` / `framesEncoded: 0` with capture OK.
Many gateway/protocol deltas were found and fixed via the MCP (confirmed against a real
Go Live session):

- **op2 READY `experiments`**: the real client sends `["fixed_keyframe_interval"]` → the
  server now sets `NATIVE_STREAM_EXPERIMENTS` (default matches the real one).
- **op4 `video_codec`**: the real op4 picks the lowest `priority` with `encode:true` =
  **H265** (AV1 is decode-only here) → `NATIVE_STREAM_VIDEO_CODEC` empty = follow the
  client; a real bug was fixed where `pickVideoCodec` chose opus.
- **op15 MEDIA_SINK_WANTS** sent right after op4 (before the sender's op12).
- **TWCC** feedback was using the audio SSRC — fixed to the video SSRC (transport-cc only
  rides video packets).

None of those unlocked video. The real wall was a **missing `keyframe_interval` field in
op4**: the client only sets `alwaysSendVideo:true` when it receives the
`"keyframe-interval"` event (`RTCControlSocket.onmessage` case 4/14 →
`setTransportOptions({keyframeInterval, alwaysSendVideo: e > 0})`). Without it the capture
runs (`frameRateInput 30`), the queue fills and drops, and the C++ encoder never
instantiates.

Live proof (via MCP): `sc.setKeyframeInterval(2000)` → within ~3s `framesEncoded` went
0 → 30/s, `resolution 1920×1080`, H265 pt103, zero loss. A manual JS push does not survive
a restart; the server-sent field does. Fix: `NATIVE_STREAM_KEYFRAME_INTERVAL` (default
`2000`) in op4.

## Playbook: diagnosing the native encoder

1. **Protocol diff (real vs ours).** With `nativeStreamEndpoint=""` (real) vs your
   `/dstream` endpoint, run `discord_probe {op:"start"}` → start Go Live → `~15s` →
   `discord_probe {op:"dump"}`. Compare field by field: op2 READY (`experiments`,
   `streams[]`), op4 (`video_codec`, `keyframe_interval`), and any numeric S→C op present
   only in the real dump. Cross-check with the server's `op X unhandled` logs.
2. **Watch the encoder react.** `discord_media_watch {seconds:15, intervalMs:500}` while
   you restart the server with a new env, then start Go Live and see whether
   `bitrateTarget` / `framesEncoded` / `qualityLimitationReason` leave zero.
   `qualityLimitationReason` distinguishes "bandwidth" (TWCC/BWE) from "cpu"/"other"
   (internal gate).
3. **Who turns the encoder on.** `discord_flux {filter:"RTC"}` (then "MEDIA", "STREAM"),
   `discord_store {store:"MediaEngineStore", method:"getMediaEngine"}`, `discord_eval` to
   find who calls `discord_voice` with video args, and `discord_native {list:true}` for
   the C++ surface. Then `discord_native {list:false, method:…, args:[…]}` to toggle it
   directly (carefully — it can freeze Discord; Ctrl+R recovers).

## Security

- Setting **default OFF**; binds only to `127.0.0.1`; token in `~/.frd-golive/mcp-token`
  (0600) — Discord only talks to whoever has the file.
- `discord_eval` is arbitrary code execution in the Discord of whoever enabled the bridge.
  Use only on your own machine; turn the setting off outside diagnostic sessions.
  Tokens/keys are redacted automatically in results.
- One bridge at a time (port 8756; `FRD_MCP_PORT` changes it).
- Using a client mod is against Discord's ToS.
