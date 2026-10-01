# Roadmap

Where the project is and what is next. The transport history (mesh → SFU → native
Go Live) is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Shipped

- **Native Go Live transport.** The plugin redirects Discord's native Go Live to the
  private server (`/dstream`); the media (RTP) enters over UDP through a public IP. The
  `keyframe_interval` in op4 unlocks the encoder. See [GOLIVE-NATIVE.md](GOLIVE-NATIVE.md).
- **Audio E2EE (DAVE v1 / MLS).** See [DAVE.md](DAVE.md).
- **Hub + auth + admin.** Discord OAuth login, per-user enablement + quotas, and a
  tabbed admin dashboard (overview, groups, users, settings) with guild icons and user
  avatars served from a server-side image cache.
- **Channel-based enablement.** `channels` mode: anyone in an enabled voice channel can
  stream (except banned members). The real channel is resolved via the bot gateway.
- **Config endpoint.** `GET /config` returns the `/dstream` endpoint, media host, auth
  mode and OAuth flag; `GET /groups` exposes the enabled groups to the installer.
- **Electron installer (Mac + Windows).** Enter your own server host (remembered across
  updates), live status + latency, auth-mode-aware UI, auto-update.

## Next

- [ ] Persist the store in SQLite/Postgres instead of a JSON file (`server/src/store.ts`).
- [ ] Optional: block the screen-thumbnail upload (`POST /streams/:key/preview`) in the
      client for a stricter privacy posture.
- [ ] macOS stream audio (the desktopCapturer does not deliver it today — see the audio
      note in [CLAUDE.md](../CLAUDE.md)).
- [ ] Session history, quota alerts, audit logs.
- [ ] Decouple the installer auto-update from a specific release host if the project
      moves off GitHub releases.

## Out of scope (for now)

- Session recording.
- Server-side transcoding (the media is relayed, not re-encoded centrally).
