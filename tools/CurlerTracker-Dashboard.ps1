param(
  [ValidateRange(1,3600)][int]$RefreshSeconds = 15,
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$StatusFile,
  [switch]$Once
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Dashboard-Model.ps1')
if (-not $StatusFile) { $StatusFile = Join-Path $ProjectRoot 'PROJECT_DASHBOARD_STATUS.json' }
function Write-Section([string]$Title) { Write-Host ''; Write-Host $Title -ForegroundColor Cyan }
do {
  if (-not $Once) { Clear-Host }
  $now = [datetimeoffset]::Now
  Write-Host 'CURLER TRACKER | PROJECT STATUS' -ForegroundColor White
  Write-Host ('Arthur | Display refreshed: {0}' -f $now.ToString('yyyy-MM-dd HH:mm:ss zzz')) -ForegroundColor DarkGray
  try {
    $status = Get-Content -LiteralPath $StatusFile -Raw | ConvertFrom-Json
    $revision = ''; $fingerprint = ''; $branch = 'UNKNOWN'; $ahead = 'UNKNOWN'; $dirtyText = 'UNKNOWN'; $lastCommit = 'UNKNOWN'
    try {
      $revision = git -C $ProjectRoot rev-parse HEAD 2>$null
      if ($LASTEXITCODE -ne 0) { throw 'Git unavailable' }
      $branch = git -C $ProjectRoot branch --show-current
      $changes = @(git -C $ProjectRoot status --porcelain)
      if ($LASTEXITCODE -eq 0) { $dirtyText = if ($changes.Count) { "$($changes.Count) changed/untracked paths" } else { 'CLEAN' } }
      $aheadValue = git -C $ProjectRoot rev-list --count main..HEAD 2>$null
      if ($LASTEXITCODE -eq 0) { $ahead = $aheadValue }
      $lastCommit = git -C $ProjectRoot log -1 '--format=%h | %cI | %s'
      $fingerprint = Get-ProductFingerprint $ProjectRoot
    } catch { Write-Host ('Repository verification unavailable: ' + $_.Exception.Message) -ForegroundColor Yellow }
    $processes = @()
    try { $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop) }
    catch { Write-Host 'Worker check unavailable; live ETA suspended.' -ForegroundColor Yellow }
    $model = Get-DashboardModel $status $now $revision $fingerprint $processes
    Write-Section 'PROJECT STATUS'
    Write-Host ('Release: {0}' -f $status.release_name)
    Write-Host ('State: {0} | {1}/{2} milestones recorded complete' -f $model.Execution,$model.DoneCount,@($status.milestones).Count) -ForegroundColor Yellow
    Write-Host ('Status evidence verified: {0}' -f $status.verified_at)
    if (-not $model.Current) { Write-Host 'STALE: milestone and attention details below are last-known, not current.' -ForegroundColor Yellow }
    Write-Host ('Current work: {0}' -f $(if ($model.Execution -eq 'ACTIVE') { $status.worker.evidence } else { 'No currently verified advancing release work.' }))
    Write-Host ('Next: {0}' -f $status.next_work)
    $blocks = @($status.milestones | Where-Object { $_.state -in 'blocked','failed' })
    Write-Host ('Blockers: {0}' -f $(if ($blocks.Count) { ($blocks | ForEach-Object { $_.name + ': ' + $_.blocker }) -join '; ' } else { 'None recorded at last verification.' }))
    Write-Host ('Your attention: {0}' -f $(if ($status.attention_required -or $model.Execution -eq 'AWAITING APPROVAL') { 'REQUIRED' } elseif (-not $model.Current) { 'UNKNOWN - last record reported no action required' } else { 'No action currently required.' }))
    foreach ($item in $status.attention_items) { Write-Host ('  ' + $item) }
    Write-Host ('Next approval gate: {0}' -f $status.next_approval_gate)

    Write-Section 'RELEASE ESTIMATE'
    if ($model.EstimateValid) {
      Write-Host ('Planning estimate: {0:0.##}-{1:0.##} focused hours remaining + approval/external wait' -f $model.MinHours,$model.MaxHours) -ForegroundColor White
      Write-Host ('Estimate: {0} | Confidence: {1} | Verified: {2}' -f $(if ($model.EstimateFresh) { 'CURRENT' } else { 'LAST KNOWN / REVERIFY' }),$status.estimate.confidence,$status.estimate.verified_at)
      Write-Host ('Basis: {0}' -f $status.estimate.basis)
      if ($model.Live) {
        Write-Host ('Conditional release window: {0} to {1}' -f $model.WindowStart.ToString('MMM d HH:mm zzz'),$model.WindowEnd.ToString('MMM d HH:mm zzz'))
        Write-Host 'Assumes continuous focused work and prompt approval; delays require a new estimate.'
      } else {
        Write-Host ('Live ETA: SUSPENDED. {0}' -f $model.Reason) -ForegroundColor Yellow
        Write-Host ('Release outlook: {0:0.##}-{1:0.##} focused hours after work resumes, plus approval wait.' -f $model.MinHours,$model.MaxHours)
        Write-Host 'No calendar commitment while paused/stale. Last-known effort is retained, never counted down.'
      }
    } else { Write-Host 'Live ETA: SUSPENDED. Planning estimate unavailable: incomplete milestone estimates.' -ForegroundColor Yellow }
    Write-Host 'Long-term historical enrichment is ongoing and outside this bounded beta release.'

    Write-Section 'DONE / REMAINING MILESTONES'
    foreach ($m in $status.milestones) {
      $label = $m.state.ToUpper()
      if ($m.state -eq 'in_progress' -and ($model.Execution -ne 'ACTIVE' -or $m.id -ne $status.worker.milestone_id)) { $label = 'PENDING' }
      Write-Host ('[{0}] {1}{2}' -f $label,$m.name,$(if ($m.state -ne 'done') { ' | ' + $m.remaining_hours_min + '-' + $m.remaining_hours_max + 'h' }))
      Write-Host ('  Evidence: {0}' -f $m.evidence) -ForegroundColor DarkGray
    }
    Write-Section 'LAST VERIFIED PROGRESS / REPOSITORY'
    Write-Host ('{0} | {1}' -f $status.last_verified_progress_at,$status.last_verified_work)
    Write-Host ('Last commit: {0}' -f $lastCommit)
    Write-Host ('Branch: {0} | Ahead of main: {1} | Working tree: {2}' -f $branch,$ahead,$dirtyText)
    Write-Host ('Last release checks: {0}' -f $status.last_checks)
    Write-Host 'Passing recorded checks do not mean deployed or fully release-ready.'
  } catch {
    Write-Host ('STATUS UNAVAILABLE: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Live ETA suspended. Last-known file must be restored/reverified; refresh is not progress.'
  }
  if (-not $Once) { Write-Host ''; Write-Host "Refresh: $RefreshSeconds seconds. Ctrl+C closes."; Start-Sleep -Seconds $RefreshSeconds }
} while (-not $Once)
