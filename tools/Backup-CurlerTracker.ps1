param([string]$Destination = 'C:\Users\mrjes\OneDrive\CurlerTracker-Release-Backup')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$Log = Join-Path $LogDir 'backup.log'
$StateFile = Join-Path $LogDir 'backup-state.json'
$Mutex = New-Object System.Threading.Mutex($false,'CurlerTrackerOneDriveBackup')
if (-not $Mutex.WaitOne(0,$false)) { Write-Output 'Backup already running'; exit 0 }
try {
  if (-not (Test-Path (Split-Path -Parent $Destination))) { throw 'OneDrive folder missing. Backup not started.' }
  New-Item $LogDir -ItemType Directory -Force | Out-Null
  New-Item $Destination -ItemType Directory -Force | Out-Null
  $tree = Join-Path $Destination 'project'
  New-Item $tree -ItemType Directory -Force | Out-Null
  & robocopy.exe $Root $tree /E /Z /FFT /R:2 /W:2 /MT:4 /NP /NFL /NDL /XD '.git' '__pycache__' '.venv' /XF '*.tmp' '*.partial' '*.lock' | Add-Content $Log
  $copyExit = $LASTEXITCODE
  if ($copyExit -ge 8) { throw "Robocopy failed exit=$copyExit" }
  $bundle = Join-Path $Destination 'curler-tracker-repository.bundle'
  Push-Location $Root
  try {
    & git bundle create $bundle --all
    if ($LASTEXITCODE -ne 0) { throw 'git bundle create failed' }
    $ErrorActionPreference = 'Continue'
    & git bundle verify $bundle 2>&1 | ForEach-Object { $_.ToString() } | Add-Content $Log
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'git bundle verify failed' }
  } finally { Pop-Location }
  Push-Location $Root
  try {
    $sourceCommit = ((& git rev-parse HEAD) | Out-String).Trim()
    $sourceBranch = ((& git branch --show-current) | Out-String).Trim()
    $trackedClean = -not [bool](& git status --porcelain --untracked-files=no)
  } finally { Pop-Location }
  $projectFiles = @(Get-ChildItem -LiteralPath $tree -File -Recurse)
  $snapshot = @{
    copied_at = (Get-Date).ToUniversalTime().ToString('o')
    source = $Root
    source_commit = $sourceCommit
    source_branch = $sourceBranch
    tracked_clean = $trackedClean
    destination = $Destination
    robocopy_exit = $copyExit
    project_files = $projectFiles.Count
    project_bytes = ($projectFiles | Measure-Object -Property Length -Sum).Sum
    bundle_bytes = (Get-Item $bundle).Length
    bundle_sha256 = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash
    cloud_upload_verified = $false
  }
  $snapshot | ConvertTo-Json | Set-Content $StateFile -Encoding UTF8
  Write-Output "BACKUP COPIED: $Destination; Git history bundle verified. OneDrive cloud-upload completion is not independently verified."
} catch {
  Add-Content $Log "$(Get-Date -Format o) FAILED $($_.Exception.Message)"
  Write-Output "BACKUP FAILED: $($_.Exception.Message)"
  exit 1
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}
