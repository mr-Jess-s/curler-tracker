$ErrorActionPreference = 'Stop'
$Runner = Join-Path $PSScriptRoot 'Run-Arthur-Automation.ps1'
if (-not (Test-Path -LiteralPath $Runner)) { throw 'Arthur automation runner is missing.' }
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $Runner)
$Trigger = New-ScheduledTaskTrigger -Daily -At '01:00'
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'CurlerTracker-ArthurAutomation' -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
$Publisher = Join-Path $PSScriptRoot 'Publish-VerifiedRelease.ps1'
if (-not (Test-Path -LiteralPath $Publisher)) { throw 'Verified publisher is missing.' }
$PublishAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $Publisher)
$PublishTrigger = New-ScheduledTaskTrigger -Daily -At '07:00'
$PublishSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'CurlerTracker-VerifiedPublisher' -Action $PublishAction -Trigger $PublishTrigger -Settings $PublishSettings -Force | Out-Null
$Health = Join-Path $PSScriptRoot 'Operations-Health.py'
if (-not (Test-Path -LiteralPath $Health)) { throw 'Operations health monitor is missing.' }
$Python = (Get-Command python.exe -ErrorAction Stop).Source
$HealthAction = New-ScheduledTaskAction -Execute $Python -Argument ('"{0}"' -f $Health)
$HealthTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 15)
$HealthSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'CurlerTracker-OperationsHealth' -Action $HealthAction `
    -Trigger $HealthTrigger -Settings $HealthSettings -Force | Out-Null
Get-ScheduledTask -TaskName 'CurlerTracker-ArthurAutomation','CurlerTracker-VerifiedPublisher','CurlerTracker-OperationsHealth' | Select-Object TaskName, State
