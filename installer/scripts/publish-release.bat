@echo off
rem FRD GoLive - publica o instalador compilado como release no GitHub (gh CLI).
rem
rem Sobe o que estiver em installer\release\ (gerado por build-app.bat / .sh) para a
rem release v<versao do package.json> em BirdRa1n/FRD_GOLIVE. E dessa release que o
rem auto-update (electron-updater) dos apps instalados puxa a nova versao.
rem
rem Mac e Windows podem publicar em momentos diferentes: o 1o cria a release, o
rem 2o so anexa os arquivos dele (latest-mac.yml e latest.yml nao conflitam).
rem
rem Uso:
rem   installer\scripts\publish-release.bat [--draft] [--notes "texto"] [--repo dono/repo]
rem     --draft   cria como rascunho (o auto-update IGNORA rascunhos; publique depois
rem               com: gh release edit vX.Y.Z --draft=false)
rem     --notes   notas da release (padrao: geradas dos commits)
rem     --repo    outro repositorio (padrao: BirdRa1n/FRD_GOLIVE ou %%FRD_RELEASE_REPO%%)
rem
rem Requer: gh autenticado (gh auth login) com permissao de escrita no repositorio.

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "REPO=BirdRa1n/FRD_GOLIVE"
if defined FRD_RELEASE_REPO set "REPO=%FRD_RELEASE_REPO%"
set "DRAFT="
set "NOTES="

:args
if "%~1"=="" goto argsdone
if /i "%~1"=="--draft" (
    set "DRAFT=--draft"
    shift
    goto args
)
if /i "%~1"=="--notes" (
    set "NOTES=%~2"
    shift & shift
    goto args
)
if /i "%~1"=="--repo" (
    set "REPO=%~2"
    shift & shift
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
where gh >nul 2>nul || (echo [X] GitHub CLI ^(gh^) nao encontrado: https://cli.github.com & exit /b 1)
gh auth status >nul 2>nul || (echo [X] gh nao esta autenticado. Rode: gh auth login & exit /b 1)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VERSION=%%v"
set "TAG=v%VERSION%"

rem Arquivos gerados pelo electron-builder para ESTA versao (+ os latest*.yml).
set "FILES="
set "COUNT=0"
for %%f in ("release\*%VERSION%*.exe" "release\*%VERSION%*.blockmap" "release\*%VERSION%*.dmg" "release\*%VERSION%*.zip" "release\latest*.yml") do (
    set FILES=!FILES! "%%~f"
    set /a COUNT+=1
)
if "%COUNT%"=="0" (
    echo [X] Nada para publicar em installer\release\ para a versao %VERSION%. Rode build-app.bat antes.
    exit /b 1
)

rem Os latest*.yml precisam ser da mesma versao (senao o update aponta pro lugar errado).
for %%y in ("release\latest*.yml") do (
    findstr /r /c:"^version: %VERSION%$" "%%~y" >nul 2>nul || findstr /r /c:"^version: %VERSION%" "%%~y" >nul || (
        echo [X] %%~nxy nao e da versao %VERSION% - recompile antes de publicar.
        exit /b 1
    )
)

echo ^> Release %TAG% em %REPO% - arquivos:
for %%f in (!FILES!) do echo   %%~nxf

gh release view %TAG% --repo %REPO% >nul 2>nul
if not errorlevel 1 (
    echo ^> A release %TAG% ja existe - anexando/substituindo arquivos...
    gh release upload %TAG% !FILES! --repo %REPO% --clobber || exit /b 1
    goto done
)

set "TARGET="
for /f "delims=" %%s in ('git rev-parse HEAD 2^>nul') do set "SHA=%%s"
if defined SHA (
    for /f "delims=" %%b in ('git branch -r --contains !SHA! 2^>nul') do set "TARGET=--target !SHA!"
)
if not defined TARGET echo [!] O commit atual nao esta no GitHub - a tag %TAG% vai apontar para a branch padrao.

echo ^> Criando a release %TAG%...
if defined NOTES (
    gh release create %TAG% !FILES! --repo %REPO% --title "FRD GoLive %VERSION%" --notes "!NOTES!" %DRAFT% !TARGET! || exit /b 1
) else (
    gh release create %TAG% !FILES! --repo %REPO% --title "FRD GoLive %VERSION%" --generate-notes %DRAFT% !TARGET! || exit /b 1
)

:done
for /f "delims=" %%u in ('gh release view %TAG% --repo %REPO% --json url -q .url') do echo [OK] Publicado: %%u
if defined DRAFT echo [!] Rascunho: o auto-update so enxerga depois de: gh release edit %TAG% --repo %REPO% --draft=false
endlocal
exit /b 0
