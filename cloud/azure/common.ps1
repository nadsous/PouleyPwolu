# Réglages et fonctions partagés par les scripts Azure. Chargé avec : . "$PSScriptRoot\common.ps1"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Cfg = [ordered]@{
  Location  = 'francecentral'
  Group     = 'pouley-build'
  Vm        = 'pouley-build'
  # 64 vCPU, 128 Go de RAM, 512 Go de disque local rapide (D:), environ 1 €/h en Spot.
  Size      = 'Standard_F64s_v2'
  Image     = 'MicrosoftWindowsServer:WindowsServer:2025-datacenter-azure-edition:latest'
  Container = 'artefacts'
  SpotCores = 64
  BudgetEur = 30
  # Une compilation complète sur 64 vCPU prend ~2 h 30 ; marge pour la préparation.
  TimeoutSec = 21600
}

# Azure CLI lancé par son Python, sans az.cmd : cmd.exe couperait les liens SAS au premier « & ».
$AzPython = Join-Path ${env:ProgramFiles} 'Microsoft SDKs\Azure\CLI2\python.exe'
if (-not (Test-Path $AzPython)) { throw "Azure CLI introuvable ($AzPython) : winget install Microsoft.AzureCLI" }

function Invoke-Az {
  $ErrorActionPreference = 'Continue'
  $out = & $AzPython -IBm azure.cli @args --only-show-errors 2>&1
  $code = $LASTEXITCODE
  $text = ($out | ForEach-Object { "$_" }) -join "`n"
  if ($code) { throw "az $($args -join ' ') a échoué :`n$text" }
  $text
}
function Invoke-AzJson { $t = Invoke-Az @args -o json; if ($t) { $t | ConvertFrom-Json } }

function Get-Subscription {
  try { Invoke-AzJson account show } catch { throw 'Pas d''abonnement Azure actif : lance « az login » (abonnement Paiement à l''utilisation, l''essai gratuit n''accepte pas les machines Spot).' }
}

# Nom du compte de stockage : unique dans tout Azure, donc dérivé de l'abonnement.
function Get-StorageName($subId) {
  $sha = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($subId))
  'pouley' + (-join ($sha[0..8] | ForEach-Object { $_.ToString('x2') })).Substring(0, 14)
}

# Lien SAS « délégation utilisateur » sur le conteneur, valable quelques heures.
function New-ContainerSas($account, [int]$hours, [string]$perms) {
  $expiry = (Get-Date).ToUniversalTime().AddHours($hours).ToString('yyyy-MM-ddTHH:mmZ')
  (Invoke-Az storage container generate-sas --account-name $account --name $Cfg.Container --permissions $perms --expiry $expiry --auth-mode login --as-user --https-only -o tsv).Trim()
}

function Get-PowerState {
  $v = Invoke-AzJson vm get-instance-view -g $Cfg.Group -n $Cfg.Vm --query 'instanceView.statuses[?starts_with(code, ''PowerState/'')].code | [0]'
  "$v" -replace '^PowerState/', ''
}

# Lance un script PowerShell sur la machine sans attendre (« run command » géré), puis suit son
# état jusqu'à la fin. La sortie du script est écrite dans un blob et affichée au fil de l'eau.
function Invoke-VmScript($name, $scriptFile, $account, $sas, $prefix) {
  $base = "https://$account.blob.core.windows.net/$($Cfg.Container)/$prefix"
  $outUri = "$base/$name.log?$sas"
  $errUri = "$base/$name.err.log?$sas"
  try { Invoke-Az vm run-command delete -g $Cfg.Group --vm-name $Cfg.Vm --name $name --yes | Out-Null } catch {}
  Invoke-Az vm run-command create -g $Cfg.Group --vm-name $Cfg.Vm --name $name --location $Cfg.Location `
    --script "@$scriptFile" --async-execution true --timeout-in-seconds $Cfg.TimeoutSec `
    --output-blob-uri $outUri --error-blob-uri $errUri | Out-Null

  $shown = 0
  while ($true) {
    Start-Sleep -Seconds 60
    $power = Get-PowerState
    $state = "$(Invoke-AzJson vm run-command show -g $Cfg.Group --vm-name $Cfg.Vm --name $name --instance-view --query 'instanceView.executionState')"
    # Nouvelles lignes du journal, sans tout retélécharger.
    $tmp = [IO.Path]::GetTempFileName()
    try {
      Invoke-Az storage blob download --account-name $account -c $Cfg.Container -n "$prefix/$name.log" -f $tmp --auth-mode login | Out-Null
      $lines = @(Get-Content $tmp -Encoding UTF8)
      if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | ForEach-Object { "  | $_" }; $shown = $lines.Count }
    } catch {} finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
    if ($power -eq 'deallocated' -or $power -eq 'stopped') { return 'Evicted' }
    if ($state -in 'Succeeded', 'Failed', 'TimedOut', 'Canceled') { return $state }
  }
}
