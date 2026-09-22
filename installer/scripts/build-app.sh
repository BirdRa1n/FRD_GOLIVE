#!/usr/bin/env bash
# FRD GoLive — compila o instalador e gera o app de distribuição (macOS).
#
# Gera em installer/release/:
#   FRD-GoLive-<versão>-arm64.dmg / -x64.dmg   → 1ª instalação
#   FRD-GoLive-<versão>-arm64.zip / -x64.zip   → usados pelo auto-update
#   latest-mac.yml (+ .blockmap)               → lido pelo electron-updater
#   mac-arm64/FRD GoLive.app, mac/FRD GoLive.app
#
# O .exe do Windows é gerado no Windows: installer\scripts\build-app.bat
# Para publicar depois:  bash installer/scripts/publish-release.sh
#
# Uso:
#   bash installer/scripts/build-app.sh [opções]
#     --bump patch|minor|major   sobe a versão do package.json antes (sem tag git)
#     --arch arm64|x64|both      arquitetura(s) do macOS (padrão: both)
#     --skip-vencord             reaproveita o vencord-dist/ existente (não recompila o plugin)
#
# Assinatura (macOS): usa um certificado "Developer ID Application" se houver
# (keychain ou CSC_LINK/CSC_NAME). Sem certificado, faz assinatura ad-hoc — o app
# abre (botão direito → Abrir na 1ª vez), mas o auto-update no macOS vira
# "baixe a nova versão" (o Squirrel.Mac exige Developer ID).
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[1;34m›\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

BUMP=""
ARCH="both"
SKIP_VENCORD=0
while [ $# -gt 0 ]; do
    case "$1" in
        --bump) BUMP="${2:-}"; shift 2 ;;
        --arch) ARCH="${2:-}"; shift 2 ;;
        --skip-vencord) SKIP_VENCORD=1; shift ;;
        -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
        *) die "Opção desconhecida: $1 (use --help)" ;;
    esac
done

case "$BUMP" in ""|patch|minor|major) ;; *) die "--bump aceita patch, minor ou major" ;; esac
case "$ARCH" in arm64|x64|both) ;; *) die "--arch aceita arm64, x64 ou both" ;; esac

[ "$(uname -s)" = "Darwin" ] || die "Este script gera o app do macOS. No Windows use installer\\scripts\\build-app.bat."

INSTALLER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$INSTALLER_DIR"

# --- dependências ----------------------------------------------------------
bold "FRD GoLive — build do instalador (macOS)"
have node || die "Node.js não encontrado. Instale o Node LTS (20 ou 22): https://nodejs.org"
have npm || die "npm não encontrado."
have git || die "git não encontrado (necessário para compilar o Vencord)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then die "Node $NODE_MAJOR é antigo demais — use 20 ou 22."; fi
if [ "$NODE_MAJOR" -ge 26 ]; then warn "Node $NODE_MAJOR: o download do Electron pode falhar (ver installer/README.md › Troubleshooting). Prefira Node 22."; fi

# --- versão ----------------------------------------------------------------
if [ -n "$BUMP" ]; then
    info "Subindo versão ($BUMP)…"
    npm version "$BUMP" --no-git-tag-version >/dev/null
fi
VERSION="$(node -p 'require("./package.json").version')"
ok "Versão $VERSION"

# --- build -----------------------------------------------------------------
info "Instalando dependências do instalador…"
npm install --no-audit --no-fund

if [ "$SKIP_VENCORD" = 1 ] && [ -d vencord-dist ] && [ -n "$(ls -A vencord-dist)" ]; then
    ok "Reaproveitando vencord-dist/ (--skip-vencord)"
else
    info "Compilando o Vencord com o plugin (vencord-dist/)…"
    node scripts/build-vencord-dist.mjs
fi

info "Compilando o app (TypeScript + design system)…"
npm run build

rm -rf release

ARCH_FLAGS=()
case "$ARCH" in
    arm64) ARCH_FLAGS=(--arm64) ;;
    x64) ARCH_FLAGS=(--x64) ;;
    both) ARCH_FLAGS=(--arm64 --x64) ;;
esac

SIGN_FLAGS=()
if [ -n "${CSC_LINK:-}" ] || [ -n "${CSC_NAME:-}" ] \
    || security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
    ok "Certificado Developer ID encontrado — o app será assinado (auto-update completo)."
else
    warn "Sem certificado Developer ID: assinatura ad-hoc."
    warn "O app abre normalmente (1ª vez: botão direito → Abrir), mas no macOS o auto-update"
    warn "vai mostrar 'baixe a nova versão' em vez de instalar sozinho."
    # O builder não faz ad-hoc sozinho: desliga a assinatura dele e o hook
    # scripts/after-pack.cjs assina o .app com "-" antes do dmg/zip.
    SIGN_FLAGS=(-c.mac.identity=null)
    export FRD_ADHOC_SIGN=1
fi

info "Empacotando (.app, .dmg, .zip)…"
# ${arr[@]+...}: array vazio com `set -u` quebra no bash 3.2 do macOS.
npx electron-builder --mac dmg zip "${ARCH_FLAGS[@]}" ${SIGN_FLAGS[@]+"${SIGN_FLAGS[@]}"} --publish never

# --- resultado -------------------------------------------------------------
echo
bold "Pronto — arquivos em installer/release/:"
for f in release/*.dmg release/*.zip release/latest-mac.yml; do
    if [ -e "$f" ]; then printf '  %s  (%s)\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"; fi
done
for app in release/mac*/*.app; do
    if [ -e "$app" ]; then printf '  %s\n' "${app#release/}"; fi
done
echo
info "Publicar esta versão (v$VERSION) no GitHub:  bash installer/scripts/publish-release.sh"
