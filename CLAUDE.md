# CLAUDE.md — repository guide

Context for future Claude sessions on this project. Read before making changes.

## What this is

A Discord client modification (Vencord plugin) + a server that lets people
**share their screen privately** — the video **does not go through Discord's
servers**; only voice (and camera) stay native. Target: companies with strict
privacy rules.

**Current architecture = native Go Live redirected + central hub.** The plugin
redirects the **native Discord Go Live** streaming connection to the private
server (control WS `/dstream`); the native `discord_voice` module sends the
**RTP (video + audio)** to a configurable public IP (`NATIVE_STREAM_PUBLIC_IP`,
usually a VPS that relays the UDP to a home/office server). Audio is **E2EE
(DAVE v1 / MLS)**. The control plane (WS `/dstream`) is HTTP/WS (can go through a
reverse proxy / tunnel); only the UDP media needs the public IP/relay. Enablement
is checked on `/dstream` (`server/src/nativeStream.ts`). The `server/` also acts as
the login/auth/enablement/admin hub (web pages). See
[docs/GOLIVE-NATIVE.md](docs/GOLIVE-NATIVE.md) (the key was `keyframe_interval` in
op4) and [docs/DAVE.md](docs/DAVE.md).

**History:** there was a **mesh/P2P** transport and later an **SFU (LiveKit)** —
both were **removed** (LiveKit went away once native video worked; there is no
more `livekit.ts`/`meshTransport.ts`/`rtc/session.ts`).

## Layout

```
client/            Vencord userplugin (TS/React) — lean: redirect + diagnostics only
  src/
    index.tsx            definePlugin: wiring (redirect, video-guard unlock, lifecycle)
    settings.ts          plugin settings (@api/Settings)
    probe/
      nativeStreamRedirect.ts  redirects native Go Live to /dstream + unlocks DAVE downgrade
      streamProbe.ts     protocol probe (read-only) — diagnostics
    diagBridge.ts        MCP bridge (renderer) — live diagnostics (see docs/MCP-DIAG.md)
    native.ts            NATIVE module (main process): desktopCapturer + MCP bridge IPC
    types.ts             pure types (NativeSource) — ✔ typecheckable in isolation
installer/         graphical installer (Electron, Mac/Win) — applies the mod to Discord
  src/             main/preload (IPC), lib/ (config, inject, paths, store)
  renderer/        installer UI (uses the design system; renderer/ui/ is copied at build)
server/            hub/auth/admin/config + native Go Live media (Node, Docker)
  src/             index.ts (Express+ws), nativeStream.ts (/dstream + UDP), dave.ts (MLS/E2EE),
                   twcc.ts, store.ts, session.ts, discord.ts, botGateway.ts, imageCache.ts
  public/ui/       DESIGN SYSTEM: ui.css (tokens/components), ui.js (theme, segmented,
                   sheet, toast, icons, thumb), index.html (catalog at /ui/)
docs/              architecture, roadmap, Discord OAuth, UDP relay, native Go Live, DAVE, MCP
mcp/               local MCP (frd-discord tools) for live Discord diagnostics
```

## Build & tests

**Pure types** (independent of Vencord) — isolated typecheck:
```bash
cd client && npm install && npm run typecheck:rtc
```
Covers `types.ts` only. The rest of the plugin (`@webpack/common`, `@api/Settings`,
`@utils/types`, `@main/*`) **only compiles inside Vencord** (`pnpm build`).

**Plugin inside Vencord** (no runtime loading; compiled at build time):
```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord   # OUTSIDE this repo
cd ~/Vencord && pnpm install
mkdir -p src/userplugins
cp -R /path/to/FRD_GOLIVE/client/src src/userplugins/frdGoLive   # COPY, do not symlink
pnpm build && pnpm inject
```
- **Copy `client/src`** (it holds `index.tsx`), not `client/`. A symlink breaks the aliases.
- Plugin name: `FRDGoLive`. `livekit-client` is no longer needed (removed).

**Server** (Node hub + native Go Live media):
```bash
cd server && ./gen-env.sh && docker compose up -d --build   # or install.sh (curl|sh)
cd server && npm install && npm run build                    # isolated typecheck/build
curl -s http://localhost:8090/health   # {"ok":true,"transport":"native",...}
curl -s http://localhost:8090/config   # nativeStreamEndpoint (host/dstream) + mediaHost
```
- `gen-env.sh` generates `.env` with secrets; set `NATIVE_STREAM_PUBLIC_IP` (the public
  IP of the UDP media) and, for audio E2EE, `NATIVE_STREAM_DAVE=1`.
- Hub/admin login: fill in `DISCORD_*` — see `docs/DISCORD-OAUTH.md`.
- Media UDP relay (VPS → home): `docs/RELAY-UDP.md`.

## Important facts and pitfalls (do not relearn)

