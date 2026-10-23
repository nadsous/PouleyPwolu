# Mesure la mémoire d'un navigateur avec les mêmes onglets pour tous.
#   powershell -File bench\ram.ps1 -Browser chrome,edge,brave,comet,pouley [-Runs 3] [-Wait 90]
#   powershell -File bench\ram.ps1 -Path D:\autre\navigateur.exe
# Chaque essai part d'un profil vierge, ouvre les pages de bench\sites.txt, attend que
# tout soit chargé puis additionne la mémoire privée (ce que le Gestionnaire des tâches
# appelle « mémoire ») de tous les processus du navigateur. Résultats dans bench\results.
param(
  [string[]]$Browser = @(),
  [string]$Path,
  [int]$Runs = 3,
  [int]$Wait = 90,
  [string]$Work = $(if ($env:POULEY_WORK) { $env:POULEY_WORK } else { 'C:\pw' })
)
$ErrorActionPreference = 'Stop'

$known = [ordered]@{
  chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  edge   = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  brave  = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
  comet  = "$env:LOCALAPPDATA\Perplexity\Comet\Application\comet.exe"
  pouley = "$Work\ucw\build\src\out\Default\chrome.exe"
}
$targets = [ordered]@{}
# Lancé par « powershell -File », -Browser chrome,edge arrive en une seule chaîne.
foreach ($b in ($Browser -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
  if (-not $known.Contains($b)) { throw "navigateur inconnu : $b (connus : $($known.Keys -join ', '))" }
  if (Test-Path $known[$b]) { $targets[$b] = $known[$b] } else { Write-Host "$b absent ($($known[$b])), ignoré." -ForegroundColor Yellow }
}
if ($Path) { $targets[[IO.Path]::GetFileNameWithoutExtension($Path)] = $Path }
if (-not $targets.Count) { throw 'Rien à mesurer : passe -Browser chrome,edge,... ou -Path.' }

$sites = Get-Content "$PSScriptRoot\sites.txt" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }

# Processus du navigateur : ceux dont la ligne de commande cite le profil de l'essai
# (Comet et d'autres relancent leur processus principal), plus tous leurs descendants.
function Get-Tree([int]$rootId, [string]$dataDir) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($rootId)
  foreach ($p in $all) { if ($p.CommandLine -and $p.CommandLine.Contains($dataDir)) { [void]$ids.Add([int]$p.ProcessId) } }
  do {
    $before = $ids.Count
    foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } }
  } while ($ids.Count -ne $before)
  return ,$ids
}

function Measure-Once($exe) {
  $dataDir = Join-Path $env:TEMP ("pouley-bench-" + [guid]::NewGuid().ToString('N'))
  $flags = @("--user-data-dir=`"$dataDir`"", '--no-first-run', '--no-default-browser-check', '--disable-sync', '--new-window') + $sites
  $main = Start-Process $exe -ArgumentList $flags -PassThru
  try {
    Start-Sleep -Seconds $Wait
    $ids = Get-Tree $main.Id $dataDir
    # Working Set - Private : la colonne « Mémoire » du Gestionnaire des tâches.
    $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids.Contains([int]$_.IDProcess) }
    [pscustomobject]@{
      mo        = [math]::Round(($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB)
      processus = $ids.Count
    }
  } finally {
    foreach ($id in (Get-Tree $main.Id $dataDir)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 3
    Remove-Item $dataDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$rows = foreach ($name in $targets.Keys) {
  $exe = $targets[$name]
  $version = (Get-Item $exe).VersionInfo.ProductVersion
  $samples = for ($i = 1; $i -le $Runs; $i++) {
    Write-Host "$name $version : essai $i/$Runs ($($sites.Count) onglets, $Wait s)…"
    Measure-Once $exe
  }
  $sorted = $samples | Sort-Object mo
  $median = $sorted[[math]::Floor(($sorted.Count - 1) / 2)]
  [pscustomobject]@{
    navigateur = $name
    version    = $version
    'médiane Mo' = $median.mo
    'min Mo'   = $sorted[0].mo
    'max Mo'   = $sorted[-1].mo
    processus  = $median.processus
  }
}

$rows | Sort-Object 'médiane Mo' | Format-Table -AutoSize
$out = "$PSScriptRoot\results"
New-Item -ItemType Directory -Force $out | Out-Null
$file = Join-Path $out ("ram-" + (Get-Date -Format 'yyyy-MM-dd-HHmm') + ".csv")
$rows | Export-Csv $file -NoTypeInformation -Encoding UTF8 -Delimiter ';'
Write-Host "Résultats : $file"
