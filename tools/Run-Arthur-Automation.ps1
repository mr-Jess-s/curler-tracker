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
    $trackedChanges = @(& git status --porcelain --untracked-files=no)
    if ($trackedChanges.Count -gt 0) { throw 'Tracked changes exist before automation; refusing to overwrite operator work.' }
    & git fetch origin release/2026-10-13-readiness *>> $Log
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the release branch.' }
    $current = (& git rev-parse HEAD).Trim()
    $remote = (& git rev-parse origin/release/2026-10-13-readiness).Trim()
    if ($current -ne $remote) {
      & git merge-base --is-ancestor $current $remote
      if ($LASTEXITCODE -ne 0) { throw 'Local automation commit diverged from the release branch; operator review is required.' }
      & git switch --detach $remote *>> $Log
      if ($LASTEXITCODE -ne 0) { throw 'Could not fast-forward the automation worktree.' }
    }
    if (-not $SkipHistory) { Run-Step 'five-season-history' { python tools\Build-History-Index.py --max-workers 2 } }
    Run-Step 'offline-name-index' { python tools\global_coverage\build_offline_curler_index.py }
    Run-Step 'homepage-summary' { node tools\Build-Home-Summary.mjs }
    Run-Step 'release-regression' { node tools\Release-Regression.mjs }
    Run-Step 'cached-service-qa' { node tools\Cached-Service-QA.mjs }
    Run-Step 'name-resolution-qa' { node tools\Name-Resolution-QA.mjs }
    $changes = @(& git status --porcelain --untracked-files=no)
    foreach ($change in $changes) {
      $path = $change.Substring(3).Replace('\', '/')
      if ($path -notmatch '^data/(history/|history-manifest\.json$|offline-curler-index/|curler-name-catalog\.json$|home-summary\.json$)') {
        throw "Automation found a non-data change and refused to commit it: $path"
      }
    }
    if ($changes.Count -gt 0) {
      & git add -- data/history data/history-manifest.json data/offline-curler-index data/curler-name-catalog.json data/home-summary.json
      if ($LASTEXITCODE -ne 0) { throw 'Could not stage verified archive data.' }
      & git commit -m ("Refresh verified curling archive " + (Get-Date -Format 'yyyy-MM-dd')) *>> $Log
      if ($LASTEXITCODE -ne 0) { throw 'Could not commit verified archive data.' }
      & git push origin HEAD:release/2026-10-13-readiness *>> $Log
      if ($LASTEXITCODE -ne 0) { throw 'Could not push verified archive data.' }
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

