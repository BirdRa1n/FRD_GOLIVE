#!/usr/bin/env bash
# FRD GoLive — bootstrap do instalador (macOS).
#
# Faz TUDO automaticamente, sem você clonar nada à mão:
#   1) verifica as dependências (git, node; pnpm é resolvido depois);
#   2) usa este repositório (ou clona, se você rodar o script solto);
#   3) compila o Vencord COM o plugin (scripts/build-vencord-dist.mjs);
#   4) compila e abre o instalador gráfico.
#
# Uso:  bash installer/scripts/install-mac.sh
set -euo pipefail

REPO_URL="https://github.com/BirdRa1n/FRD_GOLIVE"
CACHE_DIR="$HOME/.frd-golive"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[1;34m›\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$1"; }
err() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- 1. Explicação + consentimento ------------------------------------------
cat <<'EXPLAIN'

┌───────────────────────────────────────────────────────────────────────┐
│  FRD GoLive — instalador (macOS)                                        │
└───────────────────────────────────────────────────────────────────────┘

O que este script vai fazer:
  • Verificar/usar git e Node.js (não instala nada sem te avisar).
  • Baixar o Vencord num cache do SEU usuário (~/.frd-golive) e compilá-lo
    JÁ COM o plugin FRD GoLive. Nada é instalado como root nessa etapa.
  • Abrir o instalador gráfico para você escolher o servidor e aplicar.

Sobre permissões de administrador (senha do Mac):
  • A modificação do Discord (patch do app) pode PEDIR SUA SENHA quando o
    Discord estiver em /Applications — isso é o passo que injeta o Vencord
    no app do Discord. A janela de senha é do próprio macOS/Vencord.
  • O que muda no Discord: injeta o Vencord (client mod) e grava as settings
    do plugin + uma regra de CSP liberando SÓ o domínio do seu servidor.
  • NÃO enviamos dados a terceiros, não mexemos em chaves/keychain e nada
    fora de: o cache ~/.frd-golive, os dados do app e o app do Discord.

Antes de aplicar, FECHE o Discord.

EXPLAIN

printf 'Continuar? (s/N): '
IFS= read -r ans </dev/tty 2>/dev/null || ans=""
case "$ans" in s | S | y | Y | sim | Sim | yes) ;; *) err "Cancelado."; exit 1 ;; esac

# --- 2. Dependências --------------------------------------------------------
info "Verificando dependências…"
if ! have git; then
    err "git não encontrado. Rode 'xcode-select --install' e tente de novo."
    exit 1
fi
ok "git"

if ! have node; then
    warn "Node.js não encontrado."
    if have brew; then
        printf 'Instalar o Node.js via Homebrew agora? (s/N): '
        IFS= read -r a </dev/tty 2>/dev/null || a=""
        case "$a" in s | S | y | Y | sim | yes) brew install node ;; *) err "Node.js é obrigatório. Instale de https://nodejs.org e rode de novo."; exit 1 ;; esac
    else
        err "Node.js é obrigatório. Instale a versão LTS de https://nodejs.org e rode de novo."
        exit 1
    fi
fi
ok "node $(node --version)"

# --- 3. Localizar o repositório (ou clonar) ---------------------------------
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
    D="$(cd -P "$(dirname "$SOURCE")" && pwd)"; SOURCE="$(readlink "$SOURCE")"
    [ "${SOURCE#/}" = "$SOURCE" ] && SOURCE="$D/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$REPO_ROOT/client/src/index.tsx" ]; then
    info "Repositório não detectado — clonando em $CACHE_DIR/repo…"
    mkdir -p "$CACHE_DIR"
    if [ -d "$CACHE_DIR/repo/.git" ]; then git -C "$CACHE_DIR/repo" pull --ff-only || true
    else git clone --depth 1 "$REPO_URL" "$CACHE_DIR/repo"; fi
    REPO_ROOT="$CACHE_DIR/repo"
fi
INSTALLER_DIR="$REPO_ROOT/installer"
ok "Repositório: $REPO_ROOT"

# --- 4. Build do bundle + do instalador -------------------------------------
cd "$INSTALLER_DIR"
info "Instalando dependências do instalador (npm install)…"
npm install
info "Compilando o Vencord com o plugin (pode demorar na 1ª vez)…"
npm run build:vencord
ok "Bundle pronto."

# --- 5. Abrir o instalador gráfico ------------------------------------------
info "Abrindo o instalador… (escolha o servidor e clique em Aplicar)"
warn "Se o Discord estiver aberto, feche-o antes de aplicar."
npm start
