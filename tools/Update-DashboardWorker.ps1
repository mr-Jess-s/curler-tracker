param(
  [int]$WorkerProcessId,
  [string]$MilestoneId,
  [string]$Evidence,
  [switch]$Stop,
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'
$path = Join-Path $ProjectRoot 'PROJECT_DASHBOARD_STATUS.json'
$s = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
if ($Stop) {
  $s.worker = $null
  foreach ($m in $s.milestones) { if ($m.state -eq 'in_progress') { $m.state = 'pending' } }
} else {
  if (-not $Evidence -or -not $WorkerProcessId -or -not $MilestoneId) { throw 'Process ID, milestone and observed progress evidence are required.' }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $WorkerProcessId"
  if (-not $p -or $p.CommandLine -match 'CurlerTracker-Dashboard|http.server|msedge|chrome') { throw 'An advancing worker process is required, not a dashboard or preview.' }
  $m = @($s.milestones | Where-Object id -eq $MilestoneId)
  if ($m.Count -ne 1 -or $m[0].state -notin 'pending','in_progress') { throw 'Select an unblocked unfinished milestone.' }
  foreach ($other in $s.milestones) { if ($other.state -eq 'in_progress') { $other.state = 'pending' } }
  $m[0].state = 'in_progress'
  $s.worker = [pscustomobject]@{
    state='active'; process_id=$WorkerProcessId; started_at=([datetimeoffset]$p.CreationDate).ToString('o')
    heartbeat_at=[datetimeoffset]::Now.ToString('o'); milestone_id=$MilestoneId; evidence=$Evidence
  }
}
# Do not touch verification or estimate timestamps merely to renew activity.
$temp = "$path.$([guid]::NewGuid().ToString('N')).tmp"
try {
  $s | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temp -Encoding UTF8
  [IO.File]::Replace($temp,$path,"$temp.bak")
} finally {
  foreach ($temporaryPath in @($temp, "$temp.bak")) {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
  }
}
