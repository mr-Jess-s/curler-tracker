param(
  [string]$Inbox = 'C:\Jess\curler-tracker\feedback-inbox',
  [string]$Output = 'C:\Jess\curler-tracker\feedback-summary.md'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Inbox | Out-Null

$files = @(Get-ChildItem $Inbox -Filter *.json -File -ErrorAction SilentlyContinue)
$records = New-Object System.Collections.Generic.List[object]
$invalid = New-Object System.Collections.Generic.List[string]

foreach($file in $files) {
  try {
    $record = Get-Content $file.FullName -Raw | ConvertFrom-Json
    if(-not $record.id -or -not $record.raw_user_wording) {
      $invalid.Add($file.Name)
      continue
    }
    $records.Add($record)
  } catch {
    $invalid.Add($file.Name)
  }
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# Curler Tracker feedback summary')
$lines.Add('')
$lines.Add(('Generated: {0}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')))
$lines.Add(('Valid submissions: {0}' -f $records.Count))
$lines.Add(('Invalid/unreadable files: {0}' -f $invalid.Count))
$lines.Add('')

$lines.Add('## Counts by type')
if($records.Count) {
  foreach($group in ($records | Group-Object type | Sort-Object Count -Descending)) {
    $lines.Add(('- {0}: {1}' -f $group.Name,$group.Count))
  }
} else {
  $lines.Add('- None')
}
$lines.Add('')

$lines.Add('## Counts by app version')
if($records.Count) {
  foreach($group in ($records | Group-Object app_version | Sort-Object Count -Descending)) {
    $lines.Add(('- {0}: {1}' -f $group.Name,$group.Count))
  }
} else {
  $lines.Add('- None')
}
$lines.Add('')

$lines.Add('## Submissions')
foreach($record in ($records | Sort-Object submitted_at)) {
  $lines.Add(('### {0}' -f $record.id))
  $lines.Add(('- Submitted: {0}' -f $record.submitted_at))
  $lines.Add(('- Type: {0}' -f $record.type))
  $lines.Add(('- App: {0}' -f $record.app_version))
  if($record.context.player) { $lines.Add(('- Player context: {0}' -f $record.context.player)) }
  if($record.context.view) { $lines.Add(('- View: {0}' -f $record.context.view)) }
  if($record.context.event) { $lines.Add(('- Event: {0}' -f $record.context.event)) }
  $lines.Add('')
  $lines.Add('> ' + (($record.raw_user_wording -replace '\r?\n',' ') -replace '>','\>'))
  $lines.Add('')
}

if($invalid.Count) {
  $lines.Add('## Invalid/unreadable files')
  foreach($name in $invalid) { $lines.Add(('- {0}' -f $name)) }
  $lines.Add('')
}

$lines.Add('## Review rule')
$lines.Add('This file is a mechanical summary only. Do not turn counts into product decisions without reviewing the raw submissions, reproducing factual defects where possible, and applying FEEDBACK_PROCESS.md.')

$lines -join [Environment]::NewLine | Set-Content $Output -Encoding UTF8
Write-Output ("Wrote {0}" -f $Output)
