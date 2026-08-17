# ====================================================================
# SCRIPT DE PRÉPARATION ET GÉNÉRATION DE L'INSTALLATEUR AGENT OHADA (V2.0.0)
# ====================================================================

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$stageDir = Join-Path $PSScriptRoot "stage"
$serverDir = Join-Path $rootDir "server"
$distDir = Join-Path $rootDir "dist"
$outputDir = Join-Path $rootDir "installer-output"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " Preparation du Bundle Installateur Agent OHADA V2" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. Compilation Frontend Vite
Write-Host "`n[1/5] Compilation du frontend React (npm run build)..." -ForegroundColor Yellow
Set-Location $rootDir
npm run build

# 2. Copie du frontend compilé dans server/public
Write-Host "`n[2/5] Transfert des assets du frontend vers server/public..." -ForegroundColor Yellow
$serverPublic = Join-Path $serverDir "public"
if (Test-Path $serverPublic) {
    Remove-Item $serverPublic -Recurse -Force
}
New-Item -ItemType Directory -Path $serverPublic | Out-Null
Copy-Item "$distDir\*" $serverPublic -Recurse -Force

# 3. Préparation du dossier d'étape packaging/stage
Write-Host "`n[3/5] Nettoyage et creation du dossier packaging/stage..." -ForegroundColor Yellow
if (Test-Path $stageDir) {
    Remove-Item $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir | Out-Null

# 4. Copie de Node.exe et des scripts VBS
Write-Host "`n[4/5] Ingestion de Node.exe et des lanceurs VBS..." -ForegroundColor Yellow
$nodePath = (Get-Command node).Source
Copy-Item $nodePath (Join-Path $stageDir "node.exe") -Force
Copy-Item (Join-Path $PSScriptRoot "launch.vbs") $stageDir -Force
Copy-Item (Join-Path $PSScriptRoot "stop.vbs") $stageDir -Force

# Copie du serveur Express (sans les fichiers de test volumineux)
$stageServer = Join-Path $stageDir "server"
New-Item -ItemType Directory -Path $stageServer -Force | Out-Null

robocopy $serverDir $stageServer /E /XF "agent-ohada.sqlite*" "test_*.js" "*.pdf" "*.xlsx" /MT:16 /NP /NDL /NFL /NJH /NJS
if ($LASTEXITCODE -le 7) { $global:LASTEXITCODE = 0 }

# 5. Résumé et Compilation Inno Setup
Write-Host "`n[5/5] Compilation de l'installateur Windows AgentOHADA-Setup.exe..." -ForegroundColor Yellow

$isccPaths = @(
    (Join-Path $rootDir "node_modules\innosetup\bin\ISCC.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Antigravity IDE\resources\app\node_modules\innosetup\bin\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

$isccExe = $isccPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($isccExe) {
    Write-Host "Execution d'Inno Setup avec ($isccExe)..." -ForegroundColor Cyan
    & $isccExe (Join-Path $PSScriptRoot "AgentOHADA.iss")
    
    $finalExe = Join-Path $outputDir "AgentOHADA-Setup.exe"
    if (Test-Path $finalExe) {
        Write-Host "`nINSTALLATEUR EXECUTION GENEREE AVEC SUCCES !" -ForegroundColor Green
        Write-Host "Fichier disponible : $finalExe" -ForegroundColor White
    }
} else {
    Write-Host "`nLe dossier packaging/stage est pret." -ForegroundColor Yellow
}

Write-Host "`n=====================================================" -ForegroundColor Cyan
