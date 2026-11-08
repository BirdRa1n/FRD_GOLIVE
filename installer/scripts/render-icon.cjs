// Gera build/icon.png (1024×1024) a partir de build/icon.svg usando o próprio Electron.
// O electron-builder converte esse PNG em .icns (macOS) e .ico (Windows) no empacotamento.
//
// Uso (em installer/):  npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const BUILD = join(__dirname, "..", "build");
const SIZE = 1024;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const svg = readFileSync(join(BUILD, "icon.svg"), "utf8");
    const win = new BrowserWindow({
        width: SIZE, height: SIZE, show: false, transparent: true, frame: false,
        useContentSize: true, webPreferences: { offscreen: true },
    });
    const html = `<!doctype html><html><body style="margin:0;background:transparent">
        <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`;
    await win.loadURL("data:text/html;base64," + Buffer.from(html).toString("base64"));
    await new Promise(r => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
    const png = img.resize({ width: SIZE, height: SIZE }).toPNG();
    writeFileSync(join(BUILD, "icon.png"), png);
    console.log(`[render-icon] build/icon.png (${SIZE}×${SIZE}, ${png.length} bytes)`);
    app.quit();
});
