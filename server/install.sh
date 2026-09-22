#!/usr/bin/env sh
# Instalador do servidor FRD GoLive v2 (mesh) — estilo "curl | sh".
#
#   curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
#
# O servidor v2 só faz signaling + auth + config + admin (tudo HTTP/WS, uma única
# porta), então passa 100% pelo Cloudflare Tunnel — sem VPS/UDP. Este script:
# verifica dependências (git, docker, docker compose), clona/atualiza o repositório,
# gera o .env com segredos aleatórios, opcionalmente configura o OAuth do Discord e
# o Tailscale, e sobe o container.
set -eu

REPO_DEFAULT="https://github.com/BirdRa1n/FRD_GOLIVE"
DIR_DEFAULT="/opt/frd-golive"

# --- helpers de terminal (funcionam mesmo com o script vindo por um pipe) ---
info() { printf '\033[1;34m›\033[0m %s\n' "$1"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$1"; }
err() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# Lê do /dev/tty (stdin está ocupado pelo pipe do curl). $1=prompt $2=default.
ask() {
    _d="${2:-}"
    if [ -n "$_d" ]; then printf '%s [%s]: ' "$1" "$_d" >/dev/tty
    else printf '%s: ' "$1" >/dev/tty; fi
    IFS= read -r _a </dev/tty 2>/dev/null || _a=""
    [ -z "$_a" ] && _a="$_d"
    printf '%s' "$_a"
}
confirm() {
    _a=$(ask "$1 (s/N)" "N")
    case "$_a" in s | S | y | Y | sim | Sim | yes) return 0 ;; *) return 1 ;; esac
}

# Define/atualiza KEY=VALUE num arquivo .env. $1=key $2=val $3=file
set_env() {
    if grep -q "^$1=" "$3" 2>/dev/null; then
        _t=$(mktemp)
        sed "s|^$1=.*|$1=$2|" "$3" >"$_t" && mv "$_t" "$3"
    else
        printf '%s=%s\n' "$1" "$2" >>"$3"
    fi
}

SUDO=""
if [ "$(id -u)" -ne 0 ] && have sudo; then SUDO="sudo"; fi

printf '\n\033[1mFRD GoLive — instalador do servidor (v2 mesh)\033[0m\n\n'

# --- 1. Dependências ---
info "Verificando dependências…"

if ! have git; then
    err "git não encontrado. Instale o git e rode de novo (ex.: apt install git)."
    exit 1
fi
ok "git"

if ! have docker; then
    warn "Docker não encontrado."
    if confirm "Instalar o Docker agora (script oficial get.docker.com)?"; then
        curl -fsSL https://get.docker.com | $SUDO sh
        ok "Docker instalado"
    else
        err "Docker é obrigatório. Abortando."
        exit 1
    fi
fi
ok "docker"

if ! $SUDO docker compose version >/dev/null 2>&1; then
    err "Plugin 'docker compose' (v2) não disponível. Atualize o Docker."
    exit 1
fi
ok "docker compose"

have openssl || warn "openssl ausente — o gerador de .env cai no /dev/urandom (ok)."

# --- 2. Código ---
REPO=$(ask "Repositório do código" "$REPO_DEFAULT")
DIR=$(ask "Diretório de instalação" "$DIR_DEFAULT")

if [ -d "$DIR/.git" ]; then
    info "Repositório já existe em $DIR — atualizando…"
    git -C "$DIR" pull --ff-only
else
    info "Clonando $REPO em $DIR…"
    $SUDO mkdir -p "$DIR"
    $SUDO chown "$(id -u):$(id -g)" "$DIR" 2>/dev/null || true
    git clone "$REPO" "$DIR"
fi
ok "Código pronto em $DIR"

ENV_FILE="$DIR/server/.env"

# --- 3. Credenciais ---
if [ -f "$ENV_FILE" ]; then
    warn ".env já existe em $ENV_FILE — mantendo (use server/gen-env.sh --force para recriar)."
else
    info "Gerando .env com segredos aleatórios (ADMIN_TOKEN, SESSION_SECRET)…"
    sh "$DIR/server/gen-env.sh"
fi

# --- 4. OAuth do Discord (hub/admin) — opcional ---
if confirm "Configurar o login do Discord (hub/admin) agora?"; then
    info "Crie o app em https://discord.com/developers/applications (guia: docs/DISCORD-OAUTH.md)."
    set_env DISCORD_CLIENT_ID "$(ask 'DISCORD_CLIENT_ID' '')" "$ENV_FILE"
    set_env DISCORD_CLIENT_SECRET "$(ask 'DISCORD_CLIENT_SECRET' '')" "$ENV_FILE"
    HOST=$(ask "Host público do hub (ex.: golivefrd.seu.com)" "")
    [ -n "$HOST" ] && set_env DISCORD_REDIRECT_URI "https://$HOST/auth/callback" "$ENV_FILE"
    set_env ADMIN_DISCORD_IDS "$(ask 'Seu Discord user ID (admin)' '')" "$ENV_FILE"
    warn "No portal do Discord, cadastre EXATAMENTE o Redirect: https://$HOST/auth/callback"
fi

# --- 5. TURN (opcional, só NAT simétrico/corporativo) ---
if confirm "Configurar um servidor TURN (só para NAT restritivo)?"; then
    set_env TURN_URLS "$(ask 'TURN_URLS (ex.: turn:turn.seu.com:3478)' '')" "$ENV_FILE"
    set_env TURN_USERNAME "$(ask 'TURN_USERNAME' '')" "$ENV_FILE"
    set_env TURN_CREDENTIAL "$(ask 'TURN_CREDENTIAL' '')" "$ENV_FILE"
fi

# --- 6. Tailscale (opcional) ---
if confirm "Instalar o Tailscale para acesso privado ao servidor?"; then
    curl -fsSL https://tailscale.com/install.sh | $SUDO sh
    $SUDO tailscale up || warn "Rode 'sudo tailscale up' manualmente para autenticar."
    ok "Tailscale instalado"
fi

# --- 7. Subir ---
info "Subindo o container…"
cd "$DIR/server"
$SUDO docker compose up -d --build

PORT=$(grep '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2); PORT="${PORT:-8090}"

printf '\n'
ok "Servidor no ar."
info "Health:     http://<host>:$PORT/health"
info "Config:     http://<host>:$PORT/config   (o instalador/plugin puxa daqui)"
info "Hub/admin:  http://<host>:$PORT/          (login Discord, se configurado)"
printf '\nExponha via Cloudflare Tunnel: golivefrd.SEU.com -> http://<host>:%s\n' "$PORT"
printf '(HTTP e o WebSocket /signaling na MESMA porta — nada de UDP.)\n'
