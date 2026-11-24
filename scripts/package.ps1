# Rassemble ce que la compilation a produit dans release\moteur :
# - PouleyPwolu-<version>-windows-x64-installateur.exe : fenêtre PouleyPwolu + installateur du moteur ;
# - PouleyPwolu-<version>-windows-x64.zip : version portable.
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1
$ErrorActionPreference = 'Stop'
$depot = Resolve-Path (Join-Path $PSScriptRoot '..')
$lock = Get-Content (Join-Path $depot 'engine\source.lock.json') -Raw | ConvertFrom-Json
$work = if ($env:POULEY_WORK) { $env:POULEY_WORK } else { $lock.work }
$dist = Join-Path $work ("src\firefox-" + $lock.firefox + "\obj-pouleypwolu\dist")
$version = (Get-Content (Join-Path $depot 'engine\extension\manifest.json') -Raw | ConvertFrom-Json).version

$setup = Get-ChildItem $dist -Filter 'pouleypwolu-*.installer.exe' | Select-Object -First 1
$zip = Get-ChildItem $dist -Filter 'pouleypwolu-*.win64.zip' | Select-Object -First 1
if (-not $setup) { throw "Installateur du moteur introuvable dans $dist (lancer build.ps1 -Etape package)" }

$out = Join-Path $depot 'release\moteur'
New-Item -ItemType Directory -Force $out | Out-Null
$installateur = Join-Path $out "PouleyPwolu-$version-windows-x64-installateur.exe"
& (Join-Path $depot 'engine\installateur\build-installateur.ps1') -MiniInstaller $setup.FullName -Sortie $installateur
if ($zip) { Copy-Item $zip.FullName (Join-Path $out "PouleyPwolu-$version-windows-x64.zip") -Force }
Get-ChildItem $out | ForEach-Object { '{0}  {1:N0} Mo' -f $_.Name, ($_.Length / 1MB) }
