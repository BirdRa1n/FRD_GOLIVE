# FRD GoLive server — hub/auth/admin + native Go Live media

The FRD GoLive server. It is the **hub (Discord login) + auth/enablement + quotas +
admin + config**, and it relays the **native Go Live media**. The screen video
(RTP from `discord_voice`) reaches the server over **UDP** through the **public IP
you configure** (e.g. a VPS that relays the UDP to a home/office server).

Everything the client speaks with the hub is **HTTP/WS** (can go through a reverse
proxy / tunnel). Only the **UDP media** needs the public IP/relay — see
[docs/RELAY-UDP.md](../docs/RELAY-UDP.md).

## Run it

Guided install (recommended — clones, generates credentials, asks for the media IP
and brings it up):

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/server/install.sh | sh
```

Or manually, inside `server/`:

```bash
./gen-env.sh                 # generates .env with ADMIN_TOKEN, SESSION_SECRET, etc.
# edit .env: set NATIVE_STREAM_PUBLIC_IP (media UDP IP) and NATIVE_STREAM_DAVE=1
docker compose up -d --build # brings up the hub (8090) + the UDP media listener
```

Discord login (hub/admin): fill in `DISCORD_*` and `ADMIN_DISCORD_IDS` — see
[docs/DISCORD-OAUTH.md](../docs/DISCORD-OAUTH.md).

## Media flow (native Go Live)

1. The plugin pulls `GET /config` → `nativeStreamEndpoint` (the `/dstream` host) +
   `mediaHost` (public media IP) + `authMode`/`oauth`.
2. The user starts Discord's **native Go Live**; the plugin redirects the control
   connection to **WS `/dstream`**. `identify()` checks `store.canStream(...)`.
3. If allowed, the native `discord_voice` module sends the **RTP (video + audio)** to
   the media UDP port; the audio is E2EE (DAVE v1 / MLS).
4. The live state shows up in `/admin` (rooms, who is streaming/watching).

A peer that is **not allowed** is rejected on `/dstream`; the hub page shows "waiting
for approval". When the admin enables them, the next attempt succeeds (and disabling a
channel drops whoever is already live).

## Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/health` | status/version |
| GET | `/config` | `/dstream` endpoint + media IP + version + `authMode` + `oauth` |
| GET | `/groups` | enabled groups (guild-level: id, name, icon) — public, for the installer |
| GET | `/img/guild/:id` | cached guild icon — public |
| WS | `/dstream` | native Go Live media/control (`identify` checks who may stream) |
| POST | `/auth/request-access` | `{userId,name}` — records the request |
| GET | `/policy/:userId` | current policy (enabled + quotas) |
| GET | `/admin/users` · `/admin/metrics` | panel (cookie session or `X-Admin-Token`) |
| POST | `/admin/users/:id/enable` | `{enabled,maxHeight,maxFps}` |
| GET/POST | `/admin/settings` | `{authMode}` — `login` (manual) or `channels` |
| GET | `/admin/live` | live rooms from `/dstream`: who streams/watches + settings |
| GET | `/admin/groups` | configured channels grouped by guild (+ live members) |
| GET | `/admin/bot` | bot status + invite link + gateway connection + admin count |
| GET | `/admin/channels` · POST | list / add enabled channels |
| POST | `/admin/channels/:id/enable` · `/ban` · DELETE `/:id` | enable channel, ban member, remove |
| GET | `/admin/bot/guilds` · `/admin/bot/guilds/:id/channels` | browse guilds/channels via the bot |
| GET | `/admin/img/guild/:id` · `/admin/img/user/:id` | cached guild icon / user avatar |

### Who may stream (`authMode`)

- **`login`** (default): only users enabled in `/admin/users`.
- **`channels`**: anyone in an **enabled channel** may stream — except members
  **banned** in that channel. The default is **allow everything**: enabling the mode
  (or hitting **Sync with the bot**) seeds every voice channel of the bot's guilds as
  **enabled** at once, and the admin only **turns off** the exceptions. Channels of
  guilds without the bot appear on their own when someone tries to stream — already
  enabled. `DISCORD_BOT_TOKEN` lets you pick from the UI (without the bot you can paste
  the IDs).
- **The stream's channel comes from the bot gateway**: the media IDENTIFY carries
  **ephemeral** `server_id`/`channel_id` (created when the stream starts; not real on
  Discord — the API returns 404 — and they change every session), so they only group
  the media. The server opens the **bot gateway** and cross-references the IDENTIFY
  `session_id` with `VOICE_STATE_UPDATE` to find the real channel the person is in:
  that is the channel the dashboard shows (`label`/`channelId` in `/admin/live`) and
  the rule evaluates. **Disabling or banning drops whoever is already live** (4004).
  Without the bot/gateway, the IDENTIFY id is used (legacy behavior).

## Configuration (`.env`)

Main keys (`gen-env.sh` generates random secrets):

| Variable | Description |
|---|---|
| `PORT` | hub port (default 8090) |
| `ADMIN_TOKEN` / `SESSION_SECRET` | protects `/admin/*` / signs the cookie — random |
| `NATIVE_STREAM_PUBLIC_IP` | **public IP the media (UDP) enters through** |
| `NATIVE_STREAM_UDP_PORT` | media UDP port (e.g. 7883) |
| `NATIVE_STREAM_DAVE` | `1` to enable E2EE (DAVE v1 / MLS) on the stream audio |
| `NATIVE_STREAM_KEYFRAME_INTERVAL` | op4 keyframe interval that unlocks the encoder (default 2000) |
| `DEFAULT_MAX_HEIGHT` / `DEFAULT_MAX_FPS` | default quotas |
| `DB_FILE` / `IMG_CACHE_DIR` | store JSON path / image cache dir |
| `DISCORD_*` / `ADMIN_DISCORD_IDS` | hub OAuth — see docs/DISCORD-OAUTH.md |
| `DISCORD_BOT_TOKEN` | bot token — guilds/channels, names and the **real channel of each stream** (gateway) |

## Reverse proxy (1 HTTP/WS route)

`stream.example.com` → `http://SERVER:8090` (hub: config/control + WS `/dstream`).

The **UDP media** does NOT go through the proxy: it enters through the public IP
(`NATIVE_STREAM_PUBLIC_IP`) via relay — see [docs/RELAY-UDP.md](../docs/RELAY-UDP.md).
