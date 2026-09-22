#!/usr/bin/env sh
# Gera um server/.env com segredos aleatórios seguros para o servidor v2 (mesh).
#
# Uso:
#   ./gen-env.sh            # cria .env (recusa se já existir)
#   ./gen-env.sh --force    # sobrescreve um .env existente
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
FORCE="${1:-}"

if [ -f "$ENV_FILE" ] && [ "$FORCE" != "--force" ]; then
    printf 'Erro: %s já existe. Use "%s --force" para sobrescrever.\n' "$ENV_FILE" "$0" >&2
    exit 1
fi

# Gera N bytes aleatórios em hex. Usa openssl quando disponível; senão, /dev/urandom.
rand_hex() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$1"
    else
        head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

# Segredos: protegem os endpoints /admin/* e assinam o cookie de sessão do hub.
ADMIN_TOKEN="$(rand_hex 24)"
SESSION_SECRET="$(rand_hex 32)"
# Chaves do LiveKit (SFU) — o servidor assina os tokens com elas.
LIVEKIT_API_KEY="API$(rand_hex 6)"
LIVEKIT_API_SECRET="$(rand_hex 32)"

# Cria o arquivo já com permissões restritas (contém segredos).
umask 077
cat > "$ENV_FILE" <<EOF
# Gerado por gen-env.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). NÃO versione este arquivo.

PORT=8090

# Protege os endpoints /admin/* (header X-Admin-Token). Gerado aleatoriamente.
ADMIN_TOKEN=$ADMIN_TOKEN

# URL pública do signaling (atrás do Cloudflare). Vazio = deriva do host da requisição
# (recomendado: com HTTPS vira wss://SEU_HOST/signaling automaticamente).
PUBLIC_SIGNALING_URL=

# ICE: STUN público basta para NAT amigável. TURN só para NAT simétrico/corporativo.
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=

# Quotas padrão para novos usuários (o admin ajusta por usuário no painel).
DEFAULT_MAX_HEIGHT=1080
DEFAULT_MAX_FPS=30

DB_FILE=/app/data/users.json
VERSION=2.0.0

# --- SFU (LiveKit) — a mídia (vídeo) passa por aqui ---
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
# URL WS do LiveKit que o CLIENTE usa (signaling do LiveKit). Ex.: wss://media.SEU.com
# ou ws://SEU_IP:7880. É o que o /config devolve como serverUrl.
LIVEKIT_WS_URL=
# IP PÚBLICO por onde a MÍDIA (UDP 7882) entra — ex.: o VPS que faz o relay.
# O install.sh grava isto no livekit.yaml (node_ip) e desliga a autodetecção.
LIVEKIT_NODE_IP=
# Portas do LiveKit (mapeadas pelo docker-compose).
LIVEKIT_PORT=7880
LIVEKIT_TCP_PORT=7881
LIVEKIT_UDP_PORT=7882
# Validade do token de sala.
TOKEN_TTL=10m

# --- Hub web (login Discord + painel admin) ---
# Crie um app em https://discord.com/developers/applications (veja docs/DISCORD-OAUTH.md).
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://golivefrd.SEU.com/auth/callback
# Assina o cookie de sessão. Gerado aleatoriamente.
SESSION_SECRET=$SESSION_SECRET
# IDs (Discord) dos admins, separados por vírgula — acessam /admin pelo login.
ADMIN_DISCORD_IDS=
EOF
chmod 600 "$ENV_FILE"

printf 'OK: %s gerado com segredos aleatórios (permissões 600).\n' "$ENV_FILE"
printf 'Para o login do hub/admin, preencha DISCORD_CLIENT_ID/SECRET e ADMIN_DISCORD_IDS.\n'
printf 'Passo a passo do OAuth: docs/DISCORD-OAUTH.md\n'
