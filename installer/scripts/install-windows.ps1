# FRD GoLive - bootstrap do instalador (Windows / PowerShell).
#
# Faz TUDO automaticamente, sem voce clonar nada a mao:
#   1) verifica dependencias (git, node; pnpm e resolvido depois);
#   2) usa este repositorio (ou clona, se voce rodar o script solto);
#   3) compila o Vencord COM o plugin (scripts/build-vencord-dist.mjs);
#   4) compila e abre o instalador grafico.
#
# Uso (no PowerShell):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\installer\scripts\install-windows.ps1

$ErrorActionPreference = "Stop"
$RepoUrl  = "https://github.com/BirdRa1n/FRD_GOLIVE"
$CacheDir = Join-Path $env:LOCALAPPDATA "frd-golive"

function Info($m) { Write-Host "> $m" -ForegroundColor Blue }
function Ok($m)   { Write-Host "OK $m" -ForegroundColor Green }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "X $m" -ForegroundColor Red; exit 1 }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# --- 1. Explicacao + consentimento ------------------------------------------
Write-Host ""
Write-Host "+---------------------------------------------------------------+"
Write-Host "|  FRD GoLive - instalador (Windows)                            |"
Write-Host "+---------------------------------------------------------------+"
Write-Host @"

O que este script vai fazer:
  * Verificar/usar git e Node.js (nao instala nada sem te avisar).
  * Baixar o Vencord num cache do SEU usuario (%LOCALAPPDATA%\frd-golive) e
    compila-lo JA COM o plugin FRD GoLive.
  * Abrir o instalador grafico para escolher o servidor e aplicar.

Sobre permissoes de administrador:
  * O patch do Discord grava em %LocalAppData%\Discord (pasta do SEU usuario),
    entao normalmente NAO precisa de admin. Se o Windows/UAC pedir elevacao
    durante o patch, e para o Vencord modificar o app do Discord.
  * O que muda no Discord: injeta o Vencord (client mod) e grava as settings
    do plugin + uma regra de CSP liberando SO o dominio do seu servidor.
  * Nada e enviado a terceiros; nada e alterado fora do cache, dos dados do
    app e do app do Discord.

Antes de aplicar, FECHE o Discord.
"@

$ans = Read-Host "Continuar? (s/N)"
if ($ans -notmatch '^(s|S|y|Y|sim|yes)$') { Fail "Cancelado." }

# --- 2. Dependencias --------------------------------------------------------
Info "Verificando dependencias..."
if (-not (Have git))  { Fail "git nao encontrado. Instale de https://git-scm.com e rode de novo." }
Ok "git"
if (-not (Have node)) { Fail "Node.js nao encontrado. Instale a versao LTS de https://nodejs.org (marque 'Add to PATH'), reabra o PowerShell e rode de novo." }
Ok "node $(node --version)"

# --- 3. Localizar o repositorio (ou clonar) ---------------------------------
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
if (-not (Test-Path (Join-Path $RepoRoot "client\src\index.tsx"))) {
    Info "Repositorio nao detectado - clonando em $CacheDir\repo..."
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    if (Test-Path (Join-Path $CacheDir "repo\.git")) { git -C "$CacheDir\repo" pull --ff-only }
    else { git clone --depth 1 $RepoUrl "$CacheDir\repo" }
    $RepoRoot = "$CacheDir\repo"
}
$InstallerDir = Join-Path $RepoRoot "installer"
Ok "Repositorio: $RepoRoot"

# --- 4. Build do bundle + do instalador -------------------------------------
Set-Location $InstallerDir
Info "Instalando dependencias do instalador (npm install)..."
npm install
Info "Compilando o Vencord com o plugin (pode demorar na 1a vez)..."
npm run build:vencord
Ok "Bundle pronto."

# --- 5. Abrir o instalador grafico ------------------------------------------
Info "Abrindo o instalador... (escolha o servidor e clique em Aplicar)"
Warn "Se o Discord estiver aberto, feche-o antes de aplicar."
npm start
