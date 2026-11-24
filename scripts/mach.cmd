@echo off
rem Lance mach (outil de compilation de Firefox) depuis Windows, sans le shell de
rem MozillaBuild, qui entre en conflit avec Git Bash sur certaines machines.
rem Usage : scripts\mach.cmd DOSSIER_DES_SOURCES ARGUMENTS_DE_MACH
setlocal
set "SRC=%~1"
shift
set MOZILLABUILD=C:\mozilla-build\
rem Journaux complets, meme quand mach est lance par un assistant IA.
set AI_AGENT=
set CLAUDECODE=
set "PATH=%SystemRoot%\system32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0;C:\mozilla-build\python3;C:\mozilla-build\bin;C:\mozilla-build\msys2\usr\bin"
cd /d "%SRC%"
python3 mach %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
