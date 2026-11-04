# Client logs

The mod sends each user's Discord logs to the admins' server, so intermittent failures
(for example the Discord connection dropping) can be investigated after the fact.

## Flow

```
renderer (logCollector.ts)  every 10 s, over IPC
   ▼
main (native.ts)            ~/.frd-golive/logs/*.jsonl (0600, capped at 30 MB)
   ▼  every 5 min, gzip, POST /logs/ingest
server (clientLogs.ts)      <data>/client-logs/<userId>/<YYYY-MM-DD>.jsonl.gz
   ▼
admin dashboard, "Logs" tab / GET /admin/logs/:userId/:day
```

Logs stay on disk until the server confirms them, so what happened while the network
was down arrives on the next successful cycle.

## What is collected

- The whole renderer console (`log`, `info`, `warn`, `error`, `debug`), which includes
  Discord's `RTCConnection`, `RTCControlSocket` and `Connection` loggers.
- A closed list of Flux events: `CONNECTION_CLOSED`/`RESUMED`, `RTC_CONNECTION_*`, `STREAM_*`.
- Uncaught errors, rejected promises and network online/offline changes.
- A media stats sample every 30 s while there is a media connection.

Native `discord_voice` log files and the main process console are **not** collected.

## Privacy

Removed: Discord tokens, values of keys such as `token`/`secret`/`session_id`, sensitive
query strings, and `data:` URIs (the Go Live screen thumbnail shows up that way in
`STREAM_PREVIEW_*`, and it is also why those events are not on the Flux list). The server
repeats the token and `data:` scrub before writing.

**Kept**, because diagnosis needs them: user, guild and channel IDs, stream keys, and IP
addresses (the media server and the local address in `Sending UDP info`). The logs also
show activity: `[MessageActionCreators]` records which channel the user opened (not the
message text), and rejected API calls include the error response. Anything that Discord
or another plugin prints to the console is also collected, so the scrub is a best effort
and cannot guarantee that a log line holds no personal data.

## Opting out

`logUpload` is on by default. It can be turned off in the installer or in the plugin
settings; both warn that without logs errors cannot be found. Turning it off stops the
capture and deletes whatever had not been sent. Logs already on the server stay until
retention removes them or an admin deletes them.

## Server

| Variable | Default | |
|---|---|---|
| `CLIENT_LOGS_ENABLED` | `1` | `0` answers 410, and clients discard their queue |
| `CLIENT_LOGS_DIR` | `client-logs` next to `DB_FILE` | |
| `CLIENT_LOGS_RETENTION_DAYS` | `14` | |
| `CLIENT_LOGS_USER_MAX_MB` | `200` | compressed size; oldest days go first |
| `CLIENT_LOGS_TOTAL_MAX_MB` | `5000` | compressed size; oldest days go first |

The dashboard's Logs tab can also pause storage and delete everything. While paused,
`/logs/ingest` answers 410, so clients discard those batches and they are never stored,
even after resuming (`POST /admin/logs/pause`, `DELETE /admin/logs`).

`GET /admin/logs`, `GET /admin/logs/:userId/:day` (`?level=warn,error&tail=500`, or
`?download=1` for the raw JSONL) and `DELETE /admin/logs/:userId` use the usual admin auth.

**Limitation:** `/logs/ingest` trusts the `userId` the client sends, like `/dstream`
`IDENTIFY` does. Anyone who can reach the server can write under another user's ID, so
treat the content as unverified. Rate limits and the caps above only bound the damage.
