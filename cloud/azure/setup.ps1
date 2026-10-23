# Prépare Azure une fois pour toutes : alerte de budget, quota Spot, stockage, machine de
# compilation avec ses outils. Relançable sans risque : chaque étape déjà faite est sautée.
#   powershell -ExecutionPolicy Bypass -File cloud\azure\setup.ps1
# Il faut un abonnement « Paiement à l'utilisation » et « az login » déjà fait.
. "$PSScriptRoot\common.ps1"

$sub = Get-Subscription
$email = $sub.user.name
$account = Get-StorageName $sub.id
Write-Host "Abonnement : $($sub.name) ($($sub.id)), compte $email"

Write-Host 'Fournisseurs Azure'
foreach ($ns in 'Microsoft.Compute', 'Microsoft.Network', 'Microsoft.Storage', 'Microsoft.Quota', 'Microsoft.Consumption') {
  Invoke-Az provider register --namespace $ns --wait | Out-Null
}

Write-Host "Groupe de ressources $($Cfg.Group) ($($Cfg.Location))"
Invoke-Az group create -n $Cfg.Group -l $Cfg.Location | Out-Null

# Alerte par mail à 80 % du budget mensuel réel, et quand la prévision dépasse 100 %.
Write-Host "Alerte de budget : $($Cfg.BudgetEur) €/mois, prévenu à $email"
$month = (Get-Date -Day 1).ToString('yyyy-MM-01T00:00:00Z')
$budget = @{ properties = @{
  category = 'Cost'; amount = $Cfg.BudgetEur; timeGrain = 'Monthly'; timePeriod = @{ startDate = $month }
  notifications = @{
    reel80 = @{ enabled = $true; operator = 'GreaterThan'; threshold = 80; thresholdType = 'Actual'; contactEmails = @($email) }
    prevu100 = @{ enabled = $true; operator = 'GreaterThan'; threshold = 100; thresholdType = 'Forecasted'; contactEmails = @($email) }
  }
} }
$body = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($body, ($budget | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Invoke-Az rest --method put --url "https://management.azure.com/subscriptions/$($sub.id)/providers/Microsoft.Consumption/budgets/pouley-build?api-version=2023-11-01" --body "@$body" | Out-Null
} finally { Remove-Item $body -ErrorAction SilentlyContinue }

# Quota Spot : par défaut, un abonnement n'a droit qu'à quelques cœurs Spot par région.
$usage = Invoke-AzJson vm list-usage -l $Cfg.Location --query '[?name.value==''lowPriorityCores''] | [0]'
Write-Host "Quota Spot à $($Cfg.Location) : $($usage.limit) cœurs"
if ([int]$usage.limit -lt $Cfg.SpotCores) {
  Write-Host "Demande de passage à $($Cfg.SpotCores) cœurs Spot…"
  $q = @{ properties = @{ limit = @{ limitObjectType = 'LimitValue'; value = $Cfg.SpotCores }; name = @{ value = 'lowPriorityCores' }; resourceType = 'lowPriority' } }
  $body = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($body, ($q | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Invoke-Az rest --method put --url "https://management.azure.com/subscriptions/$($sub.id)/providers/Microsoft.Compute/locations/$($Cfg.Location)/providers/Microsoft.Quota/quotas/lowPriorityCores?api-version=2023-02-01" --body "@$body" | Out-Null
  } finally { Remove-Item $body -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 20
    $usage = Invoke-AzJson vm list-usage -l $Cfg.Location --query '[?name.value==''lowPriorityCores''] | [0]'
    if ([int]$usage.limit -ge $Cfg.SpotCores) { break }
  }
  if ([int]$usage.limit -lt $Cfg.SpotCores) {
    throw "Quota Spot toujours à $($usage.limit) : la demande passe en revue manuelle chez Microsoft. Suis-la dans le portail (Quotas → Compute), puis relance ce script."
  }
  Write-Host "Quota Spot accordé : $($usage.limit) cœurs"
}

Write-Host "Stockage $account (conteneur $($Cfg.Container), privé)"
if (-not (Invoke-AzJson storage account list -g $Cfg.Group --query "[?name=='$account'] | [0]")) {
  Invoke-Az storage account create -n $account -g $Cfg.Group -l $Cfg.Location --sku Standard_LRS --kind StorageV2 `
    --allow-blob-public-access false --min-tls-version TLS1_2 | Out-Null
}
$accountId = (Invoke-AzJson storage account show -n $account -g $Cfg.Group).id
$me = (Invoke-AzJson ad signed-in-user show).id
if (-not (Invoke-AzJson role assignment list --assignee $me --scope $accountId --role 'Storage Blob Data Contributor')) {
  Invoke-Az role assignment create --assignee-object-id $me --assignee-principal-type User --role 'Storage Blob Data Contributor' --scope $accountId | Out-Null
  Write-Host '  (droits accordés, Azure met une à deux minutes à les appliquer)'
}
for ($i = 0; $i -lt 20; $i++) {
  try { Invoke-Az storage container create -n $Cfg.Container --account-name $account --auth-mode login | Out-Null; break }
  catch { if ($i -eq 19) { throw }; Start-Sleep -Seconds 15 }
}

Write-Host "Machine $($Cfg.Vm) : $($Cfg.Size) Spot, Windows Server 2025"
if (-not (Invoke-AzJson vm list -g $Cfg.Group --query "[?name=='$($Cfg.Vm)'] | [0]")) {
  # Pas d'accès à distance : aucun port ouvert, mot de passe aléatoire jamais affiché (on pilote
  # la machine par « run command » d'Azure). « az vm user update » permet d'en remettre un.
  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#%+-='.ToCharArray()
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32; $rng.GetBytes($bytes)
  $password = 'Pw1!' + (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
  # L'IP publique sert seulement aux téléchargements sortants : les nouveaux réseaux Azure n'ont
  # plus d'accès Internet par défaut. Aucune règle entrante n'est ouverte (--nsg-rule NONE).
  Invoke-Az vm create -g $Cfg.Group -n $Cfg.Vm -l $Cfg.Location --image $Cfg.Image --size $Cfg.Size `
    --priority Spot --eviction-policy Deallocate --max-price -1 `
    --os-disk-size-gb 128 --storage-sku StandardSSD_LRS `
    --admin-username pouley --admin-password $password `
    --public-ip-sku Standard --nsg-rule NONE | Out-Null
  $password = $null
} elseif ((Get-PowerState) -ne 'running') {
  Invoke-Az vm start -g $Cfg.Group -n $Cfg.Vm | Out-Null
}

try {
  Write-Host 'Installation des outils sur la machine (30 à 60 min, une seule fois)…'
  $sas = New-ContainerSas $account 6 'racwl'
  $state = Invoke-VmScript 'provision' "$PSScriptRoot\vm-provision.ps1" $account $sas 'setup'
  if ($state -ne 'Succeeded') { throw "Installation des outils : $state. Journal dans le conteneur $($Cfg.Container), dossier setup/." }
  Write-Host 'Redémarrage pour finir les installations…'
  Invoke-Az vm restart -g $Cfg.Group -n $Cfg.Vm | Out-Null
} finally {
  Write-Host 'Arrêt de la machine (elle ne coûte plus que son disque)…'
  Invoke-Az vm deallocate -g $Cfg.Group -n $Cfg.Vm | Out-Null
}
Write-Host "Azure est prêt. Pour compiler : powershell -ExecutionPolicy Bypass -File cloud\azure\build.ps1"
