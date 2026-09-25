# Criar o login do Discord (OAuth2) para o hub/admin

O hub web (`golivefrd.SEU.com`) usa **login do Discord** para identificar quem pede
acesso e para proteger o painel `/admin`. Ele usa só o escopo `identify` (nome + id,
sem e‑mail, sem permissões no seu servidor). Este guia cria o app e preenche o `.env`.

## 1. Criar o aplicativo

1. Acesse **https://discord.com/developers/applications** e clique em **New Application**.
2. Dê um nome (ex.: `FRD GoLive`) e crie.
3. No menu lateral, vá em **OAuth2**.

## 2. Client ID e Client Secret

- Em **OAuth2 → General**, copie o **Client ID**.
- Clique em **Reset Secret** para gerar o **Client Secret** e copie (aparece uma vez).

Esses dois valores viram no `.env`:

```
DISCORD_CLIENT_ID=<Client ID>
DISCORD_CLIENT_SECRET=<Client Secret>
```

## 3. Redirect URI (obrigatório e exato)

Em **OAuth2 → General → Redirects**, clique **Add Redirect** e cadastre **exatamente**
a URL de callback do seu host (com `https://` e sem barra no final):

```
https://golivefrd.SEU.com/auth/callback
```

Salve. O mesmo valor vai no `.env`:

```
DISCORD_REDIRECT_URI=https://golivefrd.SEU.com/auth/callback
```

> Se não bater byte a byte com o que está no portal, o Discord recusa o login com
> `invalid_redirect_uri`. Em teste local, cadastre também `http://localhost:8090/auth/callback`.

## 4. Definir os administradores

O painel `/admin` é liberado por **Discord user ID**. Para pegar o seu:

1. No Discord, **Configurações → Avançado → Modo de desenvolvedor** (ligado).
2. Clique com o botão direito no seu nome → **Copiar ID do usuário**.

Coloque os IDs (separados por vírgula) no `.env`:

```
ADMIN_DISCORD_IDS=<seu_id>[,<outro_admin_id>]
```

## 5. Segredo da sessão

O cookie de login é assinado com `SESSION_SECRET`. O `gen-env.sh` já gera um
aleatório; se estiver preenchendo à mão:

```bash
openssl rand -hex 32
```

## 6. Aplicar

Depois de editar o `server/.env`, reinicie o container:

```bash
cd server && docker compose up -d --build
```

Teste: abra `https://golivefrd.SEU.com/` → deve aparecer **Entrar com Discord**;
após o login, o seu ID nos `ADMIN_DISCORD_IDS` libera o `/admin`.

## 7. Bot (opcional) — modo "canais" na dashboard

Sem bot, a habilitação é **por usuário** (modo `login`). Com o bot, o admin pode
trocar para o modo **`canais`**: quem está num canal de voz habilitado transmite
(menos os banidos), sem precisar liberar pessoa a pessoa.

1. No mesmo app, vá em **Bot → Reset Token** e copie:

   ```
   DISCORD_BOT_TOKEN=<token do bot>
   ```

2. **Convide o bot para o seu servidor**: em **OAuth2 → URL Generator**, marque o
   escopo `bot` e a permissão **View Channels** (1024), abra o link gerado.

   ```
   https://discord.com/oauth2/authorize?client_id=<Client ID>&scope=bot&permissions=1024
   ```

3. (Opcional) Para exibir **nomes de membros** na dashboard, ligue **Server Members
   Intent** em **Bot → Privileged Gateway Intents**. Sem isso o painel mostra só os IDs.

4. No painel `/admin`, em **Quem pode transmitir**, escolha **Canais** e use
   **Adicionar canal** (lista guilds e canais de voz do bot). Canais em que alguém
   tentar transmitir também **aparecem sozinhos**, desabilitados, até você ligar.

> Só o admin configura o bot — os membros não precisam de login no hub para
> transmitir no modo canais (a checagem acontece no `/dstream`).

## Resumo das variáveis no `.env`

| Variável | De onde vem |
|---|---|
| `DISCORD_CLIENT_ID` | OAuth2 → General → Client ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 → General → Reset Secret |
| `DISCORD_REDIRECT_URI` | `https://SEU_HOST/auth/callback` (idêntico ao cadastrado) |
| `DISCORD_BOT_TOKEN` | Bot → Reset Token (opcional — modo canais) |
| `ADMIN_DISCORD_IDS` | seu(s) Discord user ID(s), separados por vírgula |
| `SESSION_SECRET` | `openssl rand -hex 32` (ou gerado pelo `gen-env.sh`) |
