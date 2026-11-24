# Lance le PouleyPwolu compilé avec un profil d'essai neuf, et garde la console dans
# C:\pwff\essai-console.txt (erreurs JavaScript de l'extension comprises).
#   powershell -ExecutionPolicy Bypass -File scripts\essai.ps1 [-Extension] [-Secondes 25]
# -Extension : recopie d'abord l'extension intégrée (sans recompiler Firefox).
param([switch]$Extension, [int]$Secondes = 25, [string]$Page = 'about:blank')
$ErrorActionPreference = 'Stop'
$depot = Resolve-Path (Join-Path $PSScriptRoot '..')
$lock = Get-Content (Join-Path $depot 'engine\source.lock.json') -Raw | ConvertFrom-Json
$work = if ($env:POULEY_WORK) { $env:POULEY_WORK } else { $lock.work }
$src = Join-Path $work ("src\firefox-" + $lock.firefox)
$exe = Join-Path $src 'obj-pouleypwolu\dist\bin\pouleypwolu.exe'

Get-Process pouleypwolu -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
Start-Sleep 1
if ($Extension) {
  python (Join-Path $depot 'scripts\prepare.py') $src --extension
  # Recopie l'extension telle quelle dans dist\bin (pas « mach build faster » : il crée des
  # liens symboliques que Firefox ne sait pas lire sous Windows).
  $cible = Join-Path $src 'obj-pouleypwolu\dist\bin\browser\chrome\browser\builtin-addons\pouleypwolu'
  if (Test-Path $cible) { Remove-Item -Recurse -Force $cible }
  Copy-Item -Recurse (Join-Path $depot 'engine\extension') $cible
}

$profil = Join-Path $work 'profil-essai'
if (Test-Path $profil) { Remove-Item -Recurse -Force $profil }
New-Item -ItemType Directory $profil | Out-Null
@(
  'user_pref("devtools.console.stdout.chrome", true);'
  'user_pref("devtools.console.stdout.content", true);'
  'user_pref("browser.dom.window.dump.enabled", true);'
) | Set-Content (Join-Path $profil 'user.js') -Encoding ascii

$console = Join-Path $work 'essai-console.txt'
Start-Process $exe -ArgumentList '-no-remote', '-profile', $profil, $Page `
  -RedirectStandardOutput $console -RedirectStandardError (Join-Path $work 'essai-erreurs.txt') | Out-Null
Start-Sleep $Secondes
Get-Content $console, (Join-Path $work 'essai-erreurs.txt') -ErrorAction SilentlyContinue |
  Select-String 'PouleyPwolu|JavaScript error|TypeError' | Select-Object -First 30 |
  ForEach-Object { $_.Line.Substring(0, [Math]::Min(300, $_.Line.Length)) }
