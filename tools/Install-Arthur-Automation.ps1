$ErrorActionPreference = 'Stop'
$Runner = Join-Path $PSScriptRoot 'Run-Arthur-Automation.ps1'
if (-not (Test-Path -LiteralPath $Runner)) { throw 'Arthur automation runner is missing.' }
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $Runner)
$Trigger = New-ScheduledTaskTrigger -Daily -At '01:00'
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'CurlerTracker-ArthurAutomation' -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Get-ScheduledTask -TaskName 'CurlerTracker-ArthurAutomation' | Select-Object TaskName, State
