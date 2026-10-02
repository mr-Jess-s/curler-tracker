$ErrorActionPreference = 'Continue'
$Root = 'C:\Jess\curler-tracker'
$Worker = Join-Path $Root 'tools\global_coverage\continuous_world_results.py'
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'global-collector.log'
$Mutex = New-Object System.Threading.Mutex($false, 'CurlerTrackerGlobalCollectorSupervisor')
if (-not $Mutex.WaitOne(0, $false)) { exit 0 }
try {
  while ($true) {
    $stamp = Get-Date -Format o
    Add-Content -Path $Log -Value "$stamp supervisor tick"
    try {
      Set-Location $Root
      & python $Worker *>> $Log
    } catch {
      Add-Content -Path $Log -Value "$(Get-Date -Format o) worker exception: $($_.Exception.Message)"
    }
    $statusPath = Join-Path $Root 'data\global\collector-status.json'
    $state = ''
    if (Test-Path $statusPath) {
      try { $state = (Get-Content $statusPath -Raw | ConvertFrom-Json).state } catch {}
    }
    if ($state -eq 'complete') { Start-Sleep -Seconds 21600 } else { Start-Sleep -Seconds 120 }
  }
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}
