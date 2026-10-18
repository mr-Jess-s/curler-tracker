param(
  [string]$Source = 'C:\Jess\curler-tracker',
  [string]$Destination = 'C:\Users\mrjes\OneDrive\CurlerTracker-Archive-Backup'
)
$ErrorActionPreference = 'Stop'
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$Log = Join-Path $LogDir 'collector-backup.log'
$StateFile = Join-Path $LogDir 'collector-backup-state.json'
$Mutex = [Threading.Mutex]::new($false, 'CurlerTrackerCollectorBackup')
if (-not $Mutex.WaitOne(0)) { Write-Output 'Collector backup already running'; exit 0 }
try {
  New-Item -ItemType Directory -Force -Path $LogDir,$Destination | Out-Null
  $records = @()
  foreach ($relative in @('data\global','data\raw')) {
    $from = Join-Path $Source $relative
    if (-not (Test-Path -LiteralPath $from)) { throw "Missing collector archive: $from" }
    $to = Join-Path $Destination $relative
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    & robocopy.exe $from $to /E /Z /FFT /R:2 /W:2 /MT:4 /NP /NFL /NDL /XF '*.tmp' '*.partial' '*.lock' | Add-Content $Log
    $copyExit = $LASTEXITCODE
    if ($copyExit -ge 8) { throw "Robocopy failed for $relative exit=$copyExit" }
    $files = @(Get-ChildItem -LiteralPath $to -File -Recurse)
    $records += [ordered]@{path=$relative;robocopy_exit=$copyExit;files=$files.Count;bytes=($files|Measure-Object Length -Sum).Sum}
  }
  [ordered]@{
    copied_at=(Get-Date).ToUniversalTime().ToString('o')
    source=$Source
    destination=$Destination
    archives=$records
    cloud_upload_verified=$false
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StateFile -Encoding UTF8
  Write-Output "COLLECTOR BACKUP COPIED: $Destination. OneDrive cloud-upload completion is not independently verified."
} catch {
  Add-Content $Log "$(Get-Date -Format o) FAILED $($_.Exception.Message)"
  Write-Error $_
  exit 1
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}
