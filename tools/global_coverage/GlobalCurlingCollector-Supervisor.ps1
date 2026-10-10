$ErrorActionPreference = 'Continue'
$Root = 'C:\Jess\curler-tracker'
$Worker = Join-Path $Root 'tools\global_coverage\maintenance_cycle.py'
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'global-collector.log'
$Runtime = Join-Path $Root 'data\global\collector-runtime.json'
$CycleOut = Join-Path $LogDir 'global-collector.stdout.log'
$CycleErr = Join-Path $LogDir 'global-collector.stderr.log'
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Curler Tracker Collector.lnk'
$Mutex = New-Object System.Threading.Mutex($false, 'CurlerTrackerGlobalCollectorSupervisor')
if (-not $Mutex.WaitOne(0, $false)) { exit 0 }

$PythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
$Python = if ($PythonCommand) { $PythonCommand.Source } else { $null }
if (-not $Python) {
  $PythonCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
    'C:\Program Files\Python313\python.exe',
    'C:\Program Files\Python312\python.exe'
  )
  $Python = $PythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Write-CollectorStatus([string]$Phase) {
  $status = [ordered]@{
    process_id = $PID
    phase = $Phase
    heartbeat_at = (Get-Date).ToUniversalTime().ToString('o')
    startup_registered = (Test-Path -LiteralPath $StartupLink)
    python_path = $Python
  }
  $temp = "$Runtime.tmp"
  $status | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $Runtime -Force
}

try {
  while ($true) {
    Add-Content -Path $Log -Value "$(Get-Date -Format o) maintenance cycle"
    Write-CollectorStatus 'acquiring'
    try {
      if (-not $Python) { throw 'Python was not found on PATH or in the supported per-user install locations.' }
      $child = Start-Process -FilePath $Python -ArgumentList @($Worker) -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $CycleOut -RedirectStandardError $CycleErr
      while (-not $child.HasExited) {
        Write-CollectorStatus 'acquiring'
        Start-Sleep -Seconds 60
        $child.Refresh()
      }
      if (Test-Path $CycleOut) { Get-Content -LiteralPath $CycleOut | Add-Content -Path $Log }
      if (Test-Path $CycleErr) { Get-Content -LiteralPath $CycleErr | Add-Content -Path $Log }
      Add-Content -Path $Log -Value "$(Get-Date -Format o) maintenance exit=$($child.ExitCode)"
    } catch {
      Add-Content -Path $Log -Value "$(Get-Date -Format o) maintenance exception: $($_.Exception.Message)"
    }
    Write-CollectorStatus 'idle'
    for ($minute = 0; $minute -lt 15; $minute++) {
      Start-Sleep -Seconds 60
      Write-CollectorStatus 'idle'
    }
  }
} finally {
  Write-CollectorStatus 'stopped'
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}
