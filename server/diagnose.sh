#!/usr/bin/env bash
# Diagnóstico do FRD GoLive: testa o servidor local, a config, as portas, o acesso
# público (Cloudflare) e o relay UDP — e no fim resume O QUE está com problema.
#
# Uso (no servidor de casa, dentro de server/):
#   ./diagnose.sh
#   ./diagnose.sh https://livekit-token.SEUDOMINIO.com wss://livekit.SEUDOMINIO.com
set -u

g() { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
r() { printf '\033[1;31m✗ %s\033[0m\n' "$1"; FAILS+=("$1"); }
w() { printf '\033[1;33m!\033[0m %s\n' "$1"; WARNS+=("$1"); }
sec() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
FAILS=(); WARNS=()

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; else w ".env não encontrado em $DIR"; fi

TOKEN_PORT="${TOKEN_PORT:-8080}"
LIVEKIT_PORT="${LIVEKIT_PORT:-7880}"
LIVEKIT_UDP_PORT="${LIVEKIT_UDP_PORT:-7882}"
FRP_PORT="${FRP_PORT:-7000}"
ORG1="${ORG_SECRET%%,*}"                       # primeiro segredo (lista por vírgula)
PUB_TOKEN="${1:-${PUBLIC_TOKEN_URL:-}}"
PUB_LK="${2:-${PUBLIC_LIVEKIT_URL:-}}"

stun() { # $1 host $2 port -> imprime RESP ou NORESP
    python3 - "$1" "$2" <<'PY' 2>/dev/null || echo NORESP
import socket, struct, sys, os
host, port = sys.argv[1], int(sys.argv[2])
msg = struct.pack('>HHI', 0x0001, 0x0000, 0x2112A442) + os.urandom(12)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3)
try:
    s.sendto(msg, (host, port)); s.recvfrom(2048); print("RESP")
except Exception:
    print("NORESP")
PY
}

sec "Containers Docker"
if have docker; then
    n="$(docker ps --format '{{.Names}}' 2>/dev/null)"
    echo "$n" | grep -q livekit && g "container livekit rodando" || r "container livekit NÃO está rodando"
    echo "$n" | grep -q token-service && g "container token-service rodando" || r "container token-service NÃO está rodando"
else
    w "docker ausente — pulei containers"
fi

