// Hook afterPack do electron-builder: assinatura AD-HOC do .app no macOS quando
// não há certificado Developer ID (build-app.sh liga com FRD_ADHOC_SIGN=1).
//
// Sem isso o app sai com a assinatura original do Electron, invalidada pelo
// empacotamento — e o macOS (Apple Silicon) diz que o app "está danificado".
// Roda antes dos targets (dmg/zip), então eles já levam o app assinado.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== "darwin" || process.env.FRD_ADHOC_SIGN !== "1") return;
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    console.log(`  • assinatura ad-hoc  app=${app}`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