- **Transport = native Go Live redirected** → the media (RTP from `discord_voice`)
  reaches the server over **UDP** (`NATIVE_STREAM_UDP_PORT`, e.g. 7883/7000). An
  HTTP/WS tunnel **only carries HTTP/WS**, not UDP → the media enters through the
  **public IP `NATIVE_STREAM_PUBLIC_IP`** (usually a VPS that DNATs the UDP to the
  home server, e.g. over a WireGuard link). The control plane (WS `/dstream`) goes
  through the tunnel. See `docs/RELAY-UDP.md`.
- **`keyframe_interval` in op4 unlocks the encoder** — without it `discord_voice`
  stays at `bitrateTarget: 0`/`framesEncoded: 0` (it is NOT an "allocator" problem).
  The server sends `NATIVE_STREAM_KEYFRAME_INTERVAL` (default 2000). See
  `docs/GOLIVE-NATIVE.md`.
- **op4 `video_codec` follows the client**: lowest `priority` with `encode:true`
  (H265), **filtering out opus** (audio, prio 1000, otherwise it is mistaken for a
  video_codec).
- **1 proxy route is enough**: `stream.example.com`→`:8090` (hub + WS `/dstream`).
  The client CSP must allow that domain with an explicit `wss://`; the media is UDP
  (not subject to CSP). The installer writes this from the host.
- **Enablement gated on `/dstream`**: `identify()` (`server/src/nativeStream.ts`) only
  accepts peers that pass `store.canStream(userId, channelId)` — `login` mode (user
  enabled in the hub) or `channels` mode (`store.getSettings().authMode`: channel
  enabled **and** not banned). In `channels` mode the default is **allowed**: turning
  the mode on seeds **all** of the bot's (enabled) rooms, and an unknown channel is
  auto-discovered **enabled** — the admin only turns off the exceptions in the
  dashboard (unless `NATIVE_STREAM_ALLOW_ANY=1`, test only). Disabling/banning a
  channel calls `closeMembersInChannel()` and drops **whoever is already live** (4004).
- **The real channel comes from the bot gateway** (`server/src/botGateway.ts`, intents
  GUILDS|GUILD_VOICE_STATES): the media IDENTIFY carries **ephemeral**
  `server_id`/`channel_id` (created per session, not real on Discord — the API returns
  404), only good for grouping the media; the IDENTIFY `session_id` matches
  `VOICE_STATE_UPDATE` and tells which channel the person is in. `identify()` is async
  (waits up to 1.2s + `resolveLater()` revalidates), DAVE **still** derives the group_id
  from the ephemeral id the client sent, and the dashboard shows the real
  `label`/`channelId`/`guildId` under `/admin/live`. No token → gateway off → the
  IDENTIFY id is used. `DISCORD_GATEWAY_URL` points at a fake gateway (local test).
- **Live dashboard comes from `nativeStream.getLiveState()`** (the old `/signaling` WS
  was removed): `/admin/live` (rooms/who streams), `/admin/groups` (channels grouped by
  guild), `/admin/channels` (enabled/banned) and `/admin/settings` (mode). `channels`
  mode uses `DISCORD_BOT_TOKEN` to list guilds/channels and resolve names — see
  [docs/DISCORD-OAUTH.md](docs/DISCORD-OAUTH.md) §7.
- **Guild icons and user avatars** on the dashboard/installer come from the Discord CDN
  through `server/src/imageCache.ts` (fetched once, cached on disk, served by the hub at
  `/admin/img/{guild,user}/:id` and the public `/img/guild/:id`) — the browser never
  hits Discord directly. The UI falls back to initials when there is no image.
