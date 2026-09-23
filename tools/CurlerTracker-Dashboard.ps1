param(
  [int]$RefreshSeconds = 15
)

$ErrorActionPreference = 'SilentlyContinue'
$ProjectRoot = 'C:\Jess\curler-tracker'
$StatusFile = Join-Path $ProjectRoot 'PROJECT_DASHBOARD_STATUS.json'

function Read-Status {
  if (-not (Test-Path $StatusFile)) { return $null }
  try { return (Get-Content $StatusFile -Raw | ConvertFrom-Json) } catch { return $null }
}

function Format-Countdown([datetime]$Target) {
  $now = Get-Date
  $span = $Target - $now
  if ($span.TotalSeconds -le 0) {
    $span = $now - $Target
    return ('OVER ETA by {0:00}h {1:00}m {2:00}s' -f [math]::Floor($span.TotalHours), $span.Minutes, $span.Seconds)
  }
  return ('{0:00}h {1:00}m {2:00}s' -f [math]::Floor($span.TotalHours), $span.Minutes, $span.Seconds)
}

function Write-Section($title) {
  Write-Host ''
  Write-Host ('=== {0} ===' -f $title) -ForegroundColor Cyan
}

while ($true) {
  Clear-Host
  $status = Read-Status
  $now = Get-Date

  Write-Host 'CURLER TRACKER - RELEASE DASHBOARD' -ForegroundColor White
  Write-Host ('Arthur | {0}' -f $now.ToString('yyyy-MM-dd HH:mm:ss')) -ForegroundColor DarkGray

  if (-not $status) {
    Write-Host ''
    Write-Host 'STATUS FILE MISSING OR INVALID' -ForegroundColor Red
    Start-Sleep -Seconds $RefreshSeconds
    continue
  }

  $target = [datetime]$status.eta_midpoint
  $earliest = [datetime]$status.eta_earliest
  $latest = [datetime]$status.eta_latest

  Write-Section 'CURRENT RELEASE'
  Write-Host ('Release target: {0}' -f $status.release_name)
  Write-Host ('ETA window:     {0}  to  {1}' -f $earliest.ToString('ddd MMM d, h:mm tt'), $latest.ToString('ddd MMM d, h:mm tt'))
  Write-Host ('Midpoint ETA:   {0}' -f $target.ToString('ddd MMM d, h:mm tt'))
  Write-Host ('Countdown:      {0}' -f (Format-Countdown $target)) -ForegroundColor Yellow
  Write-Host ('Estimate basis: {0}' -f $status.estimate_basis) -ForegroundColor DarkGray

  Write-Section 'MILESTONES'
  foreach ($m in $status.milestones) {
    $label = switch ($m.state) {
      'done'        { '[DONE]'; break }
      'in_progress' { '[WORK]'; break }
      'pending'     { '[WAIT]'; break }
      default       { '[....]' }
    }
    $color = switch ($m.state) {
      'done'        { 'Green'; break }
      'in_progress' { 'Yellow'; break }
      'pending'     { 'DarkGray'; break }
      default       { 'Gray' }
    }
    Write-Host ('{0} {1}' -f $label, $m.name) -ForegroundColor $color
  }

  Write-Section 'YOUR ATTENTION'
  if ($status.attention_required) {
    Write-Host 'YES - YOUR ATTENTION IS REQUIRED' -ForegroundColor Red
    foreach ($a in $status.attention_items) {
      Write-Host ('  -> {0}' -f $a) -ForegroundColor Red
    }
  } else {
    Write-Host 'NO - nothing currently needs your approval or action.' -ForegroundColor Green
    if ($status.next_approval_gate) {
      Write-Host ('Next likely approval gate: {0}' -f $status.next_approval_gate) -ForegroundColor DarkGray
    }
  }

  Write-Section 'PROJECT HEALTH'
  Push-Location $ProjectRoot
  $branch = (git branch --show-current)
  $dirty = @(git status --porcelain)
  $ahead = (git rev-list --count main..HEAD)
  node --check app.js 2>$null
  $nodeOk = ($LASTEXITCODE -eq 0)
  Pop-Location

  Write-Host ('Branch:         {0}' -f $branch)
  Write-Host ('Commits ahead:  {0}' -f $ahead)
  if ($dirty.Count -eq 0) {
    Write-Host 'Working tree:   CLEAN' -ForegroundColor Green
  } else {
    Write-Host ('Working tree:   {0} change(s)' -f $dirty.Count) -ForegroundColor Yellow
  }
  if ($nodeOk) {
    Write-Host 'JavaScript:     PASS' -ForegroundColor Green
  } else {
    Write-Host 'JavaScript:     FAIL' -ForegroundColor Red
  }

  Write-Section 'NOTES'
  Write-Host $status.note -ForegroundColor DarkGray
  Write-Host ''
  Write-Host ('Refreshes every {0}s. Press Ctrl+C to close.' -f $RefreshSeconds) -ForegroundColor DarkGray

  Start-Sleep -Seconds $RefreshSeconds
}
