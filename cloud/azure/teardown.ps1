# Supprime tout ce que setup.ps1 a créé sur Azure : machine, disque, adresse IP, stockage (et les
# fichiers qu'il contient), alerte de budget. Après ça, Azure ne coûte plus rien.
#   powershell -ExecutionPolicy Bypass -File cloud\azure\teardown.ps1
# Pense à rapatrier les fichiers compilés avant (cloud\azure\build.ps1 le fait tout seul).
param([switch]$Yes)
. "$PSScriptRoot\common.ps1"

$sub = Get-Subscription
if (-not (Invoke-AzJson group exists -n $Cfg.Group)) { Write-Host "Rien à supprimer : le groupe $($Cfg.Group) n'existe pas."; return }
Write-Host "Ressources qui vont être supprimées (groupe $($Cfg.Group)) :"
Invoke-AzJson resource list -g $Cfg.Group --query '[].{nom:name, type:type}' | ForEach-Object { Write-Host "  $($_.type)  $($_.nom)" }
if (-not $Yes -and (Read-Host 'Tout supprimer ? (oui/non)') -ne 'oui') { Write-Host 'Annulé.'; return }

Write-Host 'Suppression (quelques minutes)…'
Invoke-Az group delete -n $Cfg.Group --yes | Out-Null
try { Invoke-Az rest --method delete --url "https://management.azure.com/subscriptions/$($sub.id)/providers/Microsoft.Consumption/budgets/pouley-build?api-version=2023-11-01" | Out-Null } catch {}
Write-Host 'Tout est supprimé. setup.ps1 recrée l''ensemble si tu en as besoin un jour.'