- **Camera = native Discord** (goes through Discord's servers); only the **screen**
  (Go Live) is private. A product decision made when LiveKit was removed.
- **Discord's CSP** blocks connections to domains outside its list. You **must** add
  the server domain in `Vencord/src/main/csp/index.ts` (`CspPolicies`), with an explicit
  `wss://` (the bare host does not match the wss scheme in that Chromium):
  `"*.example.com"`, `"wss://*.example.com"`, `"ws://*.example.com"`. The installer does
  this via `native-settings.json` (customCspRules).
- **Censored native buttons**: unlocked via `FluxDispatcher.dispatch({type:
  "APEX_EXPERIMENT_OVERRIDE_CREATE", experimentName:"<video-guard>", variantId:-1})`.
  The experiment name rotates → it is a setting. We **do not** hijack the buttons (the
  native Go Live is what runs; `nativeStreamRedirect` only swaps the media endpoint).
- **Native Go Live works through the private server**: capture/encoder live in the
  native `discord_voice` module (C++), outside the JS. Audio E2EE (DAVE v1) + video.
  Logged in `docs/GOLIVE-NATIVE.md`; DAVE protocol in `docs/DAVE.md`. Live investigation
  via the local MCP (`frd-discord` tools, `opencode.json`) with a playbook in
  `docs/MCP-DIAG.md`.
- **⚠️ Privacy — native Go Live uploads screen thumbnails** to the Discord API
  (`POST /streams/:key/preview`): since we now USE native Go Live, the screen
  *thumbnail* still goes to Discord (only the video stream is private). Consider
  blocking that endpoint in the client if it is a requirement.
- **Stream audio without the call (Windows)**: the common `desktopCapturer`/loopback
  grabs the whole system — the call leaks and viewers hear themselves. Fix
  (`native.ts`): capture via `getDisplayMedia` with our handler answering
  `audio: "loopbackWithoutChrome"` (WASAPI process loopback that EXCLUDES the capturing
  process tree). By default the capturer is the *audio service* (its own process) and
  the voice (`discord_voice`) plays in the *renderer* — outside that tree. So `native.ts`
  disables `AudioServiceOutOfProcess` (wrapping `app.commandLine.appendSwitch` to merge
  with Discord's own `--disable-features`): the service moves into the main process and
  the excluded tree becomes the whole Discord. Electron 42 (current Discord) forwards any
  `audio` string as a device id; 43+ also maps `restrictOwnAudio`. Requires Windows 10
  2004+; `getAudioCaps()` checks whether the flag took effect. macOS: no sound (the
  desktopCapturer does not deliver it; the Chromium CATap only excludes the audio
  service pid, not the renderer).

## Conventions

- TypeScript `strict`. The plugin is lean (redirect + diagnostics); only `types.ts` is
  typecheckable in isolation (`npm run typecheck:rtc`) — the rest needs the Vencord build.
- **Commits**: English, Conventional Commits, **no Claude co-authorship line** (owner's
  preference). Work on a branch + PR (`gh pr create`), never commit directly to `main`.
- When touching the plugin: **copy `client/src` → Vencord → `pnpm build` → reload
  Discord** (renderer change: Cmd/Ctrl+R; CSP/main or `native.ts` change: full restart).
  You can validate the real build in `~/Vencord` (`pnpm build` bundles;
  `npx tsc --noEmit -p tsconfig.json` checks types).

## Design system (hub/login/admin/installer UI)

- Single source in `server/public/ui/` (`ui.css` + `ui.js`), **no build**. The hub serves
  it at `/ui/*` (with `?v=VERSION` on the links); live catalog of every component at `/ui/`.
- The installer **copies** these files to `installer/renderer/ui/` on `npm run build`
  (`scripts/sync-ui.mjs`; destination gitignored). Do not edit the copy.
- SwiftUI-like language: `.large-title`, `.group`/`.row` lists, `.card-hero` in a gradient,
  `.segmented`, `.toggle[role=switch]`, `<dialog class="sheet">`, `FRDUI.toast/confirm`.
  Avatars/icons: `FRDUI.thumb(url, name, square, cls)` (image with initials fallback).
  Icons: `<i data-icon="name">` (hydrated by ui.js) or `FRDUI.icon("name")`.
- Theme: follows the system; `data-theme` on `<html>` forces light/dark (stored in
  localStorage by the `[data-theme-switch]` selector), swapped with View Transitions.
- Components use **tokens only** (`--bg`, `--surface`, `--accent`, `--gradient`…) — never a
  literal color, or one of the themes breaks. No external fonts (offline/privacy).
- Inside a `<label>`, do not place a `.segmented` (clicking the text triggers the 1st
  button): use a `<div class="label">`.

## Installer (Electron)

`installer/` applies the mod without a terminal: the user enters their own server host,
it pulls `GET <host>/config`, writes the plugin settings + the domain CSP, injects via the
Vencord Installer CLI and opens the hub. It needs an `installer/vencord-dist/` (Vencord
already built with the plugin — gitignored, generated in CI). See `installer/README.md`
(includes the Electron-on-Node-26+ workaround).

- The host is **remembered** across updates (`lib/store.ts` in Electron userData); the UI
  shows server status + latency and adapts to the server's auth mode, listing the enabled
  groups (with icons) in channels mode.
- **Build/release:** `installer/scripts/build-app.sh` (Mac: .app/.dmg/.zip, ad-hoc without a
  Developer ID via `after-pack.cjs`) and `build-app.bat` (Windows: .exe NSIS);
  `publish-release.{sh,bat}` upload `release/` with `gh` to the `v<version>` release.
- **Auto-update:** `electron-updater` with the GitHub provider (`publish` in
  `electron-builder.yml`). Artifact names **without spaces** (otherwise `latest*.yml` does
  not match the asset). On macOS without a Developer ID the update becomes "download the new
  version". Note: this still assumes GitHub releases — a move to another host needs a
  follow-up.
- `.bat` files need **CRLF** (see `.gitattributes`) — with LF the `goto` breaks in cmd.
