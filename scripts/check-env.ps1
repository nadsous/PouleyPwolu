# Vérifie que la machine peut compiler le moteur, sans rien installer.
#   powershell -File scripts\check-env.ps1 [-Work C:\pw]
# Sort avec le code 1 s'il manque quelque chose d'obligatoire.
param([string]$Work = $(if ($env:POULEY_WORK) { $env:POULEY_WORK } else { 'C:\pw' }))

$script:missing = 0
function Ok($msg) { Write-Host "  [ok]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!]    $msg" -ForegroundColor Yellow }
function Bad($msg, $fix) {
  Write-Host "  [manque] $msg" -ForegroundColor Red
  if ($fix) { Write-Host "           -> $fix" -ForegroundColor DarkGray }
  $script:missing++
}

Write-Host "Machine"
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
if ($ram -ge 30) { Ok "$ram Go de RAM" } elseif ($ram -ge 16) { Warn "$ram Go de RAM : ça passe, en baissant -Jobs" } else { Bad "$ram Go de RAM (16 minimum)" }

$drive = (Split-Path -Qualifier ([IO.Path]::GetFullPath($Work))).TrimEnd(':')
$free = [math]::Round((Get-PSDrive $drive).Free / 1GB)
if ($free -ge 110) { Ok "$free Go libres sur ${drive}: (dossier de travail $Work)" }
else { Bad "$free Go libres sur ${drive}: ; il en faut au moins 110 (sources, compilation, Visual Studio)" "libère de la place, ou choisis un autre disque NTFS avec -Work D:\pw" }

$long = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -ErrorAction SilentlyContinue).LongPathsEnabled
if ($long -eq 1) { Ok 'chemins longs activés' } else { Bad 'chemins longs désactivés' 'en admin : reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f' }

Write-Host "Visual Studio 2026"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = $null
if (Test-Path $vswhere) {
  $vs = & $vswhere -version '[18.0,' -products * -latest -requires Microsoft.VisualStudio.Workload.NativeDesktop Microsoft.VisualStudio.Component.VC.ATLMFC -property installationPath
}
if ($vs) { Ok "trouvé dans $vs" }
else { Bad 'Visual Studio 2026 (18.x) avec « Développement Desktop C++ » et MFC/ATL' 'winget install Microsoft.VisualStudio.Community --override "--add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.VC.ATLMFC --includeRecommended --passive"' }

$kits = "${env:ProgramFiles(x86)}\Windows Kits\10"
$sdk = Get-ChildItem "$kits\Include" -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '10.0.28000.*' } | Select-Object -First 1
if ($sdk) { Ok "Windows SDK $($sdk.Name)" } else { Bad 'Windows 11 SDK 10.0.28000' 'Visual Studio Installer -> Modifier -> Composants individuels -> Windows 11 SDK (10.0.28000)' }
if (Test-Path "$kits\Debuggers\x64\cdb.exe") { Ok 'outils de débogage du SDK' }
else { Bad 'outils de débogage du SDK (Debugging Tools for Windows)' 'Paramètres -> Applications -> Windows Software Development Kit -> Modifier -> Debugging Tools for Windows' }

Write-Host "Outils"
$py = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $py -or $py.Source -like '*WindowsApps*') {
  Bad 'python3.exe (Python 3.11 ou plus, hors Microsoft Store)' 'copie python.exe en python3.exe dans le dossier de Python, et coupe les alias « App Installer » dans Paramètres -> Applications -> Paramètres avancés -> Alias d''exécution'
} else {
  $ver = (& python3 -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
  if ([version]$ver -ge [version]'3.11') { Ok "Python $ver ($($py.Source))" } else { Bad "Python $ver (3.11 minimum)" }
  $mods = & python3 -c "import importlib.metadata as m`nfor p in ('httplib2','clang'):`n  try: print(p, m.version(p))`n  except Exception: print(p, '-')"
  foreach ($line in $mods) {
    $name, $v = $line.Trim() -split ' '
    $want = @{ httplib2 = '0.22.0'; clang = '21.1.7' }[$name]
    if ($v -eq $want) { Ok "module $name $v" } else { Bad "module Python $name $want (trouvé : $v)" "python3 -m pip install $name==$want" }
  }
}

if (Test-Path "$env:ProgramFiles\7-Zip\7z.exe") { Ok '7-Zip' } else { Bad '7-Zip' 'winget install 7zip.7zip' }
if (Get-Command git -ErrorAction SilentlyContinue) { Ok (git --version) } else { Bad 'Git' 'winget install Git.Git' }
if ($env:PATH -match 'depot_tools') { Warn 'depot_tools est dans le PATH : ungoogled-chromium demande de ne pas l''utiliser' }

Write-Host ''
if ($script:missing) { Write-Host "$($script:missing) élément(s) à régler avant de compiler." -ForegroundColor Red; exit 1 }
Write-Host 'Tout est prêt pour compiler.' -ForegroundColor Green
