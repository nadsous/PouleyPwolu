# Fabrique l'installateur de PouleyPwolu : la fenêtre (Installateur.cs, compilée par le csc
# de .NET Framework 4, présent sur tout Windows) suivie de mini_installer.exe, l'installateur
# de Chromium, puis de sa taille (8 octets) et de « POULEYPW ».
#
#   build-installateur.ps1 -MiniInstaller <mini_installer.exe> -Sortie <installateur.exe>
#   build-installateur.ps1 -MiniInstaller <...> -Remplacer   (remplace le fichier donné)
param(
  [Parameter(Mandatory = $true)][string]$MiniInstaller,
  [string]$Sortie,
  [switch]$Remplacer
)
$ErrorActionPreference = 'Stop'
$ici = $PSScriptRoot
$depot = Resolve-Path (Join-Path $ici '..\..')
if ($Remplacer) { $Sortie = $MiniInstaller }
if (-not $Sortie) { throw 'Indiquer -Sortie ou -Remplacer.' }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

$version = (Get-Content (Join-Path $depot 'engine\extension\manifest.json') -Raw | ConvertFrom-Json).version
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('pw-installateur-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  $versionTxt = Join-Path $tmp 'version.txt'
  [IO.File]::WriteAllText($versionTxt, $version)
  $polices = Join-Path $depot 'engine\extension\sidebar'
  $fenetre = Join-Path $tmp 'fenetre.exe'
  & $csc /nologo /target:winexe /optimize+ /platform:anycpu `
    "/out:$fenetre" `
    "/win32icon:$(Join-Path $depot 'build\icon.ico')" `
    "/win32manifest:$(Join-Path $ici 'app.manifest')" `
    "/resource:$(Join-Path $polices 'Onest-Regular.ttf'),Onest-Regular.ttf" `
    "/resource:$(Join-Path $polices 'Onest-SemiBold.ttf'),Onest-SemiBold.ttf" `
    "/resource:$(Join-Path $polices 'JetBrainsMono-Regular.ttf'),JetBrainsMono-Regular.ttf" `
    "/resource:$versionTxt,version.txt" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    (Join-Path $ici 'Installateur.cs')
  if ($LASTEXITCODE -ne 0) { throw "csc a échoué ($LASTEXITCODE)" }

  # Si on remplace mini_installer, on le met d'abord de côté.
  $charge = $MiniInstaller
  if ((Resolve-Path $MiniInstaller).Path -eq [IO.Path]::GetFullPath($Sortie)) {
    $charge = Join-Path $tmp 'mini_installer.exe'
    Copy-Item $MiniInstaller $charge
  }
  $out = [IO.File]::Create($Sortie)
  try {
    foreach ($f in @($fenetre, $charge)) {
      $in = [IO.File]::OpenRead($f)
      try { $in.CopyTo($out) } finally { $in.Dispose() }
    }
    $taille = (Get-Item $charge).Length
    $out.Write([BitConverter]::GetBytes([long]$taille), 0, 8)
    $magie = [Text.Encoding]::ASCII.GetBytes('POULEYPW')
    $out.Write($magie, 0, 8)
  } finally { $out.Dispose() }
  Write-Output "Installateur : $Sortie ($([math]::Round((Get-Item $Sortie).Length / 1MB)) Mo, version $version)"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
