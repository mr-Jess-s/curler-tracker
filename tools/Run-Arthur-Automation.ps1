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
  function Run-GitLogged([string]$Name, [string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git @Arguments 2>&1 | ForEach-Object { $_.ToString() } | Add-Content -LiteralPath $Log
    $code = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($code -ne 0) { throw "$Name failed with exit code $code" }
  }
  Push-Location $Root
  try {
    $trackedChanges = @(& git status --porcelain --untracked-files=no)
    if ($trackedChanges.Count -gt 0) { throw 'Tracked changes exist before automation; refusing to overwrite operator work.' }
    Run-GitLogged 'release branch fetch' @('fetch','origin','release/2026-10-13-readiness')
    $current = (& git rev-parse HEAD).Trim()
    $remote = (& git rev-parse origin/release/2026-10-13-readiness).Trim()
    if ($current -ne $remote) {
      & git merge-base --is-ancestor $current $remote
      if ($LASTEXITCODE -ne 0) { throw 'Local automation commit diverged from the release branch; operator review is required.' }
      Run-GitLogged 'automation worktree fast-forward' @('switch','--detach',$remote)
    }
    if (-not $SkipHistory) {
      Run-Step 'merge-all-season-history' { python tools\Build-History-Index.py --merge-only --retain-from 'C:\Jess\curler-tracker\data\history' }
    }
    $env:CURLER_TRACKER_ARCHIVE_ROOT = 'C:\Jess\curler-tracker'
    try { Run-Step 'world-curler-index' { python tools\global_coverage\build_world_curler_index.py } }
    finally { Remove-Item Env:CURLER_TRACKER_ARCHIVE_ROOT -ErrorAction SilentlyContinue }
    Run-Step 'offline-name-index' { python tools\global_coverage\build_offline_curler_index.py }
    Run-Step 'verified-source-cache' { python tools\Build-Source-Cache.py --collector-root 'C:\Jess\curler-tracker' }
    Run-Step 'homepage-summary' { node tools\Build-Home-Summary.mjs }
    Run-Step 'release-regression' { node tools\Release-Regression.mjs }
    Run-Step 'cached-service-qa' { node tools\Cached-Service-QA.mjs }
    Run-Step 'name-resolution-qa' { node tools\Name-Resolution-QA.mjs }
    $changes = @(& git status --porcelain --untracked-files=no)
    foreach ($change in $changes) {
      $path = $change.Substring(3).Replace('\', '/')
      if ($path -notmatch '^data/(history/|history-manifest\.json$|world-curler-index\.json$|offline-curler-index/|name-catalog/|source-cache/|curler-name-catalog\.json$|home-summary\.json$)') {
        throw "Automation found a non-data change and refused to commit it: $path"
      }
    }
    if ($changes.Count -gt 0) {
      & git add -- data/history data/history-manifest.json data/world-curler-index.json data/offline-curler-index data/name-catalog data/source-cache data/curler-name-catalog.json data/home-summary.json
      if ($LASTEXITCODE -ne 0) { throw 'Could not stage verified archive data.' }
      Run-GitLogged 'verified archive commit' @('commit','-m',("Refresh verified curling archive " + (Get-Date -Format 'yyyy-MM-dd')))
      Run-GitLogged 'verified archive push' @('push','origin','HEAD:release/2026-10-13-readiness')
    }
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

