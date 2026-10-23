# Compile le moteur puis crée l'installateur et le zip.
#   powershell -File scripts\build.ps1 [-Work C:\pw] [-Jobs 16] [-Clean]
# À lancer dans un PowerShell administrateur. La première compilation prend plusieurs
# heures ; les suivantes ne recompilent que ce qui a changé.
# -Clean efface la compilation (pas les sources téléchargées). Il le faut après un échec
# avant la compilation proprement dite (téléchargement, patches), ou quand les patches,
# les réglages ou la version figée ont changé : le script le signale.
param(
  [string]$Work = $(if ($env:POULEY_WORK) { $env:POULEY_WORK } else { 'C:\pw' }),
  [int]$Jobs = 0,
  [switch]$Clean
)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Lance ce script dans un PowerShell administrateur (ungoogled-chromium-windows le demande).' }

& "$PSScriptRoot\check-env.ps1" -Work $Work
if ($LASTEXITCODE) { exit 1 }
& "$PSScriptRoot\prepare.ps1" -Work $Work

$root = Split-Path $PSScriptRoot -Parent
$ucw = Join-Path $Work 'ucw'
$build = "$ucw\build"
# Sources à moitié préparées (compilation arrêtée pendant la décompression) : build.py ne
# saurait pas les reprendre, on repart de zéro en gardant les archives téléchargées.
if (-not $Clean -and (Test-Path "$build\src") -and -not (Test-Path "$build\src\BUILD.gn")) {
  Write-Host 'Sources incomplètes d''une compilation interrompue : nettoyage.'
  $Clean = $true
}
if ($Clean -and (Test-Path $build)) {
  Get-ChildItem $build -Force | Where-Object { $_.Name -ne 'download_cache' } | Remove-Item -Recurse -Force
}

# Empreinte de tout ce qui façonne les sources : si elle change, les sources déjà
# préparées ne correspondent plus, et build.py ne les referait pas de lui-même.
$inputs = @(Get-Item "$root\engine\source.lock.json", "$root\engine\flags.gn") + @(Get-ChildItem "$root\engine\patches" -Recurse -File | Sort-Object FullName)
$sha = [Security.Cryptography.SHA256]::Create()
$stampNow = -join ($inputs | ForEach-Object { [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($_.FullName))) })
$stamp = "$build\pouley.stamp"
if (Test-Path "$build\src\BUILD.gn") {
  if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $stampNow) {
    throw 'Les patches, les réglages ou la version ont changé depuis la préparation des sources : relance avec -Clean.'
  }
} else {
  New-Item -ItemType Directory -Force $build | Out-Null
  Set-Content $stamp $stampNow
}

# --tarball : archive officielle de Chromium vérifiée par empreinte, plus légère qu'un clone git.
# --ci : ne prépare les sources que si elles manquent, puis reprend la compilation là où elle
# s'était arrêtée. build.py coupe alors ninja toutes les 3 h 30 (code 124) : on relance.
$pyArgs = @('build.py', '--tarball', '--ci')
if ($Jobs -gt 0) { $pyArgs += @('-j', $Jobs) }
$started = Get-Date
Push-Location $ucw
try {
  do {
    # Passé par cmd : PowerShell 5.1 transforme sinon chaque ligne de stderr (la progression
    # de curl, par exemple) en erreur, et $ErrorActionPreference = 'Stop' arrête tout.
    cmd /c "python3 $($pyArgs -join ' ') 2>&1"
    $code = $LASTEXITCODE
    if ($code -eq 124) { Write-Host 'Pause de build.py après 3 h 30, reprise de la compilation…' }
  } while ($code -eq 124)
  if ($code) { throw "build.py a échoué ($code). Si l'erreur est arrivée avant la compilation (téléchargement, patches), relance avec -Clean." }
} finally { Pop-Location }

Write-Host ("Compilé en {0:hh\:mm}. Installateur et zip dans $build :" -f ((Get-Date) - $started))
Get-ChildItem $build -File | Where-Object { $_.Extension -in '.exe', '.zip' } | ForEach-Object { Write-Host "  $($_.Name)" }
