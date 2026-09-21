# Arquitetura

## 1. Premissa e limites técnicos (leia primeiro)

| O que **queremos** | O que é **viável** |
|---|---|
| "Sequestrar" o Go Live nativo e mandar pro nosso servidor | ❌ Inviável. SFU do Discord é proprietário/criptografado. Reimplementar é gigante e quebra a cada update. |
| Vídeo de tela/câmera fora do Discord | ✅ Pipeline paralelo: captura padrão do navegador → nosso SFU (LiveKit). |
| Ver a transmissão dentro do Discord | ⚠️ Em **painel próprio do plugin** (PiP/janela), não no tile nativo. |
| Voz pelo Discord | ✅ Fica intacta, sem tocar nela. |
| Áudio do sistema audível pros membros | ✅ Fácil no nosso pipeline (`getDisplayMedia({ audio: true })`). |
| Descobrir quem está na call | ✅ Via stores do Discord (VoiceState) → nome da sala = ID do canal de voz. |

**Regra de ouro:** não fazemos engenharia reversa do protocolo de mídia do Discord.
Só usamos APIs padrão de captura (`getDisplayMedia`/`getUserMedia`) e um servidor
WebRTC próprio. Isso mantém o projeto legal do ponto de vista de reversing e
estável frente a updates do Discord.

## 2. Componentes

### 2.1 Cliente — userplugin do Vencord (`client/`)

Um plugin de usuário do Vencord (compilado junto ao Vencord, em `src/userplugins/`).

Módulos:

- **`settings`** — aba de configurações do plugin (via API de settings do Vencord):
  - `serverUrl` — URL do LiveKit privado (ex.: `wss://media.minhaempresa.com`).
  - `tokenServiceUrl` — URL do serviço de token (ex.: `https://media.minhaempresa.com/token`).
  - `orgSecret` — segredo compartilhado da organização.
  - `includeSystemAudio` — incluir áudio do sistema no stream (default: on).
  - `video` — resolução alvo, FPS, bitrate máx.
  - `autoPublishOnGoLive` — ao clicar em compartilhar no Discord, publicar no privado.
- **`discordState`** — lê stores do Discord (Webpack) para saber contexto:
  - `SelectedChannelStore` / `VoiceStateStore` → canal de voz atual + participantes.
  - `UserStore` → identidade do usuário local (nome de exibição na sala).
- **`rtcSession`** — orquestra a conexão LiveKit (`livekit-client`):
  - Ao entrar numa call de voz: pega token do `token-service` (room = channelId),
    conecta na sala, e passa a **assinar** publicações de outros participantes.
  - Ao compartilhar: captura mídia e **publica** track(s) na sala.
- **`capture`** — `getDisplayMedia`/`getUserMedia` com as constraints das settings.
- **`ui`**:
  - **`PrivateStreamPanel`** — lista de streams ativos na call + player de vídeo
    (elemento `<video>` recebendo o `MediaStream` remoto). Renderizado como
    painel/modal/PiP injetado pelo plugin.
  - **Botão/indicador** próprio (ex.: "Compartilhar (privado)") na barra da call.
- **`patches`** — patches Webpack mínimos para injetar o botão e o painel na UI da
  call. Evitamos patches invasivos no motor de mídia do Discord.

> **Referência útil:** os plugins `philsPluginLibrary` / `betterScreenshare`
> mostram como acessar as constraints de captura e o motor de mídia no Vencord —
> boa fonte para a parte de `capture`, ainda que nosso transporte seja separado.

### 2.2 Servidor — auto-hospedado (`server/`)

`docker-compose.yml` sobe três serviços:

1. **LiveKit server** (SFU) — roteia as tracks entre participantes da sala.
   Config em `livekit.yaml` (chaves de API, portas, TURN embutido opcional).
2. **token-service** (Node/Express, pequeno) — emite **JWT do LiveKit**:
   - Recebe `{ room, identity, orgSecret }`.
   - Valida `orgSecret` contra o segredo configurado no servidor.
   - Se ok, assina um AccessToken LiveKit com grants para aquela `room`.
   - MVP: sem depender do Discord (ver Fase 2 para validação via bot).
3. **coturn** (TURN/STUN) — essencial em redes corporativas com NAT restritivo.

TLS via reverse proxy (Caddy/Traefik) — WebRTC/`wss` exige HTTPS.

## 3. Fluxo de dados

### Entrar na call
1. Plugin detecta entrada no canal de voz `C` (VoiceStateStore).
2. `POST token-service {room: C, identity: user, orgSecret}` → JWT.
3. `livekit-client` conecta em `serverUrl` com o JWT → entra na sala `C`.
4. Passa a receber eventos de `TrackPublished` de outros participantes.

### Compartilhar tela/câmera
1. Usuário clica em "Compartilhar (privado)".
2. `getDisplayMedia({video: constraints, audio: includeSystemAudio})`.
3. `room.localParticipant.publishTrack(...)` para cada track.
4. Outros participantes recebem `TrackSubscribed` → `PrivateStreamPanel` mostra.

### Assistir
1. Evento `TrackSubscribed` entrega um `MediaStreamTrack`.
2. Plugin monta um `MediaStream` e atribui a um `<video>` no painel.
3. Áudio do sistema (se presente) toca junto — membros se ouvem.

### Voz
- Nada muda. Segue pelo Discord nativo, em paralelo.

## 4. Segurança e privacidade

- **Sala = ID do canal de voz.** Qualquer um que saiba o ID + tenha o `orgSecret`
  pode entrar. Por isso o `orgSecret` é o controle de acesso no MVP — deve ser
  tratado como credencial (não commitar, distribuir via canal seguro da empresa).
- **Presença (implementado):** um bot do Discord (opcional) valida se a `identity`
  está mesmo no canal de voz `C` antes do token-service emitir o JWT — fecha o furo
  do "sabe o ID + secret". Modos `strict`/`lenient`/`off`. Ver `server/README.md`.
- **Rotação:** o `ORG_SECRET` aceita lista separada por vírgula para troca sem
  downtime; emissões/negações são auditadas em JSON no token-service.
- Todo tráfego em `wss`/DTLS-SRTP (padrão WebRTC) + TLS no token-service.
- Sem gravação por padrão. Se adicionada, deve ser opt-in e auditável.

## 5. Decisões registradas

- **Transporte:** LiveKit SFU (auto-hospedado). Menos código, escala pra grupos,
  SDK JS maduro. (Alternativas descartadas no MVP: mesh P2P — não escala;
  mediasoup — muito código.)
- **Auth MVP:** segredo de organização compartilhado. (Bot de validação → Fase 2.)
- **Exibição:** painel próprio do plugin, não o tile nativo do Discord.
- **Voz:** permanece no Discord, intocada.

## 6. Riscos conhecidos

- Patches Webpack do Vencord podem quebrar em updates do Discord — manter mínimos.
- NAT corporativo: sem TURN bem configurado, conexões falham. coturn é obrigatório.
- Todos os participantes precisam do plugin + mesma config. Sem isso, não veem nada.
- Uso de client mod é contra o ToS do Discord (risco do usuário).
