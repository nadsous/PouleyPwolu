# Prépare les sources puis compile PouleyPwolu (moteur Firefox) avec les outils de Mozilla.
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1 [-Etape bootstrap|build|package|tout]
# Résultat : <sources>\obj-pouleypwolu\dist\ (zip et installateur dans dist\install\sea).
# mach est lancé depuis Windows (scripts\mach.cmd), pas depuis le shell de MozillaBuild.
param(
  [ValidateSet('bootstrap', 'build', 'package', 'tout')][string]$Etape = 'tout'
)
$ErrorActionPreference = 'Stop'
$depot = Resolve-Path (Join-Path $PSScriptRoot '..')
$lock = Get-Content (Join-Path $depot 'engine\source.lock.json') -Raw | ConvertFrom-Json
$work = if ($env:POULEY_WORK) { $env:POULEY_WORK } else { $lock.work }
$src = Join-Path $work ("src\firefox-" + $lock.firefox)
if (-not (Test-Path 'C:\mozilla-build\python3\python3.exe')) {
  throw 'MozillaBuild manque : https://ftp.mozilla.org/pub/mozilla/libraries/win32/MozillaBuildSetup-Latest.exe'
}

python (Join-Path $depot 'scripts\prepare.py') $src
if ($LASTEXITCODE -ne 0) { throw "prepare.py a échoué ($LASTEXITCODE)" }

$mach = Join-Path $depot 'scripts\mach.cmd'
function Invoke-Mach {
  & cmd.exe /c "`"$mach`" `"$src`" $args < NUL"
  if ($LASTEXITCODE -ne 0) { throw "mach $args a échoué ($LASTEXITCODE)" }
}

if ($Etape -in 'bootstrap', 'tout') { Invoke-Mach --no-interactive bootstrap --application-choice browser }
if ($Etape -in 'build', 'tout') { Invoke-Mach build }
if ($Etape -in 'package', 'tout') {
  Invoke-Mach package
  # Installateur NSIS du moteur (dist\pouleypwolu-<version>.en-US.win64.installer.exe) :
  # cible « installer » de browser/installer/windows, à partir du zip de « mach package ».
  $obj = Join-Path $src 'obj-pouleypwolu'
  $zip = Get-ChildItem (Join-Path $obj 'dist') -Filter 'pouleypwolu-*.win64.zip' | Select-Object -First 1
  if (-not $zip) { throw 'Paquet zip introuvable après « mach package ».' }
  $mozmake = Join-Path $(if ($env:MOZBUILD_STATE_PATH) { $env:MOZBUILD_STATE_PATH } else { Join-Path $env:USERPROFILE '.mozbuild' }) 'mozmake\mozmake.exe'
  $env:MOZILLABUILD = 'C:\mozilla-build\'
  $vieuxPath = $env:PATH
  $env:PATH = "$env:SystemRoot\system32;$env:SystemRoot;C:\mozilla-build\python3;C:\mozilla-build\bin;C:\mozilla-build\msys2\usr\bin"
  try {
    & $mozmake -C (Join-Path $obj 'browser\installer\windows') installer "ZIP_IN=$($zip.FullName -replace '\\', '/')"
    if ($LASTEXITCODE -ne 0) { throw "Installateur du moteur : échec ($LASTEXITCODE)" }
  } finally { $env:PATH = $vieuxPath }
}
Write-Output "PouleyPwolu compilé : $src\obj-pouleypwolu\dist"
