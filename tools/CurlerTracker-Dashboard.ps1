param([int]$RefreshSeconds = 15)

$ErrorActionPreference = 'SilentlyContinue'
$ProjectRoot = 'C:\Jess\curler-tracker'
$StatusFile = Join-Path $ProjectRoot 'PROJECT_DASHBOARD_STATUS.json'

function Read-Status {
  if (-not (Test-Path $StatusFile)) { return $null }
  try { return Get-Content $StatusFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Write-Section([string]$Title) {
  Write-Host ''
  Write-Host ('=== {0} ===' -f $Title) -ForegroundColor Cyan
}

function Get-ActiveBuildWorkers {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and
    $_.CommandLine -match [regex]::Escape($ProjectRoot) -and
    $_.CommandLine -notmatch 'CurlerTracker-Dashboard\.ps1' -and
    $_.Name -match 'powershell|pwsh|node|python|cmd'
  })
}

function Format-Age([datetime]$When) {
  $span = (Get-Date) - $When
  if ($span.TotalMinutes -lt 1) { return ('{0}s ago' -f [math]::Floor($span.TotalSeconds)) }
  if ($span.TotalHours -lt 1) { return ('{0}m ago' -f [math]::Floor($span.TotalMinutes)) }
  return ('{0}h {1}m ago' -f [math]::Floor($span.TotalHours), $span.Minutes)
}
while ($true) {
  Clear-Host
  $now = Get-Date
  $status = Read-Status

  Write-Host 'CURLER TRACKER - VERIFIED STATUS' -ForegroundColor White
  Write-Host ('Arthur | {0}' -f $now.ToString('yyyy-MM-dd HH:mm:ss')) -ForegroundColor DarkGray

  if (-not $status) {
    Write-Host 'STATUS FILE MISSING OR INVALID' -ForegroundColor Red
    Start-Sleep -Seconds $RefreshSeconds
    continue
  }

  Push-Location $ProjectRoot
  $branch = git branch --show-current
  $dirty = @(git status --porcelain)
  $ahead = [int](git rev-list --count main..HEAD)
  $lastCommitIso = git log -1 --format=%cI
  $lastCommit = [datetimeoffset]::Parse($lastCommitIso).LocalDateTime
  node --check app.js 2>$null
  $jsOk = ($LASTEXITCODE -eq 0)
  Pop-Location

  $workers = Get-ActiveBuildWorkers
  $active = $workers.Count -gt 0

  Write-Section 'CURRENT RELEASE'
  Write-Host ('Target:          {0}' -f $status.release_name)
  if ($active) {
    Write-Host 'Execution:       ACTIVE - verified build process detected' -ForegroundColor Green
  } else {
    Write-Host 'Execution:       PAUSED - no active build process detected' -ForegroundColor Yellow
  }
  Write-Host ('Last code commit: {0} ({1})' -f $lastCommit.ToString('ddd MMM d, h:mm:ss tt'), (Format-Age $lastCommit))
  Write-Host ('Status verified:  {0}' -f $now.ToString('ddd MMM d, h:mm:ss tt'))
  if ($status.eta_enabled -and $active -and $status.eta_target) {
    $target = [datetime]$status.eta_target
    $remaining = $target - $now
    if ($remaining.TotalSeconds -gt 0) {
      Write-Host ('ETA:             {0}' -f $target.ToString('ddd MMM d, h:mm tt'))
      Write-Host ('Countdown:       {0:00}h {1:00}m {2:00}s' -f [math]::Floor($remaining.TotalHours), $remaining.Minutes, $remaining.Seconds) -ForegroundColor Yellow
    } else {
      Write-Host 'ETA:             EXPIRED - must be re-estimated from verified remaining work' -ForegroundColor Red
    }
  } else {
    Write-Host 'ETA:             SUSPENDED until active work + credible estimate exist' -ForegroundColor DarkYellow
  }

  Write-Section 'MILESTONES'
  foreach ($m in $status.milestones) {
    $label = switch ($m.state) {
      'done' {'[DONE]'}
      'in_progress' {'[WORK]'}
      'awaiting_approval' {'[YOU ]'}
      'blocked' {'[BLOCK]'}
      default {'[WAIT]'}
    }
    $color = switch ($m.state) {
      'done' {'Green'}
      'in_progress' {'Yellow'}
      'awaiting_approval' {'Magenta'}
      'blocked' {'Red'}
      default {'DarkGray'}
    }
    Write-Host ('{0} {1}' -f $label, $m.name) -ForegroundColor $color
  }
  Write-Section 'YOUR ATTENTION'
  if ($status.attention_required) {
    Write-Host 'YES - action or approval required' -ForegroundColor Red
    foreach ($a in $status.attention_items) { Write-Host ('  -> {0}' -f $a) -ForegroundColor Red }
  } else {
    Write-Host 'NO - no user action currently blocks work.' -ForegroundColor Green
    if ($status.next_approval_gate) { Write-Host ('Next gate: {0}' -f $status.next_approval_gate) -ForegroundColor DarkGray }
  }

  Write-Section 'PROJECT HEALTH'
  Write-Host ('Branch:          {0}' -f $branch)
  Write-Host ('Commits ahead:   {0}' -f $ahead)
  Write-Host ('Working tree:    {0}' -f $(if($dirty.Count){$dirty.Count.ToString()+' change(s)'}else{'CLEAN'})) -ForegroundColor $(if($dirty.Count){'Yellow'}else{'Green'})
  Write-Host ('JavaScript:      {0}' -f $(if($jsOk){'PASS'}else{'FAIL'})) -ForegroundColor $(if($jsOk){'Green'}else{'Red'})
  Write-Host ('Build workers:   {0}' -f $workers.Count)

  Write-Section 'LAST VERIFIED WORK'
  Write-Host $status.last_verified_work -ForegroundColor White
  if ($status.note) { Write-Host $status.note -ForegroundColor DarkGray }

  Write-Host ''
  Write-Host ('Refreshes every {0}s. Ctrl+C closes this dashboard.' -f $RefreshSeconds) -ForegroundColor DarkGray
  Start-Sleep -Seconds $RefreshSeconds
}
