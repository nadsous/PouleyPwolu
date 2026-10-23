# Compile le moteur sur la machine Azure Spot, rapatrie l'installateur et le zip, puis éteint
# la machine. Compile le dernier commit (pas les modifications non commitées).
#   powershell -ExecutionPolicy Bypass -File cloud\azure\build.ps1 [-Out release] [-Retries 3]
# Si Azure reprend la machine Spot en cours de route, on la relance (jusqu'à -Retries fois).
param(
  [string]$Out = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'release'),
  [int]$Retries = 3
)
. "$PSScriptRoot\common.ps1"

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sub = Get-Subscription
$account = Get-StorageName $sub.id

$dirty = & git -C $root status --porcelain
if ($dirty) { Write-Host 'Attention : des modifications ne sont pas commitées, elles ne seront pas compilées.' -ForegroundColor Yellow }
$commit = (& git -C $root rev-parse --short HEAD).Trim()
$run = (Get-Date -Format 'yyyyMMdd-HHmm') + "-$commit"

# Le dépôt part en zip dans le stockage ; la machine le récupère par un lien SAS.
$zip = Join-Path $env:TEMP "pouley-src-$run.zip"
& git -C $root archive --format=zip -o $zip HEAD
if ($LASTEXITCODE) { throw 'git archive a échoué' }
Invoke-Az storage blob upload --account-name $account -c $Cfg.Container -n "$run/source.zip" -f $zip --auth-mode login --overwrite | Out-Null
Remove-Item $zip

$sas = New-ContainerSas $account 12 'racwl'
$base = "https://$account.blob.core.windows.net/$($Cfg.Container)/$run"
$script = Join-Path $env:TEMP "pouley-vm-build-$run.ps1"
$header = "`$SourceUrl = '$base/source.zip?$sas'`r`n`$OutBase = '$base'`r`n`$Sas = '$sas'`r`n"
[IO.File]::WriteAllText($script, $header + [IO.File]::ReadAllText("$PSScriptRoot\vm-build.ps1"), (New-Object Text.UTF8Encoding($true)))

$started = Get-Date
try {
  for ($try = 1; $try -le $Retries; $try++) {
    Write-Host "Démarrage de la machine Spot (essai $try/$Retries)…"
    try { Invoke-Az vm start -g $Cfg.Group -n $Cfg.Vm | Out-Null }
    catch { Write-Host "Azure n'a pas de machine Spot libre pour l'instant : $($_.Exception.Message.Split("`n")[0])" -ForegroundColor Yellow; Start-Sleep -Seconds 300; continue }
    Write-Host "Compilation de $commit (journal ci-dessous, mis à jour chaque minute)"
    $state = Invoke-VmScript 'build' $script $account $sas $run
    if ($state -eq 'Succeeded') { break }
    if ($state -ne 'Evicted') { throw "Compilation : $state. Journal complet : conteneur $($Cfg.Container), dossier $run/." }
    Write-Host 'Azure a repris la machine Spot : on recommence.' -ForegroundColor Yellow
  }
  if ($state -ne 'Succeeded') { throw "Pas de compilation complète après $Retries essais." }
} finally {
  Remove-Item $script -ErrorAction SilentlyContinue
  Write-Host 'Arrêt de la machine…'
  try { Invoke-Az vm deallocate -g $Cfg.Group -n $Cfg.Vm | Out-Null } catch { Write-Host "Arrêt impossible, à faire dans le portail : $($_.Exception.Message)" -ForegroundColor Red }
}

New-Item -ItemType Directory -Force $Out | Out-Null
Invoke-Az storage blob download-batch --account-name $account -s $Cfg.Container -d $Out --pattern "$run/*.exe" --auth-mode login | Out-Null
Invoke-Az storage blob download-batch --account-name $account -s $Cfg.Container -d $Out --pattern "$run/*.zip" --auth-mode login | Out-Null
$hours = ((Get-Date) - $started).TotalHours
Write-Host ("Compilé en {0:N1} h (environ {1:N2} € de machine Spot). Fichiers dans $Out\$run :" -f $hours, $hours)
Get-ChildItem "$Out\$run" -File | Where-Object { $_.Name -ne 'source.zip' } | ForEach-Object { Write-Host "  $($_.Name)" }
