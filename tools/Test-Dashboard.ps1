$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Dashboard-Model.ps1')
$root = Split-Path $PSScriptRoot -Parent
$base = Get-Content (Join-Path $PSScriptRoot 'Dashboard-Status.example.json') -Raw
$now = [datetimeoffset]::Parse('2026-09-24T12:00:00Z')
$count = 0
function Check($condition, $message) {
  if (-not $condition) { throw "FAIL: $message" }
  $script:count++; Write-Host "PASS: $message"
}
function Fixture {
  $s = $base | ConvertFrom-Json
  $s.verified_at = $now.ToString('o'); $s.estimate.verified_at = $now.ToString('o')
  $s.revision = 'test'; $s.product_fingerprint = 'test'
  $s.worker = $null
  return $s
}
function Model($s, $at = $now, $processes = @()) { Get-DashboardModel $s $at 'test' 'test' $processes }
$s = Fixture; $m = Model $s
Check ($m.Execution -eq 'PAUSED' -and -not $m.Live -and $m.MinHours -eq 3 -and $m.MaxHours -eq 6.5) 'Paused retains milestone estimate.'
$server = [pscustomobject]@{ ProcessId=123; CreationDate=$now; CommandLine='python -m http.server 8766' }
Check (-not (Model $s $now @($server)).Active) 'Preview server alone never counts as active work.'
$s.milestones[2].state = 'in_progress'
$s.worker = [pscustomobject]@{state='active';process_id=123;started_at=$now.ToString('o');heartbeat_at=$now.ToString('o');milestone_id='history';evidence='Verified validation output'}
$workerProcess = [pscustomobject]@{ ProcessId=123; CreationDate=$now; CommandLine='python validation.py' }
$m = Model $s $now @($workerProcess)
Check ($m.Execution -eq 'ACTIVE' -and $m.Live) 'Matching process and fresh evidence enable live estimate.'
$later = Model $s $now.AddSeconds(60) @($workerProcess)
Check ($later.MinHours -eq $m.MinHours -and $later.WindowEnd -eq $m.WindowEnd) 'Refresh does not consume hours or move release window.'
Check (-not (Model $s $now.AddSeconds(121) @($workerProcess)).Live) 'Stale heartbeat suspends ETA.'
Check (-not (Model $s).Live) 'Exited worker suspends ETA immediately.'
Check (-not (Model $s $now @($server)).Live) 'Even registered preview servers are rejected.'
$workerProcess.CreationDate = $now.AddHours(-1)
Check (-not (Model $s $now @($workerProcess)).Active) 'PID reuse cannot impersonate a worker.'
$workerProcess.CreationDate = $now
$s.worker.heartbeat_at = $now.AddMinutes(1).ToString('o')
Check (-not (Model $s $now @($workerProcess)).Active) 'Future heartbeat is rejected.'
$s.worker.heartbeat_at = $now.ToString('o')
$s.verified_at = $now.AddDays(-2).ToString('o'); $m = Model $s $now @($workerProcess)
Check ($m.Execution -eq 'STALE' -and -not $m.Live -and $m.EstimateValid) 'Stale status retains last estimate without live claims.'
$s.verified_at = $now.ToString('o'); $s.product_fingerprint = 'changed'
Check (-not (Model $s $now @($workerProcess)).Live) 'Dirty product changes invalidate verification.'
$s.product_fingerprint = 'test'; $s.estimate.verified_at = $now.AddDays(-2).ToString('o')
Check (-not (Model $s $now @($workerProcess)).Live) 'Stale estimate suspends live ETA with fresh worker.'
$s.estimate.verified_at = $now.AddHours(-7).ToString('o')
Check (-not (Model $s $now @($workerProcess)).Live) 'Expired release window requires re-estimation.'
$s.estimate.verified_at = $now.ToString('o'); $s.milestones[3].state = 'blocked'
Check ((Model $s $now @($workerProcess)).Execution -eq 'BLOCKED' -and -not (Model $s $now @($workerProcess)).Live) 'Blocked milestone suspends live forecast.'
$s.milestones[3].state = 'awaiting_approval'
Check ((Model $s $now @($workerProcess)).Execution -eq 'AWAITING APPROVAL') 'Approval gate is explicit.'
$s = Fixture; $s.milestones[2].remaining_hours_max = -1
Check (-not (Model $s).EstimateValid) 'Invalid range cannot create a forecast.'
$s = Fixture; $s.milestones[2].remaining_hours_min = $null
Check (-not (Model $s).EstimateValid) 'Missing estimates cannot undercount remaining work.'
$s = Fixture; $s.verified_at = 'bad timestamp'
Check ((Model $s).Execution -eq 'STALE') 'Malformed timestamp fails closed.'
$s = Fixture; $s.milestones[2].state = 'done'; $m = Model $s
Check ($m.MinHours -eq 2.5 -and $m.MaxHours -eq 5) 'Verified completed milestone removes only its own estimate.'
$s = Fixture; foreach ($milestone in $s.milestones) { $milestone.state = 'done' }
Check ((Model $s).Execution -eq 'COMPLETE' -and -not (Model $s).Live) 'Complete scope has no live countdown.'
$rejected = $false
try { Get-DashboardModel $null $now '' '' @() } catch { $rejected = $true }
Check $rejected 'Missing state fails closed.'
$s = Fixture; $s.milestones[2].state = 'invented'
$rejected = $false
try { Model $s } catch { $rejected = $true }
Check $rejected 'Unknown milestone state fails closed.'
Write-Host "$count dashboard checks passed."
