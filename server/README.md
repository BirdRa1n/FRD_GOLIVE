# Servidor FRD GoLive (self-host)

Servidor privado que roteia os streams de tela/câmera **fora do Discord**. Três peças
num único `docker compose`:

- **LiveKit** (SFU) — roteia as tracks de vídeo/áudio entre participantes.
- **token-service** — emite tokens JWT do LiveKit validando o `ORG_SECRET`.
- **TURN** — embutido no LiveKit (habilitável), para NAT corporativo.

## Instalação em 1 comando (recomendado)

No servidor, rode:

```bash
curl -fsSL https://raw.githubusercontent.com/BirdRa1n/FRD_GOLIVE/main/server/install.sh | sh
```

O instalador (estilo Tailscale) verifica `git`/`docker`/`docker compose` (e oferece
instalar o Docker via `get.docker.com`), clona o repositório e pergunta, de forma
interativa, se você quer:

- gerar o `.env` com segredos aleatórios;
- customizar **portas** (`LIVEKIT_PORT`, `TOKEN_PORT`);
- customizar o **repositório de updates** (`UPDATE_REPO`/`UPDATE_BRANCH`);
- configurar o **bot de presença** (`DISCORD_BOT_TOKEN`);
- habilitar o **painel admin** (`/admin`);
- instalar o **Tailscale** para acesso privado.

Ao final ele sobe tudo com `docker compose up -d --build`.

## Subindo (dev / manual)

Pré-requisitos: Docker + Docker Compose.

```bash
./gen-env.sh             # gera .env com segredos aleatórios (ou: cp .env.example .env)
docker compose up --build
```

`gen-env.sh` cria o `.env` com `LIVEKIT_API_SECRET`/`ORG_SECRET` aleatórios e
permissões `600`. Recusa sobrescrever um `.env` existente (use `--force`). Depois,
se for usar o bot de presença, preencha `DISCORD_BOT_TOKEN`.

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

## Atualização do código (painel admin)

Painel opcional em `/admin` que mostra a versão atual vs. a do repositório e tem um
botão **"Atualizar servidor"** — que puxa o código de `UPDATE_REPO`/`UPDATE_BRANCH`
e reconstrói os containers (via um container *updater* independente).

```bash
# habilita o painel (monta o socket do Docker e o repo)
HOST_REPO_DIR=$(pwd)/.. \
docker compose -f docker-compose.yml -f docker-compose.admin.yml up -d --build
```

- Requer `ADMIN_UI=on` e `HOST_REPO_DIR` (caminho absoluto do repo no host).
- `UPDATE_REPO` no `.env` permite apontar para um **fork/mirror** próprio.
- A ação de atualizar é protegida pelo `ORG_SECRET`.

> ⚠️ **Segurança:** o painel monta o socket do Docker no token-service, o que
> equivale a root no host. Exponha **somente** por rede privada (ex.: Tailscale),
> nunca na internet pública.

## Segurança

- Acesso base é o `ORG_SECRET`. **Rotação sem downtime:** informe uma lista
  separada por vírgula (`"antigo,novo"`) enquanto os usuários migram, depois
  remova o antigo.
- **Auditoria:** cada emissão/negação vira uma linha JSON no stdout
  (`{"ts","event":"token","room","identity","result","reason","presence"}`) —
  colete via logs do Docker. Contém IDs de usuário/canal do Discord.

### Verificação de presença via bot (Fase 5)

Fecha o furo do "sabe o ID + segredo": o token só é emitido se o usuário estiver
**mesmo** conectado ao canal de voz (`room`).

1. Crie uma aplicação em https://discord.com/developers/applications → **Bot**.
2. Ative o **Server Members**? Não é preciso; ative apenas o intent de gateway
   **Voice States** (o código usa `Guilds` + `GuildVoiceStates`).
3. Convide o bot para o(s) servidor(es) da empresa (escopo `bot`, sem permissões
   especiais necessárias além de ver os canais).
4. Ponha o token em `DISCORD_BOT_TOKEN` no `.env` e escolha `PRESENCE_ENFORCEMENT`:
   - `strict` (padrão): exige presença confirmada; nega quando não dá pra verificar.
   - `lenient`: nega só quando o usuário comprovadamente não está no canal.
   - `off`: ignora (modo só-segredo).

**Limitação:** o bot só enxerga **canais de voz de servidores** onde ele está.
Chamadas em **DM/grupo** não são verificáveis → em `strict` são negadas; use
`lenient` se precisar suportá-las (aí caem no controle só-segredo).

> Observação: a checagem confirma que o *userId informado* está no canal, mas não
> prova criptograficamente que quem pediu é aquele usuário. Prova forte de
> identidade exigiria OAuth2 do Discord (evolução futura).
