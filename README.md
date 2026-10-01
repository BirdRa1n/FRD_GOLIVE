# FRD GoLive — private screen sharing for Discord (via Vencord)

A Discord client modification (Vencord plugin) + a self-hostable server that lets
people in the **same Discord voice call** share their **screen without the video
going through Discord's servers**. The screen video is carried by the
organization's own **private server**; **voice (and camera) stay native on
Discord**.

Focus: **companies with strict privacy rules** that do not want screen-share media
flowing through Discord's infrastructure.

## How it works (summary)

Instead of reimplementing streaming, the plugin **reuses Discord's native Go Live**
and only **redirects** where its media goes:

1. The user starts Discord's **native Go Live** as usual.
2. The plugin redirects the Go Live **control connection** to the private server
   (WS `/dstream`); the native `discord_voice` module sends the **RTP (video +
   audio)** to the server.
3. The control plane is HTTP/WS (can go through a reverse proxy / tunnel); the
   **media is UDP** and enters through a **public IP** the host configures
   (usually a VPS that relays it to a home/office server).
4. **Voice (and camera) stay 100% on Discord.** The screen audio is **E2EE**
   (DAVE v1 / MLS).

```
  User A (plugin)                  Private server                 User B (Discord)
 ┌──────────────────┐  WS /dstream ┌──────────────────┐          ┌──────────────────┐
 │ native Go Live   │─────────────▶│  hub/auth/admin  │          │  native Go Live  │
 │ (discord_voice)  │──RTP/UDP────▶│  + media relay   │──RTP────▶│  viewer          │
 └──────────────────┘              │  public IP/relay │          └──────────────────┘
        voice ▲                    └──────────────────┘                 voice ▲
            └───────────── Discord (gateway + native voice) ─────────────────┘
```

> **History:** earlier versions used a mesh/P2P transport and then an SFU (LiveKit).
> Both were removed once native Go Live worked through the private server.

## Components

```
.
├── client/     # Vencord userplugin (TypeScript/React) — redirect + diagnostics
├── installer/  # graphical installer (Electron, Mac/Windows) that applies the mod
├── server/     # hub + auth + config + admin + native Go Live media (Node, Docker)
└── docs/       # architecture, roadmap and guides
```

- **Server** ([server/README.md](server/README.md)): hub (Discord login) + auth /
  enablement + quotas + admin + config, and the native Go Live media relay. The
  control plane is HTTP/WS (reverse proxy / tunnel); the **media** enters over UDP on
  the **public IP** the host configures (see [docs/RELAY-UDP.md](docs/RELAY-UDP.md)).
- **Installer** ([installer/README.md](installer/README.md)): a graphical app that
  applies the modification to Discord without a terminal, pulls the config from the
  host and opens the hub.
- **Plugin** (`client/`): redirects native Go Live to the private server and provides
  live diagnostics.

## Quick start

**Server** (Linux with Docker):

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/server/install.sh | sh
```

Expose **one HTTP/WS route** through your reverse proxy / tunnel:
`stream.example.com`→`:8090` (hub + WS `/dstream`). The **UDP media** enters through
the public IP (see [docs/RELAY-UDP.md](docs/RELAY-UDP.md)). Hub OAuth:
[docs/DISCORD-OAUTH.md](docs/DISCORD-OAUTH.md).

**Clients**: run the **installer** (`installer/`), enter **their own server host**,
then (in login mode) request access in the hub. The admin enables them from the
dashboard. In channels mode, any voice channel the admin enabled is ready to use.

## Usage requirements

- **Every participant must have the plugin installed** (via the installer) and point
  it at the **same server**. People without it do not see the private stream.
- The server is self-hosted by the organization (Docker), behind a reverse proxy, with
  the media entering through a public IP (VPS/relay) — see
  [docs/RELAY-UDP.md](docs/RELAY-UDP.md).
- Only people the admin **enables** in the hub (or who are in an enabled channel) can
  stream.

## Legal / ToS notice

This project uses a **client mod (Vencord)**, whose use is against Discord's Terms of
Service — the risk is the user's. The goal is **corporate privacy**: keeping
screen-share media out of third-party infrastructure.

## License

MIT — see [LICENSE](LICENSE).
