# Roadmap

Marcos incrementais — cada fase é utilizável/testável antes de seguir.

## Fase 0 — Fundação do repositório
- [ ] Trocar `.gitignore` (de OCaml) para Node/TypeScript.
- [ ] Estrutura de pastas: `client/`, `server/`, `docs/`.
- [ ] `CONTRIBUTING.md` + notas de setup de dev do Vencord.

## Fase 1 — Servidor mínimo (self-host)
- [ ] `server/docker-compose.yml`: LiveKit + coturn + token-service.
- [ ] `server/livekit.yaml` de exemplo.
- [ ] `token-service`: `POST /token {room, identity, orgSecret}` → JWT LiveKit.
- [ ] Validação do `orgSecret`. Variáveis via `.env`.
- [ ] Documento de deploy (TLS via Caddy, portas, firewall).
- **Teste:** publicar/assinar uma track com o app de exemplo do LiveKit.

## Fase 2 — Plugin: conexão e assinatura ✅
- [x] Esqueleto do userplugin (`definePlugin`, settings).
- [x] Aba de settings: `serverUrl`, `tokenServiceUrl`, `orgSecret`, opções de vídeo.
- [x] `discordState`: detectar canal de voz atual.
- [x] `rtcSession`: conectar ao LiveKit com room = channelId; assinar tracks.
- [x] `PrivateStreamPanel`: renderizar `<video>` de streams remotos.
- **Teste:** dois clientes na mesma call veem stream publicado manualmente.
  _(pendente: rodar dentro do Vencord + servidor no ambiente do dev)_

## Fase 3 — Plugin: captura e publicação (parcial — já adiantado na Fase 2)
- [x] Botão "Compartilhar tela" no painel.
- [x] `capture`: `createLocalScreenTracks` com resolução/fps das settings.
- [x] Publicar tracks; incluir áudio do sistema (opção `includeSystemAudio`).
- [x] Parar de transmitir (`stopSharing`).
- [ ] Botão de câmera na UI (lógica `startCameraShare` já existe).
- [ ] Trocar fonte/janela; indicador visual de "transmitindo".
- **Teste:** A compartilha tela+áudio; B vê e ouve; voz do Discord segue normal.

## Fase 4 — Robustez
- [ ] Reconexão, tratamento de saída/entrada de participantes.
- [ ] Simulcast/qualidade adaptativa (LiveKit).
- [ ] Múltiplos publicadores simultâneos no painel.
- [ ] Mensagens de erro claras (servidor offline, secret errado, TURN falhando).

## Fase 5 — Segurança avançada (opcional)
- [ ] Bot Discord que valida presença no canal de voz antes de emitir token.
- [ ] Rotação de segredo / tokens curtos.
- [ ] Logs de auditoria no token-service.

## Fase 6 — Distribuição
- [ ] Guia de build do Vencord com o plugin em `src/userplugins/`.
- [ ] Guia de self-host "1 comando" (docker compose up).
- [ ] Documentação de troubleshooting de rede corporativa.

## Fora de escopo (por ora)
- Substituir o tile nativo do Go Live do Discord.
- Gravação de sessões.
- Clientes sem o plugin.
