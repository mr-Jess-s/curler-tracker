$ErrorActionPreference = 'Stop'
$Publisher = Join-Path $PSScriptRoot 'Publish-CurlerTracker.ps1'
if (-not (Test-Path $Publisher)) { throw 'Publisher script missing' }
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $Publisher)
$Trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'CurlerTrackerProductionPublish' -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Get-ScheduledTask -TaskName 'CurlerTrackerProductionPublish' | Select-Object TaskName,State
