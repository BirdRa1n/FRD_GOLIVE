# Instalação do cliente no Windows

Tutorial para instalar o plugin **FRDGoLive** no Discord Desktop no Windows.
Como o Vencord compila os plugins no build, você monta o Vencord com o nosso
plugin dentro e injeta no Discord.

> Precisa fazer isto **em cada máquina** que vai usar a transmissão privada, e
> todas com a **mesma** config (`serverUrl`, `tokenServiceUrl`, `orgSecret`).

## 1. Pré-requisitos

Abra o **PowerShell** e instale (via winget):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
npm install -g pnpm
```

Feche e reabra o PowerShell depois, para o `PATH` atualizar. Confira:

```powershell
node -v ; git --version ; pnpm -v
```

## 2. Clonar o Vencord (FORA de qualquer repo nosso)

```powershell
git clone https://github.com/Vendicated/Vencord "$env:USERPROFILE\Vencord"
cd "$env:USERPROFILE\Vencord"
pnpm install
pnpm add livekit-client
```

> Não clone o Vencord dentro da pasta `client/` do nosso projeto — o pnpm "sobe"
> e usa o `package.json` errado, dando `Command "build" not found`.

## 3. Copiar o plugin para dentro do Vencord

Baixe/clone o nosso repositório (ex.: em `C:\FRD_GOLIVE`) e **copie** a pasta
`client\src` para `src\userplugins\frdGoLive`:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Vencord\src\userplugins" | Out-Null
Copy-Item -Recurse -Force "C:\FRD_GOLIVE\client\src" "$env:USERPROFILE\Vencord\src\userplugins\frdGoLive"
```

Ajuste `C:\FRD_GOLIVE` para onde você clonou o projeto.

> **Copie, não use symlink.** O Vencord resolve os aliases (`@webpack/common`
> etc.) com escopo em `src/**`; um link para fora do repo quebra o build. E copie
> **`client\src`** (que contém o `index.tsx`), não `client\` inteiro.

## 4. Buildar e injetar

Feche o **Discord completamente** (clique com o botão direito no ícone da bandeja
→ Quit / Sair — não só o X da janela). Depois:

```powershell
cd "$env:USERPROFILE\Vencord"
pnpm build
pnpm inject
```

No menu do instalador, escolha **Install Vencord** e selecione seu Discord.

### Se o `pnpm inject` falhar (download 404 / erro)

Baixe o instalador CLI na mão e rode com as variáveis que apontam para o seu build:

```powershell
$url = "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe"
Invoke-WebRequest $url -OutFile "$env:TEMP\VencordInstallerCli.exe"
$env:VENCORD_USER_DATA_DIR = "$env:USERPROFILE\Vencord"
$env:VENCORD_DEV_INSTALL = "1"
& "$env:TEMP\VencordInstallerCli.exe"
```

Escolha **Install Vencord**. Se o SmartScreen avisar que o app não é reconhecido,
clique em "Mais informações" → "Executar assim mesmo" (o binário é o instalador
oficial do Vencord, só não é assinado).

## 5. Ativar e configurar no Discord

1. Abra o Discord.
2. **Configurações → Vencord → Plugins** → procure **FRDGoLive** → ative.
3. Ainda nas settings do plugin, preencha:
   - `serverUrl` → `ws://SEU_HOST:7880` (ou `wss://livekit.seudominio.com`)
   - `tokenServiceUrl` → `http://SEU_HOST:8080` (ou `https://token.seudominio.com`)
   - `orgSecret` → o mesmo do `.env` do servidor

Ao entrar numa call de voz, o painel flutuante aparece no canto.

## 6. Regiões com bloqueio de tela

Se o Discord desabilita o compartilhamento de tela na sua região, ligue **"Captura
nativa"** nas settings do plugin. No Windows esse modo (via `desktopCapturer`)
funciona bem e **inclusive captura o áudio do sistema**.

## Atualizar o plugin depois (loop de dev)

Ao mudar o código, re-sincronize e rebuilde:

```powershell
robocopy "C:\FRD_GOLIVE\client\src" "$env:USERPROFILE\Vencord\src\userplugins\frdGoLive" /MIR
cd "$env:USERPROFILE\Vencord"
pnpm build
```

Depois reinicie o Discord (Ctrl+R na janela costuma bastar para recarregar).

## Problemas comuns

- **`Command "build" not found`** → você está na pasta errada ou clonou o Vencord
  dentro de `client/`. Rode o `pnpm build` dentro de `%USERPROFILE%\Vencord`.
- **`Could not resolve "@webpack/common"`** → você usou symlink ou copiou `client\`
  em vez de `client\src`. Refaça a cópia da pasta `client\src`.
- **Plugin não aparece** → confira que existe
  `%USERPROFILE%\Vencord\src\userplugins\frdGoLive\index.tsx` e rebuilde.
- **Conecta mas a tela não aparece** → é o caminho de mídia (UDP) no servidor, não
  o cliente. Ver `server/README.md`.
