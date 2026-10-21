$ErrorActionPreference = 'Stop'
$Server = Join-Path $PSScriptRoot 'Arthur-App-Server.mjs'
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not (Test-Path -LiteralPath $Server)) { throw 'Arthur app server is missing.' }
$Command = '& ''' + $Node.Replace("'", "''") + ''' ''' + $Server.Replace("'", "''") + '''; exit $LASTEXITCODE'
$Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -WindowStyle Hidden -EncodedCommand $Encoded"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'CurlerTracker-ArthurApp' -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName 'CurlerTracker-ArthurApp'
Write-Output 'Arthur app registered and started at http://127.0.0.1:8766/. Starts at Windows sign-in; serves the last successfully published build.'
