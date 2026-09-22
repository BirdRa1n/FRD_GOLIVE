#!/usr/bin/env sh
# Instalador do servidor FRD GoLive — estilo "curl | sh".
#
#   curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
#
# Verifica dependências (git, docker, docker compose), clona o repositório e
# pergunta, de forma interativa, se você quer gerar o .env, customizar portas,
# customizar o repositório de updates, configurar o bot de presença, habilitar o
# painel admin e instalar o Tailscale para acesso privado.
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

printf '\n\033[1mFRD GoLive — instalador do servidor\033[0m\n\n'

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

# --- 3. Configuração interativa ---
if confirm "Gerar o .env com segredos aleatórios agora?"; then
    sh "$DIR/server/gen-env.sh" --force
else
    [ -f "$ENV_FILE" ] || cp "$DIR/server/.env.example" "$ENV_FILE"
fi

if confirm "Customizar portas?"; then
    set_env LIVEKIT_PORT "$(ask 'Porta LiveKit (ws)' '7880')" "$ENV_FILE"
    set_env TOKEN_PORT "$(ask 'Porta token-service' '8080')" "$ENV_FILE"
fi

if confirm "Customizar o repositório de updates?"; then
    set_env UPDATE_REPO "$(ask 'UPDATE_REPO' "$REPO")" "$ENV_FILE"
    set_env UPDATE_BRANCH "$(ask 'UPDATE_BRANCH' 'main')" "$ENV_FILE"
fi

if confirm "Configurar o bot de presença do Discord agora?"; then
    set_env DISCORD_BOT_TOKEN "$(ask 'DISCORD_BOT_TOKEN' '')" "$ENV_FILE"
fi

COMPOSE="-f docker-compose.yml"
if confirm "Habilitar o painel admin de atualização (/admin)? (requer socket do Docker)"; then
    set_env ADMIN_UI on "$ENV_FILE"
    set_env HOST_REPO_DIR "$DIR" "$ENV_FILE"
    COMPOSE="-f docker-compose.yml -f docker-compose.admin.yml"
    warn "Painel admin dá acesso ao Docker do host — mantenha atrás de rede privada."
fi

if confirm "Instalar o Tailscale para acesso privado ao servidor?"; then
    curl -fsSL https://tailscale.com/install.sh | $SUDO sh
    $SUDO tailscale up || warn "Rode 'sudo tailscale up' manualmente para autenticar."
    ok "Tailscale instalado"
fi

# --- 4. Subir ---
info "Subindo os containers…"
cd "$DIR/server"
# shellcheck disable=SC2086
$SUDO docker compose $COMPOSE up -d --build

TKP=$(grep '^TOKEN_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2); TKP="${TKP:-8080}"
LKP=$(grep '^LIVEKIT_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2); LKP="${LKP:-7880}"

printf '\n'
ok "Servidor no ar."
info "LiveKit (signaling): ws://<host>:$LKP"
info "token-service:       http://<host>:$TKP  (/health)"
grep -q '^ADMIN_UI=on' "$ENV_FILE" 2>/dev/null && info "Painel admin:        http://<host>:$TKP/admin"
info "Segredo p/ o plugin: veja ORG_SECRET em $ENV_FILE"
printf '\nUse HTTPS/WSS em produção (proxy TLS) e configure o TURN no livekit.yaml.\n'
