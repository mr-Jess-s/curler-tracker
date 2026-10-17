param([switch]$SkipHistory)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$Log = Join-Path $LogDir 'arthur-automation.log'
$Mutex = [Threading.Mutex]::new($false, 'CurlerTrackerArthurAutomation')
if (-not $Mutex.WaitOne(0)) { Write-Output 'Arthur automation is already running.'; exit 0 }
try {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  function Run-Step([string]$Name, [scriptblock]$Action) {
    Add-Content -LiteralPath $Log -Value "$(Get-Date -Format o) START $Name"
    & $Action *>> $Log
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
    Add-Content -LiteralPath $Log -Value "$(Get-Date -Format o) PASS $Name"
  }
  Push-Location $Root
  try {
    if (-not $SkipHistory) { Run-Step 'five-season-history' { python tools\Build-History-Index.py --max-workers 2 } }
    Run-Step 'offline-name-index' { python tools\global_coverage\build_offline_curler_index.py }
    Run-Step 'homepage-summary' { node tools\Build-Home-Summary.mjs }
    Run-Step 'release-regression' { node tools\Release-Regression.mjs }
    Run-Step 'cached-service-qa' { node tools\Cached-Service-QA.mjs }
    Run-Step 'name-resolution-qa' { node tools\Name-Resolution-QA.mjs }
    Run-Step 'backup' { powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tools\Backup-CurlerTracker.ps1 }
  } finally { Pop-Location }
} catch {
  Add-Content -LiteralPath $Log -Value "$(Get-Date -Format o) FAILED $($_.Exception.Message)"
  Write-Error $_
  exit 1
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}

