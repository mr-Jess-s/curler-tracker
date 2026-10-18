$ErrorActionPreference = 'Stop'
$Script = Join-Path $PSScriptRoot 'Backup-CurlerTracker.ps1'
if (-not (Test-Path $Script)) { throw "Missing $Script" }
$Name = 'CurlerTracker-ArchiveBackup'
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"') -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$Trigger = New-ScheduledTaskTrigger -Daily -At 02:30
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
$CollectorScript = Join-Path $PSScriptRoot 'Backup-CurlerArchive.ps1'
if (-not (Test-Path $CollectorScript)) { throw "Missing $CollectorScript" }
$CollectorAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $CollectorScript + '"') -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$CollectorTrigger = New-ScheduledTaskTrigger -Daily -At 03:00
Register-ScheduledTask -TaskName 'CurlerTracker-CollectorBackup' -Action $CollectorAction -Trigger $CollectorTrigger -Principal $Principal -Settings $Settings -Force | Out-Null
Write-Output "Registered $Name at 02:30 and CurlerTracker-CollectorBackup at 03:00 daily; interactive user sign-in required."
