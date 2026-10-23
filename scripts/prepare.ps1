# Récupère ungoogled-chromium-windows à la version figée dans engine\source.lock.json,
# puis y ajoute les patches et réglages PouleyPwolu.
#   powershell -File scripts\prepare.ps1 [-Work C:\pw]
# Le dossier de travail reste hors du dépôt : sources et compilation y pèsent ~100 Go.
# Garde-le court (C:\pw) : les chemins de Chromium frôlent les limites de Windows.
param([string]$Work = $(if ($env:POULEY_WORK) { $env:POULEY_WORK } else { 'C:\pw' }))
$ErrorActionPreference = 'Stop'

function Git { & git @args; if ($LASTEXITCODE) { throw "git $args a échoué ($LASTEXITCODE)" } }

$root = Split-Path $PSScriptRoot -Parent
$lock = Get-Content "$root\engine\source.lock.json" -Raw | ConvertFrom-Json
$ucw = Join-Path $Work 'ucw'

New-Item -ItemType Directory -Force $Work | Out-Null
if (-not (Test-Path "$ucw\.git")) { Git clone $lock.windows.repository $ucw }
Git -C $ucw fetch --tags origin
# --force remet patches\series et flags.windows.gn d'origine si une préparation précédente les a modifiés.
Git -C $ucw checkout --force --quiet $lock.windows.commit
Git -C $ucw submodule update --init --recursive --force

$sub = (& git -C "$ucw\ungoogled-chromium" rev-parse HEAD).Trim()
if ($sub -ne $lock.ungoogled.commit) { throw "ungoogled-chromium est à $sub, le verrou attend $($lock.ungoogled.commit)" }

# Patches PouleyPwolu : copiés dans patches\pouley et ajoutés à la fin de la série Windows.
$dest = "$ucw\patches\pouley"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
$ours = Get-Content "$root\engine\patches\series" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
foreach ($p in $ours) {
  $src = Join-Path "$root\engine\patches" $p
  if (-not (Test-Path $src)) { throw "patch introuvable : $p" }
  $to = Join-Path $dest $p
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Copy-Item $src $to
}
# Écriture en octets : on garde des fins de ligne LF, comme le reste de la série.
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ($ours) {
  $series = "$ucw\patches\series"
  $text = [IO.File]::ReadAllText($series).TrimEnd("`r", "`n") + "`n" + (($ours | ForEach-Object { "pouley/$_" }) -join "`n") + "`n"
  [IO.File]::WriteAllText($series, $text, $utf8)
}

# Réglages GN : ajoutés après ceux de Windows, la dernière valeur l'emporte.
$flags = "$ucw\flags.windows.gn"
$text = [IO.File]::ReadAllText($flags).TrimEnd("`r", "`n") + "`n`n" + ([IO.File]::ReadAllText("$root\engine\flags.gn") -replace "`r`n", "`n")
[IO.File]::WriteAllText($flags, $text, $utf8)

Write-Host "Prêt dans $ucw : ungoogled-chromium-windows $($lock.windows.tag), $($ours.Count) patch(es) PouleyPwolu."
