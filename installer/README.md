# Instalador FRD GoLive (Electron, Mac/Windows)

App gráfico que **aplica a modificação no Discord** sem terminal: escolhe o
servidor (birdra1n ou próprio), puxa a config do host, grava as settings do
plugin + a CSP do domínio, e injeta no Discord. Ao final, abre o hub para o
usuário habilitar o acesso.

## Fluxo

1. Escolher **servidor birdra1n** ou **próprio** (informa o host).
2. `GET https://<host>/config` → o host devolve `signalingUrl`, ICE, transporte.
3. Copia o **Vencord dist** (com o plugin, empacotado) para o data dir.
4. Grava `settings.json` (config do plugin) + `native.json` (`customCspRules` do
   domínio) no data dir.
5. Baixa o **Vencord Installer CLI** e injeta com `VENCORD_USER_DATA_DIR` +
   `VENCORD_DEV_INSTALL=1` (mesmo mecanismo do `pnpm inject`).
6. Botão **"Abrir navegador"** → `golivefrd.birdra1n.com` para habilitar.

## Desenvolvimento

```bash
npm install
npm run typecheck
npm start          # roda o app (precisa do vencord-dist/, ver abaixo)
npm run dist       # empacota .dmg (mac) / .exe (win)
```

## O `vencord-dist/` (bundle do CI)

O app precisa de um **Vencord já compilado com o plugin** em `installer/vencord-dist/`.
Esse artefato é produzido no CI:

```bash
git clone https://github.com/Vendicated/Vencord /tmp/Vencord
cd /tmp/Vencord && pnpm i && pnpm add livekit-client
cp -R <repo>/client/src src/userplugins/frdGoLive
pnpm build
cp -R dist <repo>/installer/vencord-dist
```
(o `vencord-dist/` é gitignored). Para o **servidor birdra1n**, esse build já pode
trazer o domínio na CSP; para servidores próprios, a CSP é escrita via
`customCspRules` no passo 4.

## Pontos a validar em máquina real (WIP)

Este instalador precisa de teste em Mac e Windows reais. Verificar:
- **Flag do Installer CLI** (`-install`) e comportamento headless por plataforma.
- **Caminho das native settings** do Vencord (`settings/native.json` /
  `customCspRules`) — pode variar por versão do Vencord.
- Assinatura/notarização (macOS) e SmartScreen (Windows) dos binários.
- Fechar o Discord antes de injetar.

Enquanto isso, o método manual (client/README.md + copiar `client/src` + `pnpm
build` + `pnpm inject`) continua válido.
