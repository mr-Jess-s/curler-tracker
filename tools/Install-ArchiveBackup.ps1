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
Write-Output "Registered $Name daily at 02:30 local, interactive user sign-in required."
