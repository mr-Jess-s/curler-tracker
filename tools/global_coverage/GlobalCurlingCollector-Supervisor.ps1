$ErrorActionPreference = 'Continue'
$Root = 'C:\Jess\curler-tracker'
$Worker = Join-Path $Root 'tools\global_coverage\maintenance_cycle.py'
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'global-collector.log'
$Mutex = New-Object System.Threading.Mutex($false, 'CurlerTrackerGlobalCollectorSupervisor')
if (-not $Mutex.WaitOne(0, $false)) { exit 0 }
try {
  while ($true) {
    Add-Content -Path $Log -Value "$(Get-Date -Format o) maintenance cycle"
    try {
      Set-Location $Root
      & python $Worker *>> $Log
    } catch {
      Add-Content -Path $Log -Value "$(Get-Date -Format o) maintenance exception: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 21600
  }
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}
