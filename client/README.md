# FRD GoLive client (Vencord userplugin)

A Vencord userplugin that makes Discord's **native Go Live** send its media to a
**private server** instead of Discord's — so the screen video never touches Discord's
infrastructure. Voice (and camera) stay native. Access is granted by the admin in the hub
(or by being in an enabled channel).

> 🪟 **On Windows?** See the dedicated walkthrough in [WINDOWS.md](WINDOWS.md).
> 🖱️ **No terminal?** Use the **graphical installer** in [../installer/](../installer)
> — it applies the mod and configures the server for you.

## Layout

```
src/
├── index.tsx                      # definePlugin: wiring (redirect, video-guard unlock)
├── settings.ts                    # plugin settings (@api/Settings)
├── probe/
│   ├── nativeStreamRedirect.ts    # redirects native Go Live to /dstream + unlocks DAVE downgrade
│   └── streamProbe.ts             # read-only protocol probe (diagnostics)
├── diagBridge.ts                  # MCP bridge (renderer) — live diagnostics (see docs/MCP-DIAG.md)
├── native.ts                      # NATIVE module (main process): desktopCapturer + MCP bridge IPC
└── types.ts                       # pure types (NativeSource) — ✔ typecheckable in isolation
```

**Pure types** import nothing from Vencord and are validated in isolation:

```bash
npm install
npm run typecheck:rtc
```

The rest (`@webpack/common`, `@api/Settings`, `@utils/types`, `@main/*`) only resolves
inside the Vencord build.

## How it works

1. The user starts Discord's **native Go Live**.
2. `nativeStreamRedirect.ts` intercepts `STREAM_SERVER_UPDATE` and points the streaming
   endpoint at the private server's WS `/dstream` (setting `nativeStreamEndpoint`).
3. The native `discord_voice` module sends the RTP (video + audio) to the server; the
   audio is E2EE (DAVE v1) when `nativeStreamDave` is on.
4. The censored native video buttons are unlocked via an experiment override.

Who can stream is decided on the server (`/dstream`): a user enabled in the hub, or
anyone in an enabled channel (channels mode).

## Installation

### Option A — graphical installer (recommended)

Run the app in [../installer/](../installer): it applies the modification, writes the
settings + the domain CSP, and opens the hub. No terminal.

### Option B — manual build inside Vencord

Vencord compiles plugins at build time (no runtime loading).

> **Clone Vencord OUTSIDE this repository** (e.g. `~/Vencord`). Do not clone inside
> `client/`: `pnpm` would "walk up" and use this project's `package.json` (no `build`
> script), causing `Command "build" not found`.

```bash
git clone https://github.com/Vendicated/Vencord ~/Vencord
cd ~/Vencord
pnpm install

# COPY the src/ folder as the userplugin (it contains index.tsx):
mkdir -p src/userplugins
cp -R /path/to/FRD_GOLIVE/client/src src/userplugins/frdGoLive

pnpm build
pnpm inject                        # injects into the installed Discord
```

> **Copy `client/src`, do not symlink** and do not copy `client/` as a whole: Vencord
> expects `src/userplugins/frdGoLive/index.tsx`. A symlink breaks alias resolution
> (`@webpack/common` etc.).

Then, in Discord: Settings → Vencord → Plugins → **FRDGoLive** → enable and configure:
- **nativeStreamEndpoint**: the server's `/dstream` host (e.g. `stream.example.com/dstream`).
  The installer fills this in. Both senders and viewers need it. Empty = disabled (Go Live
  goes to Discord).
- **nativeStreamDave**: audio E2EE (DAVE v1). Keep it on with the server's
  `NATIVE_STREAM_DAVE=1`.

> Everyone must point the plugin at the **same server**, and (in login mode) each person
> must be **enabled** by the admin in the hub.

After a renderer (UI) change: `Ctrl/Cmd+R` in Discord. After a CSP/`native.ts` change:
a full Discord restart.

## Native capture (censored regions)

In some countries Discord **disables screen sharing**. The native capture path uses
Electron's **`desktopCapturer`** (via `native.ts`) and captures the source with
`getUserMedia({chromeMediaSource:"desktop"})` — bypassing Discord's `getDisplayMedia`
and the regional block.

Notes:
- Desktop (Electron) only; the web client has no `desktopCapturer`.
- System audio through this path depends on the platform (best on Windows); if
  unsupported, it captures video only. See the audio note in [../CLAUDE.md](../CLAUDE.md).
