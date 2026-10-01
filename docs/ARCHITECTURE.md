# Architecture

FRD GoLive = **Vencord plugin + server**. The **screen video uses Discord's native
Go Live**, redirected to the private server; the media (RTP) enters through a
**configurable public IP** (usually a VPS that relays the UDP to a home/office
server). The central server is the **hub (Discord login) + auth/enablement + quotas
+ admin + config**. An Electron installer applies the modification to the client.

> **History:** earlier iterations used a **P2P/mesh** transport and then an **SFU
> (LiveKit)**. Both were removed once native Go Live worked through the private
> server. There is no more `meshTransport.ts` / `livekit.ts` / `rtc/session.ts`.

## Motivation

- **Keep screen media off Discord's infrastructure.** Only the native Go Live media is
  redirected to the organization's own server; voice and camera stay native.
- **Terminal-free onboarding.** A graphical installer applies the modification.
- **Governance.** Admins enable users (or whole channels), limit quality/FPS, and watch
  active streams and metrics.

## Components

```
┌───────────────────┐        ┌──────────────────────────┐
│  Installer (App    │        │   Web hub                │
│  Electron, Mac/Win)│───────▶│   stream.example.com     │
│  applies mod to    │  opens │   auth · admin · dash    │
│  Discord + config  │  site  └───────────┬──────────────┘
└─────────┬──────────┘                    │ REST/WS
          │ writes config                 ▼
          ▼                    ┌──────────────────────────┐
┌───────────────────┐  WS      │  Server (self-hosted)     │
│  Vencord plugin   │◀────────▶│  - /dstream (control)     │
│  redirects native │ /dstream │  - Auth + quotas          │
│  Go Live media    │          │  - Config endpoint        │
└───────────────────┘          │  - Admin API + metrics    │
          │  RTP / UDP          │  - Media relay (UDP)      │
          └────────▶ public IP ─│  - Bot gateway            │
                                └──────────────────────────┘
```

### 1. Server (self-hosted)

A single Node service (Docker), with the control plane behind a reverse proxy
(HTTP/WS):

- **Control (WebSocket `/dstream`)**: the native Go Live control connection, redirected
  here. `identify()` checks who may stream (`store.canStream`).
- **Media relay (UDP)**: the native `discord_voice` RTP (video + audio) enters through
  the public IP. Audio is E2EE (DAVE v1 / MLS).
- **Auth**: login (the admin enables users) or channel-based enablement; quotas
  (max resolution/FPS per user).
- **Config endpoint** (`GET /config`): given a host, returns what the client needs —
  the `/dstream` endpoint, media host, version, auth mode, and whether OAuth is on.
- **Admin API**: enable/disable users and channels, set quotas, list live rooms and
  who is streaming, metrics.
- **Bot gateway**: resolves the real voice channel each stream is in (see below).
- **Store**: users, channels, bans, settings (JSON file in the MVP).

### 2. Vencord plugin

- Redirects the native Go Live streaming connection to the private server's `/dstream`.
- Unlocks the censored native video buttons via an experiment override (a setting).
- Keeps the native capture/encoder (`discord_voice`); provides live diagnostics.

### 3. Installer (Electron, Mac + Windows)

- Detects/installs prerequisites and **applies the modification to Discord** (a Vencord
  build with the plugin, injected via the Vencord Installer CLI).
- Flow:
  1. Enter **the server host** (remembered across updates).
  2. `GET https://<host>/config` → the host returns the full config → the installer
     writes it and applies the modification (including the domain **CSP** entry).
  3. **"Open the site"** → opens the hub.

### 4. Web hub (stream.example.com)

- **Auth**: the user logs in and **requests access** (login mode).
- When the admin enables them, the hub page auto-refreshes and the plugin picks it up.
- **Admin dashboard** (tabbed): Overview (metrics + live streams), Groups (channels
  grouped by guild, with icons/avatars and per-channel enable/ban), Users (login mode),
  Settings (auth mode, Discord OAuth status, bot status + invite).

## Enablement flow (end to end)

```
1. User runs the installer → enters host → host returns config → mod applied.
2. (login mode) Installer opens the hub → user logs in and requests access.
3. Admin enables the user (or the channel they are in).
4. The user starts native Go Live → the plugin redirects it to /dstream →
   identify() accepts it → the media flows to the server.
5. The admin sees the live stream and metrics in the dashboard.
```

## The real channel comes from the bot gateway

The media IDENTIFY carries **ephemeral** `server_id`/`channel_id` (created per session,
not real on Discord — the API returns 404), only good for grouping the media. The server
opens the **bot gateway** (intents GUILDS | GUILD_VOICE_STATES) and cross-references the
IDENTIFY `session_id` with `VOICE_STATE_UPDATE` to find the real channel the person is
in. That channel is what the dashboard shows and what the channel-mode rule evaluates.
See [DISCORD-OAUTH.md](DISCORD-OAUTH.md) §7.

## Security

- Account-based auth (not a shared secret). Short-lived sessions (signed cookie).
- Enablement is validated on the server (`/dstream` rejects peers that are not allowed).
- The server relays the media but the audio is E2EE (DAVE v1 / MLS) end to end.
- The admin area is gated by the session (admins listed in `ADMIN_DISCORD_IDS`) or an
  `X-Admin-Token`.
