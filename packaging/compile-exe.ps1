# ====================================================================
# SCRIPT COMPILATION AUTOMATIQUE INSTALLATEUR EXE (INNO SETUP)
# ====================================================================

$ErrorActionPreference = "Stop"

$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootDir = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $rootDir "installer-output"

if (!(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

# 1. Verification d'ISCC.exe
$isccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

$isccExe = $isccPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (!$isccExe) {
    Write-Host "Telechargement d'Inno Setup 6..." -ForegroundColor Yellow
    $innoSetupInstaller = Join-Path $env:TEMP "innosetup-setup.exe"
    $url = "https://files.jrsoftware.org/is/6/innosetup-6.3.3.exe"
    
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $innoSetupInstaller -UseBasicParsing
    
    Write-Host "Installation silencieuse d'Inno Setup..." -ForegroundColor Yellow
    Start-Process -FilePath $innoSetupInstaller -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-" -Wait
    
    $isccExe = $isccPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($isccExe) {
    Write-Host "`nCompilation de AgentOHADA-Setup.exe avec Inno Setup ($isccExe)..." -ForegroundColor Cyan
    & $isccExe (Join-Path $PSScriptRoot "AgentOHADA.iss")
    
    $finalExe = Join-Path $outputDir "AgentOHADA-Setup.exe"
    if (Test-Path $finalExe) {
        Write-Host "`nFICHIER EXECUTION GENEREE AVEC SUCCES :" -ForegroundColor Green
        Write-Host "   -> $finalExe" -ForegroundColor White
    } else {
        Write-Host "`nEchec de generation du fichier .exe" -ForegroundColor Red
    }
} else {
    Write-Host "`nImpossible de trouver ISCC.exe" -ForegroundColor Red
}
