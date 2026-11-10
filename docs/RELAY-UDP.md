# Media UDP relay (VPS → home/office server)

The native Go Live media travels over **UDP** (`NATIVE_STREAM_UDP_PORT`, e.g. 7883).
A reverse proxy / HTTP tunnel **only carries HTTP/WS**, not UDP — so if the server
runs on a machine behind NAT, the media has to **enter through a public IP** and be
**forwarded over UDP** to it. That is the "relay": a VPS with a public IP receives the
UDP and forwards it to the home/office server.

```
Client ──UDP <port>──▶ VPS (public IP)  ──WireGuard/UDP──▶  Home server (media)
   ▲                    DNAT <port> → wg peer                 NATIVE_STREAM_UDP_PORT
   └── HTTP/WS (config, control WS /dstream) via reverse proxy / tunnel ──────────┘
```

On the server, set `NATIVE_STREAM_PUBLIC_IP` to the **VPS public IP** (the `install.sh`
writes this when you provide it) so the media advertises the VPS IP.

In the examples below, replace `<port>` with your `NATIVE_STREAM_UDP_PORT`.

## 1. WireGuard tunnel between VPS and home

On both the **VPS** and the **home server**, install WireGuard and bring up a simple
tunnel (e.g. VPS `10.8.0.1`, home `10.8.0.2`). Minimal example:

VPS `/etc/wireguard/wg0.conf`:
```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <VPS_PRIV>

[Peer]
PublicKey = <HOME_PUB>
AllowedIPs = 10.8.0.2/32
```

Home `/etc/wireguard/wg0.conf`:
```ini
[Interface]
Address = 10.8.0.2/24
PrivateKey = <HOME_PRIV>

[Peer]
PublicKey = <VPS_PUB>
Endpoint = <VPS_IP>:51820
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
```
```bash
sudo wg-quick up wg0     # on both sides
ping 10.8.0.2            # from the VPS, should reply
```

## 2. DNAT the media UDP on the VPS

On the **VPS**, forward the UDP received on the public interface to the home server over
WireGuard, and masquerade the return path:

```bash
# enable forwarding
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-forward.conf
sudo sysctl --system

# replace ens3 with your public interface and <port> with NATIVE_STREAM_UDP_PORT
sudo iptables -t nat -A PREROUTING -i ens3 -p udp --dport <port> -j DNAT --to-destination 10.8.0.2:<port>
sudo iptables -t nat -A POSTROUTING -o wg0 -p udp --dport <port> -d 10.8.0.2 -j MASQUERADE
sudo iptables -A FORWARD -p udp -d 10.8.0.2 --dport <port> -j ACCEPT
```
Persist the rules (e.g. `netfilter-persistent save` / `iptables-save`).

In your **VPS provider's** firewall/security list, **open inbound UDP `<port>`**. On the
home server, make sure the media listener exposes `<port>/udp` (the docker-compose does)
and the local firewall accepts it from `wg0`.

## 2b. UDP socket buffers (home server)

A 1080p keyframe arrives as a burst of hundreds of packets. With the ~208 KB Linux
default socket buffer, any event-loop hiccup overflows it → lost video packets → frozen
picture until the next keyframe. The server asks for `NATIVE_STREAM_UDP_BUFFER_KB`
(default 4096) but the kernel caps it at `net.core.rmem_max`/`wmem_max` (a host-wide
setting, not per container). Raise it on the **home server** (the one running Docker):

```bash
printf 'net.core.rmem_max=8388608\nnet.core.wmem_max=8388608\n' | sudo tee /etc/sysctl.d/99-frd-udp.conf
sudo sysctl --system
```
The boot log shows the effective size (`[dstream] UDP buffers: recv … KB`) and warns when
it was capped.

## 3. Verify

With an active stream, on the home server:
```bash
sudo tcpdump -ni any udp port <port>    # should see packets arriving from wg0
```
If the media does not flow but the control plane works, the problem is almost always
the UDP relay or the VPS firewall.

## Alternative without a relay

If the server runs **directly on a host with a public IP** (e.g. on the VPS itself), no
relay is needed: set `NATIVE_STREAM_PUBLIC_IP` to that host's public IP and open the
media UDP port in the firewall. The media travels on that host.
