# Exécuté UNE fois sur la machine Azure (en SYSTEM) par setup.ps1 : installe tout ce que
# scripts\check-env.ps1 demande. Le disque C: est conservé ; il n'est plus à refaire ensuite.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dl = 'C:\pouley-setup'
New-Item -ItemType Directory -Force $dl | Out-Null

function Get-File($url, $name) {
  $to = Join-Path $dl $name
  if (-not (Test-Path $to)) { Write-Output "Téléchargement de $name"; Invoke-WebRequest $url -OutFile $to -UseBasicParsing }
  $to
}
function Install($what, $exe, [string[]]$arguments, [int[]]$okCodes = @(0)) {
  Write-Output "Installation : $what"
  $p = Start-Process $exe -ArgumentList $arguments -Wait -PassThru
  if ($okCodes -notcontains $p.ExitCode) { throw "$what : code $($p.ExitCode)" }
}

reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f | Out-Null
# Le dossier de compilation (sur le disque local D:) n'est pas analysé par Defender : c'est le
# réglage recommandé par Chromium, et ce dossier ne contient que des sources vérifiées par empreinte.
Add-MpPreference -ExclusionPath 'D:\pw' -ErrorAction SilentlyContinue

if (-not (Test-Path 'C:\Python312\python.exe')) {
  Install 'Python 3.12' (Get-File 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' 'python.exe') `
    @('/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0', 'TargetDir=C:\Python312')
}
Copy-Item C:\Python312\python.exe C:\Python312\python3.exe -Force
& C:\Python312\python.exe -m pip install --disable-pip-version-check -q httplib2==0.22.0 clang==21.1.7
if ($LASTEXITCODE) { throw "pip : code $LASTEXITCODE" }

if (-not (Test-Path "$env:ProgramFiles\Git\cmd\git.exe")) {
  Install 'Git' (Get-File 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.3/Git-2.56.0.3-64-bit.exe' 'git.exe') `
    @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-')
}
if (-not (Test-Path "$env:ProgramFiles\7-Zip\7z.exe")) {
  Install '7-Zip' (Get-File 'https://github.com/ip7z/7zip/releases/download/26.05/7z2605-x64.exe' '7zip.exe') @('/S')
}

# Windows SDK 10.0.28000, avec ses outils de débogage (« /features + » : tout le kit).
if (-not (Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\cdb.exe")) {
  Install 'Windows SDK 10.0.28000' (Get-File 'https://download.microsoft.com/download/06fc99ac-527e-451e-a536-8866695a2e7e/KIT_BUNDLE_WINDOWSSDK_MEDIACREATION/winsdksetup.exe' 'winsdksetup.exe') `
    @('/features', '+', '/quiet', '/norestart') @(0, 3010)
}

# Visual Studio 2026 Community : développement Desktop C++ et MFC/ATL. 3010 = redémarrage demandé.
Install 'Visual Studio 2026' (Get-File 'https://aka.ms/vs/18/stable/vs_community.exe' 'vs_community.exe') `
  @('--add', 'Microsoft.VisualStudio.Workload.NativeDesktop', '--add', 'Microsoft.VisualStudio.Component.VC.ATLMFC',
    '--includeRecommended', '--quiet', '--wait', '--norestart', '--nocache') @(0, 3010)

Write-Output 'Machine prête.'
