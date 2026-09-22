@echo off
rem FRD GoLive - compila o instalador e gera o .exe de distribuicao (Windows).
rem
rem Gera em installer\release\:
rem   FRD-GoLive-Setup-<versao>.exe            -> instalador (NSIS) do app
rem   FRD-GoLive-Setup-<versao>.exe.blockmap   -> download diferencial do auto-update
rem   latest.yml                               -> lido pelo electron-updater
rem   win-unpacked\FRD GoLive.exe              -> app sem instalar (para testar)
rem
rem O app do macOS e gerado no Mac: bash installer/scripts/build-app.sh
rem Para publicar depois: installer\scripts\publish-release.bat
rem
rem Uso:
rem   installer\scripts\build-app.bat [--bump patch^|minor^|major] [--skip-vencord]
rem     --bump          sobe a versao do package.json antes (sem tag git)
rem     --skip-vencord  reaproveita o vencord-dist\ existente (nao recompila o plugin)
rem
rem Assinatura: sem certificado (CSC_LINK/CSC_KEY_PASSWORD) o .exe sai sem
rem assinatura - funciona, mas o SmartScreen avisa na 1a execucao.

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "BUMP="
set "SKIP_VENCORD=0"

:args
if "%~1"=="" goto argsdone
if /i "%~1"=="--bump" (
    set "BUMP=%~2"
    shift & shift
    goto args
)
if /i "%~1"=="--skip-vencord" (
    set "SKIP_VENCORD=1"
    shift
    goto args
)
if /i "%~1"=="--help" goto usage
if /i "%~1"=="-h" goto usage
echo [X] Opcao desconhecida: %~1  (use --help)
exit /b 1

:usage
for /f "usebackq tokens=* delims=" %%l in ("%~f0") do (
    set "line=%%l"
    if "!line:~0,3!"=="rem" echo(!line:~4!
)
exit /b 0

:argsdone
if defined BUMP (
    if /i not "%BUMP%"=="patch" if /i not "%BUMP%"=="minor" if /i not "%BUMP%"=="major" (
        echo [X] --bump aceita patch, minor ou major
        exit /b 1
    )
)

echo.
echo === FRD GoLive - build do instalador (Windows) ===
echo.

where node >nul 2>nul || (echo [X] Node.js nao encontrado. Instale o Node LTS 20 ou 22: https://nodejs.org & exit /b 1)
where npm  >nul 2>nul || (echo [X] npm nao encontrado. & exit /b 1)
where git  >nul 2>nul || (echo [X] git nao encontrado - necessario para compilar o Vencord. & exit /b 1)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (echo [X] Node %NODE_MAJOR% e antigo demais - use 20 ou 22. & exit /b 1)
if %NODE_MAJOR% GEQ 26 echo [!] Node %NODE_MAJOR%: o download do Electron pode falhar. Prefira Node 22.

if defined BUMP (
    echo ^> Subindo versao ^(%BUMP%^)...
    call npm version %BUMP% --no-git-tag-version >nul || exit /b 1
)
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VERSION=%%v"
echo [OK] Versao %VERSION%

echo ^> Instalando dependencias do instalador...
call npm install --no-audit --no-fund || exit /b 1

set "HAS_DIST=0"
if exist "vencord-dist\" for /f %%x in ('dir /b "vencord-dist" 2^>nul') do set "HAS_DIST=1"
if "%SKIP_VENCORD%"=="1" if "%HAS_DIST%"=="1" (
    echo [OK] Reaproveitando vencord-dist\ ^(--skip-vencord^)
    goto built_vencord
)
echo ^> Compilando o Vencord com o plugin ^(vencord-dist\^)...
call node scripts\build-vencord-dist.mjs || exit /b 1
:built_vencord

echo ^> Compilando o app ^(TypeScript + design system^)...
call npm run build || exit /b 1

if exist release rmdir /s /q release

if not defined CSC_LINK (
    echo [!] Sem certificado ^(CSC_LINK^): o .exe sai sem assinatura - o SmartScreen avisa na 1a execucao.
)

echo ^> Empacotando ^(.exe^)...
call npx electron-builder --win nsis --x64 --publish never || exit /b 1

echo.
echo === Pronto - arquivos em installer\release\: ===
for %%f in (release\*.exe release\latest.yml) do echo   %%~nxf  ^(%%~zf bytes^)
if exist "release\win-unpacked\FRD GoLive.exe" echo   win-unpacked\FRD GoLive.exe
echo.
echo Publicar esta versao (v%VERSION%) no GitHub:  installer\scripts\publish-release.bat
endlocal
exit /b 0
