# Pure status decisions are separated from console rendering for deterministic tests.
function Convert-StatusTime($Value) {
  try {
    if (-not $Value -or [string]$Value -notmatch '(Z|[+-]\d\d:\d\d)$') { return $null }
    return [datetimeoffset]::Parse($Value)
  } catch { return $null }
}
function Test-FreshTime($Value, [datetimeoffset]$Now, [double]$MaxMinutes) {
  $time = Convert-StatusTime $Value
  return ($null -ne $time -and $time -le $Now -and ($Now - $time).TotalMinutes -le $MaxMinutes)
}
function Get-ProductFingerprint([string]$Root) {
  # Include dirty and untracked release inputs. Dashboard edits do not verify product work.
  $files = @(Get-ChildItem -LiteralPath $Root -File | Where-Object { $_.Extension -in '.js','.css','.html','.svg','.webmanifest','.md' -and $_.Name -notin 'DASHBOARD.md','feedback-summary.md' })
  $files += @(Get-ChildItem -LiteralPath (Join-Path $Root 'data') -File -Recurse -ErrorAction SilentlyContinue)
  $files += @(Get-ChildItem -LiteralPath (Join-Path $Root 'tools') -File | Where-Object { $_.Name -notmatch 'Dashboard' })
  $rows = @($files | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($Root.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 -ErrorAction Stop).Hash })
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($rows -join "\n")))).Replace('-','') }
  finally { $sha.Dispose() }
}
function Get-DashboardModel($Status, [datetimeoffset]$Now, [string]$Revision, [string]$Fingerprint, $Processes) {
  if (-not $Status -or $Status.schema_version -ne 2 -or -not $Status.release_name -or -not @($Status.milestones).Count) {
    throw 'Status file missing, invalid, or unsupported. No execution or ETA claims available.'
  }
  foreach ($m in $Status.milestones) {
    if (-not $m.id -or -not $m.name -or -not $m.evidence -or $m.state -notin 'done','pending','in_progress','blocked','failed','awaiting_approval') { throw 'Invalid milestone state or missing evidence.' }
  }
  if (@($Status.milestones.id | Select-Object -Unique).Count -ne @($Status.milestones).Count) { throw 'Duplicate milestone IDs.' }
  $fresh = Test-FreshTime $Status.verified_at $Now 1440
  $same = ($Revision -and $Fingerprint -and $Status.revision -eq $Revision -and $Status.product_fingerprint -eq $Fingerprint)
  $current = $fresh -and $same
  $worker = $Status.worker
  $active = $false
  if ($worker -and $worker.state -eq 'active' -and $worker.evidence -and (Test-FreshTime $worker.heartbeat_at $Now 2)) {
    $expectedStart = Convert-StatusTime $worker.started_at
    $matched = @($Processes | Where-Object {
      $_.ProcessId -eq $worker.process_id -and $expectedStart -and
      [math]::Abs((([datetimeoffset]$_.CreationDate) - $expectedStart).TotalSeconds) -lt 1 -and
      $_.CommandLine -notmatch 'CurlerTracker-Dashboard|http.server|msedge|chrome'
    })
    $active = $matched.Count -eq 1 -and @($Status.milestones | Where-Object { $_.id -eq $worker.milestone_id -and $_.state -eq 'in_progress' }).Count -eq 1
  }
  $remaining = @($Status.milestones | Where-Object { $_.state -ne 'done' })
  $blocked = @($remaining | Where-Object { $_.state -in 'blocked','failed' }).Count -gt 0
  $approval = @($remaining | Where-Object { $_.state -eq 'awaiting_approval' }).Count -gt 0
  $execution = if (-not $current) { 'STALE' } elseif ($blocked) { 'BLOCKED' } elseif ($approval) { 'AWAITING APPROVAL' } elseif ($remaining.Count -eq 0) { 'COMPLETE' } elseif ($active) { 'ACTIVE' } else { 'PAUSED' }
  $validEstimate = $null -ne (Convert-StatusTime $Status.estimate.verified_at)
  $min = 0.0; $max = 0.0
  foreach ($m in $remaining) {
    $lo = 0.0; $hi = 0.0
    $valid = $m.evidence -and $m.estimate_basis -and $null -ne $m.remaining_hours_min -and $null -ne $m.remaining_hours_max
    $valid = $valid -and [double]::TryParse([string]$m.remaining_hours_min, [ref]$lo) -and [double]::TryParse([string]$m.remaining_hours_max, [ref]$hi)
    if (-not $valid -or [double]::IsNaN($lo) -or [double]::IsInfinity($hi) -or $lo -lt 0 -or $hi -lt $lo) { $validEstimate = $false }
    $min += $lo; $max += $hi
  }
  $estimateFresh = $validEstimate -and $current -and (Test-FreshTime $Status.estimate.verified_at $Now 1440)
  $expired = $validEstimate -and (Convert-StatusTime $Status.estimate.verified_at).AddHours($max) -le $Now
  $live = $execution -eq 'ACTIVE' -and $estimateFresh -and -not $expired
  $reason = if (-not $current) { 'Status evidence is stale, unavailable, or the product has changed; reverify remaining work.' } elseif (-not $validEstimate) { 'Remaining milestone estimates are incomplete or invalid.' } elseif (-not $estimateFresh) { 'Estimate is stale; re-estimate remaining work.' } elseif ($expired) { 'Previous conditional window expired; re-estimate remaining work.' } elseif ($execution -ne 'ACTIVE') { 'No verified active work, or a release gate prevents a live forecast.' } else { 'Fresh remaining-work estimate and worker heartbeat verified.' }
  [pscustomobject]@{
    Execution=$execution; Active=$active; Current=$current; EstimateValid=$validEstimate
    EstimateFresh=$estimateFresh; Live=$live; Reason=$reason; MinHours=$min; MaxHours=$max
    Remaining=$remaining; DoneCount=@($Status.milestones | Where-Object state -eq 'done').Count
    # Anchor dates to the estimate, never to dashboard refresh or elapsed time.
    WindowStart=$(if ($validEstimate) { (Convert-StatusTime $Status.estimate.verified_at).AddHours($min) })
    WindowEnd=$(if ($validEstimate) { (Convert-StatusTime $Status.estimate.verified_at).AddHours($max) })
  }
}
