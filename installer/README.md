# FRD GoLive installer (Electron, Mac/Windows)

A graphical app that **applies the modification to Discord** without a terminal: the
user enters their own server host, it pulls the config from that host, writes the
plugin settings + the domain CSP, and injects into Discord. At the end it opens the
hub so the user can get access.

## Flow

1. Enter **the server host** (remembered across updates).
2. `GET https://<host>/config` → the host returns `nativeStreamEndpoint`, `mediaHost`,
   `authMode` and `oauth`. The UI shows server status + latency and adapts to the auth
   mode (Discord login vs allowed groups; in groups mode it lists the enabled groups).
3. Copies the **Vencord dist** (bundled with the plugin) into the data dir.
4. Writes `settings.json` (plugin config) + `native-settings.json` (`customCspRules`
   for the domain) into the data dir.
5. Downloads the **Vencord Installer CLI** and injects with `VENCORD_USER_DATA_DIR` +
   `VENCORD_DEV_INSTALL=1` (the same mechanism as `pnpm inject`).
6. **"Open the site"** button → opens the entered host (the hub).

The hub is served by the server itself (`server/`); login uses Discord OAuth — how to
configure it in [../docs/DISCORD-OAUTH.md](../docs/DISCORD-OAUTH.md).

## One-command install (recommended)

The bootstrap scripts do **everything** — check dependencies, download and build
Vencord **with the plugin** (in a per-user cache, without you cloning anything) and
open the installer. They **explain what will be done** and warn about the admin
password.

**macOS:**
```bash
bash installer/scripts/install-mac.sh
```

**Windows (PowerShell):**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\installer\scripts\install-windows.ps1
```

> About admin: patching Discord may ask for your password (macOS, when Discord is in
> `/Applications`). On Windows it usually does not (it writes to `%LocalAppData%`).
> What it changes: injects Vencord + enables the plugin + writes settings and a CSP
> rule for your domain only. Nothing is sent to third parties. **Close Discord before
> applying.**

## Development

```bash
npm install
npm run typecheck
npm run build:vencord   # builds installer/vencord-dist (clones Vencord, compiles the plugin)
npm start               # runs the app (needs vencord-dist/)
npm run start:full      # build:vencord + start, in one step
npm run dist            # build:vencord + packages .dmg (mac) / .exe (win)
```

## Build the app (.app / .exe) and publish a release

Ready-made scripts (run `npm install`, build Vencord with the plugin, the app, and
package it):

| | macOS | Windows |
|---|---|---|
| Build | `bash installer/scripts/build-app.sh` | `installer\scripts\build-app.bat` |
| Publish | `bash installer/scripts/publish-release.sh` | `installer\scripts\publish-release.bat` |

- **macOS** produces `release/FRD-GoLive-<v>-{arm64,x64}.dmg` (first install), `.zip`
  (used by auto-update), `latest-mac.yml` and `release/mac*/FRD GoLive.app`. Options:
  `--bump patch|minor|major`, `--arch arm64|x64|both`, `--skip-vencord`.
- **Windows** produces `release/FRD-GoLive-Setup-<v>.exe`, `.blockmap`, `latest.yml`
  and `release/win-unpacked/`. Options: `--bump`, `--skip-vencord`. The `.exe` is only
  produced on Windows (NSIS).
- **Publish** uses the GitHub CLI (`gh auth login` first) and uploads everything from
  `release/` to the `v<package.json version>` release of the configured repository
  (set `FRD_RELEASE_REPO=<org>/<repo>` or pass `--repo <org>/<repo>`). Mac and Windows
  can publish at different times: the first creates the release, the second just
  attaches the files. `--draft` creates a draft (auto-update ignores drafts until
  published).

A new-version flow: `build-app --bump patch` → test → commit/push `package.json` →
`publish-release` (on each OS).

### Auto-update (electron-updater)

On open, the packaged app looks for a new release in the configured repository,
downloads it and restarts updated (if it is mid-"Apply", it waits to finish). The
banner at the top of the window shows progress. In dev (`npm start`) it is off;
`FRD_DISABLE_UPDATES=1` disables it in packaged builds.

- **Windows:** updates itself even without a signature (SmartScreen warns on the first
  install).
- **macOS:** Squirrel.Mac only self-installs for an app signed with a **Developer ID**
  (set `CSC_LINK`/`CSC_KEY_PASSWORD` or have the certificate in the keychain). Without
  it, the build is signed **ad-hoc** (`scripts/after-pack.cjs`) — it opens normally
  (first time: right-click → Open) and, when there is a new version, the app shows
  "download the new version" with the release link.
- The releases of this repository are the **installer's**: the updater takes the
  latest (non-draft), so do not publish releases of other parts with a `v*` tag here.

## The `vencord-dist/` bundle

The app needs a **Vencord already built with the plugin** in `installer/vencord-dist/`
(gitignored). Generate it with the cross-platform script:

```bash
npm run build:vencord   # = node scripts/build-vencord-dist.mjs
```

It clones Vencord into `~/.frd-golive/build` (**outside the repo**, avoiding the pnpm
"walk up" problem), copies `client/src`, runs `pnpm build`, and publishes the resulting
`dist/` to `installer/vencord-dist`. Variables: `FRD_BUILD_DIR` (cache), `VENCORD_REPO`.

In dev you can point at an already-built Vencord without generating the bundle:
`FRD_VENCORD_DIST=~/Vencord/dist npm start`.

## Which Discord is modified (no prompt)

The installer runs the Vencord CLI **non-interactively** (`-install -branch auto`),
detecting the installed Discord automatically — it does not open the "Select Discord
install to patch" menu. To force a specific branch, set
`FRD_DISCORD_BRANCH=stable|ptb|canary` (default `auto`).

## Troubleshooting

- **`Electron failed to install correctly`** (common on **Node 26+**): Electron's
  postinstall uses `extract-zip`, which breaks on bleeding-edge Node — it downloads but
  only extracts `LICENSES.chromium.html`. Fixes:
  - **Recommended:** use **Node LTS (20 or 22)** for this app.
  - **Workaround** (download the binary by hand):
    ```bash
    VER=$(node -p "require('./node_modules/electron/package.json').version")
    A=$(uname -m); [ "$A" = arm64 ] && A=arm64 || A=x64   # macOS
    curl -fL -o /tmp/e.zip "https://github.com/electron/electron/releases/download/v$VER/electron-v$VER-darwin-$A.zip"
    rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
    unzip -q /tmp/e.zip -d node_modules/electron/dist
    printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
    ```
- **npm blocking install scripts** (`allowScripts`): approve with
  `npm install-scripts approve electron esbuild` and `npm rebuild electron esbuild`.

## Points to validate on real machines (WIP)

This installer needs testing on real Mac and Windows. Check:
- **Installer CLI flag** (`-install`) and headless behavior per platform.
- Vencord's **native settings path** (`settings/native-settings.json` /
  `customCspRules`) — it can vary by Vencord version.
- Signing/notarization (macOS) and SmartScreen (Windows) of the binaries.
- Closing Discord before injecting.

In the meantime, the manual method (copy `client/src` + `pnpm build` + `pnpm inject`)
remains valid.
