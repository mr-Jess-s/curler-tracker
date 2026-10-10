$ErrorActionPreference = 'Stop'
$Root = 'C:\Jess\curler-tracker'
$Supervisor = Join-Path $Root 'tools\global_coverage\GlobalCurlingCollector-Supervisor.ps1'
if (-not (Test-Path -LiteralPath $Supervisor)) { throw "Collector supervisor not found: $Supervisor" }

$Startup = [Environment]::GetFolderPath('Startup')
if (-not $Startup) { throw 'Windows did not return a Startup folder for this user.' }
$ShortcutPath = Join-Path $Startup 'Curler Tracker Collector.lnk'
$PowerShell = Join-Path $PSHOME 'powershell.exe'
$Arguments = [string]::Format('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"', $Supervisor)

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShell
$Shortcut.Arguments = $Arguments
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = 'Starts the Curler Tracker background archive collector at sign-in.'
$Shortcut.Save()

$Process = Start-Process -FilePath $PowerShell -ArgumentList $Arguments -WindowStyle Hidden -PassThru
Write-Output "Startup entry installed: $ShortcutPath"
Write-Output "Started hidden collector supervisor (PID $($Process.Id))."