sec "token-service (local)"
if have curl; then
    if curl -fsS "http://localhost:$TOKEN_PORT/health" -o /tmp/frd_h 2>/dev/null; then
        g "/health OK: $(cat /tmp/frd_h)"
    else
        r "/health não respondeu em localhost:$TOKEN_PORT (token-service caído?)"
    fi
    c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$TOKEN_PORT/token" \
        -H 'Content-Type: application/json' \
        -d "{\"room\":\"diag\",\"identity\":\"diag\",\"orgSecret\":\"$ORG1\"}")
    if [ "$c" = "200" ]; then
        g "emissão de token OK (segredo correto)"
    elif [ "$c" = "403" ] && [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
        w "token deu 403 — provável verificação de presença (bot ligado), não o segredo"
    else
        r "emissão de token falhou (HTTP $c) — cheque ORG_SECRET"
    fi
    c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$TOKEN_PORT/token" \
        -H 'Content-Type: application/json' -d '{"room":"d","identity":"d","orgSecret":"errado__"}')
    [ "$c" = "403" ] && g "segredo errado rejeitado (403)" || w "segredo errado retornou $c (esperado 403)"
else
    w "curl ausente — pulei token-service"
fi

sec "LiveKit (config e portas)"
LKY="$DIR/livekit.yaml"
if [ -f "$LKY" ]; then
    grep -qE '^[[:space:]]*node_ip:[[:space:]]*[0-9]' "$LKY" \
        && g "node_ip: $(grep -E '^[[:space:]]*node_ip:' "$LKY" | tr -d ' ')" \
        || w "node_ip NÃO definido no livekit.yaml (mídia por IP público não vai funcionar)"
    grep -qE '^[[:space:]]*use_external_ip:[[:space:]]*false' "$LKY" \
        && g "use_external_ip: false" || w "use_external_ip não está false (pode anunciar IP errado)"
    grep -qE "^[[:space:]]*udp_port:[[:space:]]*$LIVEKIT_UDP_PORT" "$LKY" \
        && g "udp_port: $LIVEKIT_UDP_PORT" || w "udp_port != $LIVEKIT_UDP_PORT no livekit.yaml"
    grep -qE '^[[:space:]]*port_range_start:' "$LKY" \
        && r "livekit.yaml ainda tem port_range_start ATIVO (estoura RAM!) — troque por udp_port"
else
    w "livekit.yaml não encontrado"
fi
if have ss; then
    ss -lun 2>/dev/null | grep -q ":$LIVEKIT_UDP_PORT" \
        && g "UDP $LIVEKIT_UDP_PORT escutando localmente" \
        || r "nada escutando na UDP $LIVEKIT_UDP_PORT (LiveKit caído?)"
elif have netstat; then
    netstat -lun 2>/dev/null | grep -q ":$LIVEKIT_UDP_PORT" \
        && g "UDP $LIVEKIT_UDP_PORT escutando" || r "UDP $LIVEKIT_UDP_PORT não escutando"
else
    w "ss/netstat ausentes — pulei UDP local"
fi

sec "Relay UDP / frp (opcional — ignore se você usa WireGuard/fw-manager)"
have pgrep && { pgrep -f frpc >/dev/null 2>&1 && g "frpc rodando (cliente do relay)" || w "frpc não roda aqui (ok se o relay é WireGuard/fw-manager)"; }
if [ -n "${LIVEKIT_NODE_IP:-}" ] && have nc; then
    nc -z -w3 "$LIVEKIT_NODE_IP" "$FRP_PORT" 2>/dev/null \
        && g "controle frp $LIVEKIT_NODE_IP:$FRP_PORT alcançável" \
        || w "não alcancei $LIVEKIT_NODE_IP:$FRP_PORT (frps rodando? firewall do VPS?)"
fi

sec "Acesso público (Cloudflare)"
if [ -n "$PUB_TOKEN" ] && have curl; then
    curl -fsS "$PUB_TOKEN/health" -o /tmp/frd_p 2>/dev/null \
        && g "token público OK: $PUB_TOKEN → $(cat /tmp/frd_p)" \
        || r "token público inacessível: $PUB_TOKEN/health (rota Cloudflare?)"
else
    w "domínio do token não informado (1º argumento) — pulei público"
fi
if [ -n "$PUB_LK" ] && have curl; then
    https="${PUB_LK/wss:/https:}"; https="${https/ws:/http:}"
    curl -fsS -o /dev/null "$https/" 2>/dev/null \
        && g "LiveKit público alcançável: $https" \
        || w "LiveKit público não respondeu a GET (normal p/ WS puro) — confira a rota no Cloudflare"
fi

sec "Relay UDP fim-a-fim (best-effort STUN)"
if have python3 && [ -n "${LIVEKIT_NODE_IP:-}" ]; then
    loc=$(stun 127.0.0.1 "$LIVEKIT_UDP_PORT")
    pub=$(stun "$LIVEKIT_NODE_IP" "$LIVEKIT_UDP_PORT")
    if [ "$loc" = "RESP" ] && [ "$pub" = "RESP" ]; then
        g "STUN respondeu local e via $LIVEKIT_NODE_IP — caminho de mídia OK"
    elif [ "$loc" = "RESP" ] && [ "$pub" = "NORESP" ]; then
        r "LiveKit responde local mas NÃO via $LIVEKIT_NODE_IP:$LIVEKIT_UDP_PORT — o relay UDP (frp/firewall) está quebrado"
    else
        w "STUN inconclusivo (LiveKit pode não responder STUN sem credencial). Se a tela ficar preta, o problema é o relay/firewall UDP em $LIVEKIT_NODE_IP:$LIVEKIT_UDP_PORT"
    fi
else
    w "python3 ausente — pulei o teste STUN do relay"
fi

sec "Resumo"
if [ "${#FAILS[@]}" -eq 0 ]; then
    printf '\033[1;32mNenhuma falha crítica detectada.\033[0m\n'
else
    printf '\033[1;31mProblemas encontrados:\033[0m\n'
    for f in "${FAILS[@]}"; do echo "  - $f"; done
fi
if [ "${#WARNS[@]}" -gt 0 ]; then
    printf '\033[1;33mAvisos (verifique se algo não bater):\033[0m\n'
    for x in "${WARNS[@]}"; do echo "  - $x"; done
fi
