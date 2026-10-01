# Installing the client on Windows

How to install the **FRDGoLive** plugin into Discord Desktop on Windows. Because
Vencord compiles plugins at build time, you build Vencord with our plugin inside and
inject it into Discord.

> Do this **on every machine** that will use the private stream, all pointing at the
> **same** server (`nativeStreamEndpoint`).

> The **graphical installer** ([../installer/](../installer)) does all of this without a
> terminal — prefer it unless you want the manual steps below.

## 1. Prerequisites

Open **PowerShell** and install (via winget):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
npm install -g pnpm
```

**Close ALL PowerShell windows and open a new one** — otherwise the new `PATH` is not in
effect and you will see `'node' is not recognized` later. Check (all must print a version
before continuing):

```powershell
node -v ; git --version ; pnpm -v
```

If `node -v` still says "not recognized" in a new window, install Node from the official
LTS installer (https://nodejs.org), reopen PowerShell, and test again.

### Allow script execution (needed for pnpm)

By default Windows blocks `.ps1` scripts and `pnpm` fails with *"running scripts is
disabled on this system"*. Allow it for your user (no admin needed):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Confirm with **Y**. `RemoteSigned` allows local scripts and only requires a signature for
scripts downloaded from the internet. Alternative without changing the policy: use the
`.cmd` shim (`pnpm.cmd install`, `pnpm.cmd build`, etc.) instead of `pnpm ...`.

## 2. Clone Vencord (OUTSIDE any of our repos)

```powershell
git clone https://github.com/Vendicated/Vencord "$env:USERPROFILE\Vencord"
cd "$env:USERPROFILE\Vencord"
pnpm install
```

> Do not clone Vencord inside our project's `client/` folder — pnpm "walks up" and uses
> the wrong `package.json`, giving `Command "build" not found`.

## 3. Copy the plugin into Vencord

Download/clone our repository (e.g. to `C:\FRD_GOLIVE`) and **copy** the `client\src`
folder to `src\userplugins\frdGoLive`:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Vencord\src\userplugins" | Out-Null
Copy-Item -Recurse -Force "C:\FRD_GOLIVE\client\src" "$env:USERPROFILE\Vencord\src\userplugins\frdGoLive"
```

Adjust `C:\FRD_GOLIVE` to wherever you cloned the project.

> **Copy, do not symlink.** Vencord resolves aliases (`@webpack/common` etc.) scoped to
> `src/**`; a link outside the repo breaks the build. And copy **`client\src`** (which
> contains `index.tsx`), not all of `client\`.

## 4. Build and inject

Close **Discord completely** (right-click the tray icon → Quit — not just the window X).
Then:

```powershell
cd "$env:USERPROFILE\Vencord"
pnpm build
pnpm inject
```

In the installer menu, choose **Install Vencord** and select your Discord.

### If `pnpm inject` fails (404 download / error)

Download the CLI installer by hand and run it with the variables pointing at your build:

```powershell
$url = "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe"
Invoke-WebRequest $url -OutFile "$env:TEMP\VencordInstallerCli.exe"
$env:VENCORD_USER_DATA_DIR = "$env:USERPROFILE\Vencord"
$env:VENCORD_DEV_INSTALL = "1"
& "$env:TEMP\VencordInstallerCli.exe"
```

Choose **Install Vencord**. If SmartScreen warns that the app is unrecognized, click "More
info" → "Run anyway" (the binary is the official Vencord installer, just unsigned).

## 5. Enable and configure in Discord

1. Open Discord.
2. **Settings → Vencord → Plugins** → find **FRDGoLive** → enable.
3. Still in the plugin settings, fill in:
   - `nativeStreamEndpoint` → `stream.example.com/dstream` (no scheme; Discord prefixes
     `wss://`). This is the private server's control WS.
   - `nativeStreamDave` → on (audio E2EE), matching the server's `NATIVE_STREAM_DAVE=1`.

Then start Discord's **native Go Live** — the media goes to the private server.

## 6. Regions with screen-sharing blocks

If Discord disables screen sharing in your region, enable **"Native capture"** in the
plugin settings. On Windows that mode (via `desktopCapturer`) works well and **also
captures system audio**.

## Updating the plugin later (dev loop)

When you change the code, re-sync and rebuild:

```powershell
robocopy "C:\FRD_GOLIVE\client\src" "$env:USERPROFILE\Vencord\src\userplugins\frdGoLive" /MIR
cd "$env:USERPROFILE\Vencord"
pnpm build
```

Then restart Discord (Ctrl+R in the window usually reloads it).

## Common problems

- **`running scripts is disabled on this system`** (running `pnpm`) → run
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use
  `pnpm.cmd` instead of `pnpm`.
- **`'node' is not recognized`** (esbuild postinstall fails) → Node is not on this
  session's PATH. Close and reopen PowerShell; confirm with `node -v`; then run
  `pnpm install` again. If it persists, install Node LTS from the official MSI.
- **`Command "build" not found`** → you are in the wrong folder or cloned Vencord inside
  `client/`. Run `pnpm build` inside `%USERPROFILE%\Vencord`.
- **`Could not resolve "@webpack/common"`** → you used a symlink or copied `client\`
  instead of `client\src`. Redo the copy of the `client\src` folder.
- **Plugin does not appear** → check that
  `%USERPROFILE%\Vencord\src\userplugins\frdGoLive\index.tsx` exists and rebuild.
- **Connects but the screen does not appear** → that is the media path (UDP) on the
  server, not the client. See `server/README.md`.
