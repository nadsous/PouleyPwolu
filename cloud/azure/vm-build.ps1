# Exécuté sur la machine Azure (en SYSTEM) par build.ps1, à chaque compilation. build.ps1 ajoute
# en tête les variables $SourceUrl (zip du dépôt) et $OutBase/$Sas (où déposer les fichiers).
# La compilation se fait sur le disque local D:, rapide et gratuit, effacé quand la machine s'arrête.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Le service « run command » a démarré avant l'installation des outils : on relit le PATH.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$src = 'D:\pouley-src'
if (Test-Path $src) { Remove-Item $src -Recurse -Force }
Invoke-WebRequest $SourceUrl -OutFile 'D:\pouley-src.zip' -UseBasicParsing
Expand-Archive 'D:\pouley-src.zip' $src -Force

$started = Get-Date
# Passé par cmd : PowerShell 5.1 prendrait sinon chaque ligne de stderr pour une erreur fatale.
cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$src\scripts\build.ps1`" -Work D:\pw 2>&1"
if ($LASTEXITCODE) { throw "La compilation a échoué ($LASTEXITCODE)." }

$files = Get-ChildItem 'D:\pw\ucw\build' -File | Where-Object { $_.Extension -in '.exe', '.zip' }
foreach ($f in $files) {
  Write-Output ("Envoi de {0} ({1:N0} Mo)" -f $f.Name, ($f.Length / 1MB))
  Invoke-WebRequest -Method Put -Uri "$OutBase/$($f.Name)?$Sas" -InFile $f.FullName -UseBasicParsing `
    -Headers @{ 'x-ms-blob-type' = 'BlockBlob'; 'x-ms-version' = '2023-11-03' } | Out-Null
}
Write-Output ("Terminé en {0:hh\:mm}." -f ((Get-Date) - $started))
