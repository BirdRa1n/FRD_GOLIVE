# Roadmap v2

Fases incrementais. Cada uma entrega algo testável e não quebra a v1 (SFU) até a
migração estar pronta.

## Fase A — Transporte P2P/mesh (fundação)
- [ ] Interface `RtcTransport` no plugin (abstrai `mesh` | `sfu`).
- [ ] **Signaling server** mínimo (Node + `ws`): salas por channelId, repasse de
      offer/answer/ICE, atrás do Cloudflare (HTTP/WS).
- [ ] Cliente de signaling no plugin.
- [ ] Mesh: `RTCPeerConnection` por peer; publicar tela/câmera; assinar remotos.
- [ ] ICE: STUN público por padrão; TURN opcional via config.
- **Teste:** 2–3 clientes, só com Cloudflare (sem VPS), veem a transmissão em NAT
  amigável. Documentar o caso de NAT simétrico (precisa TURN).

## Fase B — Auth + quotas + config endpoint
- [ ] DB (SQLite) de usuários, quotas, flags de habilitação.
- [ ] Login/registro; admin habilita usuários; quota de resolução/FPS por usuário.
- [ ] `GET /config` retorna signaling URL, ICE servers, políticas, versão.
- [ ] Signaling valida habilitação + aplica quota ao montar a sala.
- [ ] Plugin aplica a quota recebida (limita maxHeight/fps).
- **Teste:** usuário não habilitado é barrado; quota limita a qualidade.

## Fase C — Hub web (golivefrd.birdra1n.com)
- [ ] App web (Next.js) com auth.
- [ ] Fluxo "solicitar acesso" → admin aprova.
- [ ] Push de "habilitado" pelo WS → plugin liga funções + avisa no Discord.
- [ ] Painel admin: usuários, quotas, **transmissões ativas**.
- [ ] Dashboard: CPU, memória, rede, salas/peers (métricas do servidor).
- **Teste:** habilitar no hub reflete no Discord em segundos; dash mostra a call ativa.

## Fase D — Instalador Electron (Mac + Windows)
- [ ] App Electron: detecta Discord/Vencord, aplica a modificação (build + inject).
- [ ] Opção "servidor birdra1n" vs "próprio"; ao inserir host, puxa `GET /config`.
- [ ] Aplica CSP do domínio automaticamente; grava config do plugin.
- [ ] Botão "Abrir navegador" → hub.
- [ ] Empacotar/assinar para macOS (.dmg/.pkg) e Windows (.exe/NSIS).
- **Teste:** do zero ao Discord modificado sem terminal, nos dois SOs.

## Fase E — Observabilidade + polimento
- [ ] Reporte de estado (transmitindo/assistindo) do plugin ao servidor.
- [ ] Histórico de sessões; alertas de quota; logs de auditoria.
- [ ] Modo `sfu` opcional para grupos grandes (reusa a v1/LiveKit).

## Ordem sugerida
A → B → C → D → E. A Fase A é a que remove o VPS (o pedido nº 1) e destrava o
resto. As fases C/D dependem de A/B (config + auth).

## Fora de escopo (por ora)
- Gravação de sessões.
- Reencode server-side (é P2P; sem SFU não há transcode central).
- SFU escalável gerenciado (fica como modo opcional, não default).
