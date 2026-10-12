$ErrorActionPreference = 'Stop'
$Script = Join-Path $PSScriptRoot 'Publish-SafeProduction.ps1'
if (-not (Test-Path -LiteralPath $Script)) { throw "Missing $Script" }
$TaskName = 'CurlerTracker-VerifiedPublisher'
$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '" -Publish'
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$Trigger = New-ScheduledTaskTrigger -Daily -At 07:00
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
$task = Get-ScheduledTask -TaskName $TaskName
Write-Output "Registered $($task.TaskName): $($task.State) under $User; daily at 07:00 local, missed-run catchup enabled."
