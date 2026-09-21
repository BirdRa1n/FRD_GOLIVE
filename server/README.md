# Servidor FRD GoLive (self-host)

Servidor privado que roteia os streams de tela/câmera **fora do Discord**. Três peças
num único `docker compose`:

- **LiveKit** (SFU) — roteia as tracks de vídeo/áudio entre participantes.
- **token-service** — emite tokens JWT do LiveKit validando o `ORG_SECRET`.
- **TURN** — embutido no LiveKit (habilitável), para NAT corporativo.

## Subindo (dev)

Pré-requisitos: Docker + Docker Compose.

```bash
cp .env.example .env     # edite e troque TODOS os segredos
docker compose up --build
```

Endpoints:

- LiveKit (signaling): `ws://localhost:7880`
- token-service: `http://localhost:8080`
  - `GET  /health` → `{"ok":true}`
  - `POST /token`  → `{"token":"<jwt>"}`

Teste de emissão de token:

```bash
curl -s http://localhost:8080/token \
  -H 'Content-Type: application/json' \
  -d '{"room":"canal-123","identity":"alice","orgSecret":"SEU_ORG_SECRET"}'
```

Para validar publish/subscribe de verdade antes do plugin existir, use o
[LiveKit Playground](https://agents-playground.livekit.io/) apontando para o seu
LiveKit local com um token emitido acima.

## Contrato do token-service

`POST /token`

```jsonc
// requisição
{
  "room": "<id do canal de voz do Discord>",
  "identity": "<id único do usuário>",
  "orgSecret": "<segredo da organização>",
  "name": "<opcional: nome de exibição>"
}
// resposta 200
{ "token": "<jwt do livekit>" }
```

Erros: `400` (room/identity ausentes), `403` (orgSecret inválido).

## Produção

1. **Domínio + TLS.** WebRTC exige `wss`. Aponte um domínio (ex.:
   `media.suaempresa.com`) para o servidor e coloque um proxy TLS (Caddy/Traefik)
   à frente do LiveKit (7880) e do token-service (8080), OU forneça certificados
   diretamente ao LiveKit.
2. **Habilite o TURN** no `livekit.yaml` (`turn.enabled: true`, `domain`, cert) e
   abra a porta no compose/firewall. Sem TURN, redes corporativas restritivas
   falham na conexão de mídia.
3. **Firewall:** libere 7880 (ws), 7881 (tcp), 50000-60000/udp e a porta do TURN.
4. **Segredos fortes:** `LIVEKIT_API_SECRET` e `ORG_SECRET` via `openssl rand`.
5. **Rotação do `ORG_SECRET`** quando alguém sai da organização (é a credencial
   de acesso do MVP).

### Alternativa: coturn separado

Se preferir um TURN dedicado em vez do embutido, rode um `coturn` ao lado e
configure o LiveKit para anunciá-lo. Fica de fora do MVP para reduzir peças móveis.

## Segurança (MVP)

- Acesso é controlado pelo `ORG_SECRET`. Quem tem o segredo + o ID do canal entra
  na sala. Trate o segredo como credencial.
- **Fase 5 (roadmap):** bot do Discord valida se a `identity` está mesmo no canal
  de voz antes do token-service emitir o JWT — fecha o furo do "sabe o ID + secret".
