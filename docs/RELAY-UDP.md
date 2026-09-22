# Relay UDP da mídia (VPS → servidor de casa)

O SFU (LiveKit) transporta a **mídia por UDP** (porta única mux **7882**). O
Cloudflare Tunnel **só leva HTTP/WS**, não UDP — então, se o LiveKit roda num
servidor de casa (atrás de NAT), a mídia precisa **entrar por um IP público** e ser
**encaminhada por UDP** até ele. Isso é o "relay": um VPS com IP público recebe o
UDP 7882 e repassa para o servidor de casa.

```
Cliente ──UDP 7882──▶ VPS (IP público)  ──WireGuard/UDP──▶  Servidor de casa (LiveKit)
   ▲                   DNAT 7882 → wg peer                     udp_port: 7882
   └── HTTP/WS (config, token, LiveKit WS) via Cloudflare Tunnel ──────────────┘
```

No servidor: `livekit.yaml` com `use_external_ip: false` e `node_ip: <IP do VPS>`
(o `install.sh` grava isto quando você informa o IP público da mídia). Assim o
LiveKit anuncia o IP do VPS nos candidatos ICE.

## 1. Túnel WireGuard entre VPS e casa

No **VPS** e no **servidor de casa**, instale o WireGuard e suba um túnel simples
(ex.: VPS `10.8.0.1`, casa `10.8.0.2`). Exemplo mínimo:

VPS `/etc/wireguard/wg0.conf`:
```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <VPS_PRIV>

[Peer]
PublicKey = <CASA_PUB>
AllowedIPs = 10.8.0.2/32
```

Casa `/etc/wireguard/wg0.conf`:
```ini
[Interface]
Address = 10.8.0.2/24
PrivateKey = <CASA_PRIV>

[Peer]
PublicKey = <VPS_PUB>
Endpoint = <VPS_IP>:51820
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
```
```bash
sudo wg-quick up wg0     # nos dois lados
ping 10.8.0.2            # do VPS, deve responder
```

## 2. DNAT do UDP 7882 no VPS

No **VPS**, encaminhe o UDP 7882 recebido na interface pública para o servidor de
casa via WireGuard, e mascare o retorno:

```bash
# habilite o forwarding
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-forward.conf
sudo sysctl --system

# troque ens3 pela sua interface pública
sudo iptables -t nat -A PREROUTING -i ens3 -p udp --dport 7882 -j DNAT --to-destination 10.8.0.2:7882
sudo iptables -t nat -A POSTROUTING -o wg0 -p udp --dport 7882 -d 10.8.0.2 -j MASQUERADE
sudo iptables -A FORWARD -p udp -d 10.8.0.2 --dport 7882 -j ACCEPT
```
Persista as regras (ex.: `netfilter-persistent save` / `iptables-save`).

No **provedor do VPS** (ex.: Oracle Security List / firewall), **libere o UDP 7882**
de entrada. No servidor de casa, garanta que o LiveKit expõe `7882/udp` (o
docker-compose já faz) e que o firewall local aceita do `wg0`.

## 3. Verificar

Com uma transmissão ativa, no servidor de casa:
```bash
sudo tcpdump -ni any udp port 7882    # deve ver pacotes chegando do wg0
```
No cliente, os candidatos ICE devem mostrar o IP do VPS. Se a mídia não fluir mas o
controle/token funcionam, o problema está quase sempre no relay UDP ou no firewall
do VPS.

## Alternativa sem relay

Se o LiveKit rodar **direto num host com IP público** (ex.: no próprio VPS), não
precisa de relay: deixe `use_external_ip: true` (ou `node_ip` = o IP público do host)
e abra o UDP 7882 no firewall. A mídia trafega nesse host.
