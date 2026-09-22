#!/usr/bin/env sh
# Gera um server/.env com segredos aleatórios seguros.
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

LIVEKIT_API_KEY="API$(rand_hex 6)"
LIVEKIT_API_SECRET="$(rand_hex 32)"
ORG_SECRET="$(rand_hex 24)"

# Cria o arquivo já com permissões restritas (contém segredos).
umask 077
cat > "$ENV_FILE" <<EOF
# Gerado por gen-env.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). NÃO versione este arquivo.

LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
ORG_SECRET=$ORG_SECRET
TOKEN_TTL=10m

# Portas (opcional).
LIVEKIT_PORT=7880
LIVEKIT_TCP_PORT=7881
TOKEN_PORT=8080

# Verificação de presença via bot (Fase 5) — opcional. Preencha para ativar.
DISCORD_BOT_TOKEN=
PRESENCE_ENFORCEMENT=strict

# Atualização do código / painel admin.
UPDATE_REPO=https://github.com/BirdRa1n/FRD_GOLIVE
UPDATE_BRANCH=main
ADMIN_UI=off
HOST_REPO_DIR=
EOF
chmod 600 "$ENV_FILE"

printf 'OK: %s gerado com segredos aleatórios (permissões 600).\n' "$ENV_FILE"
printf 'Distribua o ORG_SECRET aos usuários por um canal seguro.\n'
