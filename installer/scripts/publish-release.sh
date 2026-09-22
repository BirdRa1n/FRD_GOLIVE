#!/usr/bin/env bash
# FRD GoLive — publica o instalador compilado como release no GitHub (gh CLI).
#
# Sobe o que estiver em installer/release/ (gerado por build-app.sh / .bat) para a
# release v<versão do package.json> em BirdRa1n/FRD_GOLIVE. É dessa release que o
# auto-update (electron-updater) dos apps instalados puxa a nova versão.
#
# Mac e Windows podem publicar em momentos diferentes: o 1º cria a release, o
# 2º só anexa os arquivos dele (latest-mac.yml e latest.yml não conflitam).
#
# Uso:
#   bash installer/scripts/publish-release.sh [opções]
#     --draft                cria como rascunho (o auto-update IGNORA rascunhos;
#                            publique depois com: gh release edit vX.Y.Z --draft=false)
#     --notes "texto"        notas da release (padrão: geradas dos commits)
#     --repo dono/repo       outro repositório (padrão: BirdRa1n/FRD_GOLIVE ou $FRD_RELEASE_REPO)
#
# Requer: gh autenticado (gh auth login) com permissão de escrita no repositório.
set -euo pipefail

info() { printf '\033[1;34m›\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$1"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

REPO="${FRD_RELEASE_REPO:-BirdRa1n/FRD_GOLIVE}"
DRAFT=0
NOTES=""
while [ $# -gt 0 ]; do
    case "$1" in
        --draft) DRAFT=1; shift ;;
        --notes) NOTES="${2:-}"; shift 2 ;;
        --repo) REPO="${2:-}"; shift 2 ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) die "Opção desconhecida: $1 (use --help)" ;;
    esac
done

INSTALLER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$INSTALLER_DIR"

command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) não encontrado: https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "gh não está autenticado. Rode: gh auth login"

VERSION="$(node -p 'require("./package.json").version')"
TAG="v$VERSION"

# Arquivos gerados pelo electron-builder para ESTA versão (+ os latest*.yml).
shopt -s nullglob
FILES=()
for f in release/*"$VERSION"*.{dmg,zip,exe,blockmap} release/latest*.yml; do
    FILES+=("$f")
done
shopt -u nullglob
[ ${#FILES[@]} -gt 0 ] || die "Nada para publicar em installer/release/ para a versão $VERSION. Rode build-app.sh (ou .bat) antes."

# Os latest*.yml precisam ser da mesma versão (senão o update aponta pro lugar errado).
for y in release/latest*.yml; do
    [ -e "$y" ] || continue
    grep -q "^version: $VERSION\$" "$y" || die "$(basename "$y") não é da versão $VERSION — recompile antes de publicar."
done

info "Release $TAG em $REPO — arquivos:"
for f in "${FILES[@]}"; do printf '  %s\n' "$(basename "$f")"; done

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    info "A release $TAG já existe — anexando/substituindo arquivos…"
    gh release upload "$TAG" "${FILES[@]}" --repo "$REPO" --clobber
else
    ARGS=(--repo "$REPO" --title "FRD GoLive $VERSION")
    if [ -n "$NOTES" ]; then ARGS+=(--notes "$NOTES"); else ARGS+=(--generate-notes); fi
    [ "$DRAFT" = 1 ] && ARGS+=(--draft)
    # Marca a release no commit atual se ele já estiver no GitHub.
    SHA="$(git rev-parse HEAD 2>/dev/null || true)"
    if [ -n "$SHA" ] && git branch -r --contains "$SHA" 2>/dev/null | grep -q .; then
        ARGS+=(--target "$SHA")
    else
        warn "O commit atual não está no GitHub — a tag $TAG vai apontar para a branch padrão."
    fi
    info "Criando a release $TAG…"
    gh release create "$TAG" "${FILES[@]}" "${ARGS[@]}"
fi

ok "Publicado: $(gh release view "$TAG" --repo "$REPO" --json url -q .url)"
if [ "$DRAFT" = 1 ]; then
    warn "Rascunho: o auto-update só enxerga depois de: gh release edit $TAG --repo $REPO --draft=false"
fi
