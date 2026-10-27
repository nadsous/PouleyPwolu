# Pont vers les contrôles multimédia de Windows (SMTC) : lit le morceau en cours
# d'une application (Spotify, etc.) et transmet lecture/pause/suivant/précédent.
# Protocole : une commande par ligne sur l'entrée standard, une réponse JSON par
# ligne sur la sortie. Commandes : state | toggle | next | prev | quit
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(4000) | Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$ownId = $args[0]
$lastArtKey = ''

function Pick-Session {
  $sessions = @($mgr.GetSessions()) | Where-Object { $_.SourceAppUserModelId -and $_.SourceAppUserModelId -notmatch [regex]::Escape($ownId) -and $_.SourceAppUserModelId -notmatch 'electron|pouley' }
  $spotify = $sessions | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Select-Object -First 1
  if ($spotify) { return $spotify }
  $playing = $sessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
  if ($playing) { return $playing }
  return $sessions | Select-Object -First 1
}

function Read-Art($props) {
  $ref = $props.Thumbnail
  if (-not $ref) { return $null }
  $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  if (-not $stream -or $stream.Size -eq 0 -or $stream.Size -gt 600000) { return $null }
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
  $bytes = New-Object byte[] ([int]$stream.Size)
  $reader.ReadBytes($bytes)
  $type = if ($stream.ContentType) { $stream.ContentType } else { 'image/jpeg' }
  return "data:$type;base64," + [Convert]::ToBase64String($bytes)
}

while ($true) {
  $cmd = [Console]::In.ReadLine()
  if ($null -eq $cmd -or $cmd -eq 'quit') { break }
  $s = Pick-Session
  if (-not $s) { '{"none":true}'; continue }
  switch ($cmd) {
    'toggle' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
    'next' { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
    'prev' { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
  }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $s.GetTimelineProperties()
  $key = "$($p.Title)|$($p.Artist)"
  $art = $null
  if ($key -ne $lastArtKey) { $art = Read-Art $p; $lastArtKey = $key }
  [pscustomobject]@{
    app = $s.SourceAppUserModelId
    title = $p.Title
    artist = $p.Artist
    album = $p.AlbumTitle
    state = "$($s.GetPlaybackInfo().PlaybackStatus)".ToLower()
    duration = $tl.EndTime.TotalSeconds
    time = $tl.Position.TotalSeconds
    art = $art
    artKey = $key
  } | ConvertTo-Json -Compress
}
