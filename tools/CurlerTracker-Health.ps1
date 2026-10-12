$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Local = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$Runtime = Join-Path $Root 'data\global\collector-runtime.json'
$Status = Join-Path $Root 'data\global\maintenance-state.json'
$Published = Join-Path $Local 'last-published.json'
Write-Output 'CURLER TRACKER SYSTEM HEALTH'
Write-Output '----------------------------'
if (Test-Path $Runtime) {
  $r = Get-Content $Runtime -Raw | ConvertFrom-Json
  $proc = Get-Process -Id $r.process_id -ErrorAction SilentlyContinue
  Write-Output ("Collector supervisor: " + $(if ($proc) { 'RUNNING' } else { 'STOPPED' }) + " pid=$($r.process_id) phase=$($r.phase) heartbeat=$($r.heartbeat_at)")
} else { Write-Output 'Collector supervisor: UNKNOWN (runtime file missing)' }
if (Test-Path $Status) {
  $s = Get-Content $Status -Raw | ConvertFrom-Json
  foreach ($p in $s.tasks.PSObject.Properties) {
    $v = $p.Value
    Write-Output ("Task: {0,-25} state={1,-9} success={2} failures={3}" -f $p.Name, $v.state, $v.last_success_at, $v.consecutive_failures)
  }
}
$Season = Join-Path $Root 'data\global\canada-current-season.json'
if (Test-Path $Season) {
  $seasonData = Get-Content $Season -Raw | ConvertFrom-Json
  Write-Output "Current-season archive: $($seasonData.event_count) events from $($seasonData.source_count) association sources (does not measure all curling events)"
}
if (Test-Path $Published) {
  $p = Get-Content $Published -Raw | ConvertFrom-Json
  Write-Output "Last verified production release: $($p.published_at) ($($p.files) files)"
} else { Write-Output 'Last verified production release: UNKNOWN' }
foreach ($url in @('https://curler-tracker.vercel.app/', 'https://curler-tracker.vercel.app/data/history/mb.json', 'https://curler-tracker.vercel.app/data/offline-curler-index/a.json')) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    Write-Output ("PUBLIC {0} HTTP {1}, bytes={2}" -f $url, $response.StatusCode, $response.RawContentLength)
  } catch { Write-Output "PUBLIC ERROR $url : $($_.Exception.Message)" }
}

$BackupState = Join-Path $Local 'backup-state.json'
if (Test-Path $BackupState) {
  $backup = Get-Content $BackupState -Raw | ConvertFrom-Json
  Write-Output "OneDrive backup (local copy): $($backup.copied_at) destination=$($backup.destination); cloud sync NOT VERIFIED"
} else { Write-Output 'OneDrive backup (local copy): PENDING' }
foreach ($name in @('CurlerTracker-VerifiedPublisher','CurlerTracker-ArchiveBackup')) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($task) { Write-Output "Schedule: $name $($task.State)" }
}
