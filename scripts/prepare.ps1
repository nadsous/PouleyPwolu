# Récupère ungoogled-chromium-windows à la version figée dans engine\source.lock.json,
# puis y ajoute les patches et réglages PouleyPwolu.
#   powershell -File scripts\prepare.ps1 [-Work C:\pw] [-Ucw C:\autre\dossier]
# Le dossier de travail reste hors du dépôt : sources et compilation y pèsent ~100 Go.
# Garde-le court (C:\pw) : les chemins de Chromium frôlent les limites de Windows.
# -Ucw place ungoogled-chromium-windows ailleurs que dans $Work\ucw (la CI GitHub l'attend
# dans C:\ungoogled-chromium-windows).
param(
  [string]$Work = $(if ($env:POULEY_WORK) { $env:POULEY_WORK } else { 'C:\pw' }),
  [string]$Ucw
)
$ErrorActionPreference = 'Stop'

# git écrit sa progression sur stderr : on la laisse passer sans que PowerShell 5.1 la prenne
# pour une erreur quand la sortie est redirigée (build.ps1 l'envoie dans un journal).
function Invoke-Git {
  $ErrorActionPreference = 'Continue'
  & git.exe @args 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE) { throw "git $args a échoué ($LASTEXITCODE)" }
}

$root = Split-Path $PSScriptRoot -Parent
$lock = Get-Content "$root\engine\source.lock.json" -Raw | ConvertFrom-Json
$ucw = if ($Ucw) { $Ucw } else { Join-Path $Work 'ucw' }

# Test-Path d'abord : New-Item refuse une racine de disque (C:\) même avec -Force.
$parent = Split-Path $ucw
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force $parent | Out-Null }
if (-not (Test-Path "$ucw\.git")) { Invoke-Git clone $lock.windows.repository $ucw }
Invoke-Git -C $ucw fetch --tags origin
# --force remet patches\series et flags.windows.gn d'origine si une préparation précédente les a modifiés.
Invoke-Git -C $ucw checkout --force --quiet $lock.windows.commit
Invoke-Git -C $ucw submodule update --init --recursive --force

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

# Nom et icônes : engine\rebrand.py tourne juste après les patches et la substitution de
# domaines. On le copie dans ucw\pouley et on ajoute son appel dans build.py.
$rb = "$ucw\pouley"
if (Test-Path $rb) { Remove-Item $rb -Recurse -Force }
New-Item -ItemType Directory -Force $rb | Out-Null
Copy-Item "$root\engine\rebrand.py" $rb
Copy-Item "$root\engine\branding" "$rb\branding" -Recurse
Copy-Item "$root\engine\extension" "$rb\extension" -Recurse
Copy-Item "$root\engine\nadspdf.key" $rb
Copy-Item "$root\extensions\nadspdf" "$rb\nadspdf" -Recurse
$buildPy = "$ucw\build.py"
# Fins de ligne normalisées : git sur Windows peut récupérer build.py en CRLF.
$py = [IO.File]::ReadAllText($buildPy) -replace "`r`n", "`n"
$anchor = "            None`n        )`n"
if ($py.IndexOf($anchor) -lt 0) { throw "build.py : point d'insertion du renommage introuvable" }
$call = $anchor + "        # PouleyPwolu : nom et icônes (ajouté par scripts/prepare.ps1)`n" +
  "        subprocess.run([sys.executable, str(_ROOT_DIR / 'pouley' / 'rebrand.py'), str(source_tree)], check=True)`n"
$i = $py.IndexOf($anchor)
[IO.File]::WriteAllText($buildPy, $py.Substring(0, $i) + $call + $py.Substring($i + $anchor.Length), $utf8)

# Réglages GN : ajoutés après ceux de Windows, la dernière valeur l'emporte.
$flags = "$ucw\flags.windows.gn"
$text = [IO.File]::ReadAllText($flags).TrimEnd("`r", "`n") + "`n`n" + ([IO.File]::ReadAllText("$root\engine\flags.gn") -replace "`r`n", "`n")
[IO.File]::WriteAllText($flags, $text, $utf8)

Write-Host "Prêt dans $ucw : ungoogled-chromium-windows $($lock.windows.tag), $($ours.Count) patch(es) PouleyPwolu."
