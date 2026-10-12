param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stage = 'C:\Jess\CurlerTrackerRelease'
$StateDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$HashFile = Join-Path $StateDir 'last-production-content.sha256'
$Log = Join-Path $StateDir 'production-release.log'
$PublicUrl = 'https://curler-tracker-jess-and-roo.vercel.app/'
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
$Mutex = New-Object System.Threading.Mutex($false, 'CurlerTrackerProductionPublisher')
if (-not $Mutex.WaitOne(0, $false)) { Write-Output 'Release already running'; exit 0 }
try {
  $paths = @('index.html','app.js','styles.css','sw.js','manifest.webmanifest',
    'noble-beaver.svg','noble-beaver-icon.svg','data\home-summary.json',
    'data\history-manifest.json')
  $paths += @(Get-ChildItem (Join-Path $Root 'data\history') -File -Recurse | ForEach-Object { $_.FullName.Substring($Root.Length + 1) })
  $paths += @(Get-ChildItem (Join-Path $Root 'data\offline-curler-index') -File -Recurse | ForEach-Object { $_.FullName.Substring($Root.Length + 1) })
  $paths = @($paths | Sort-Object -Unique)
  $manifest = foreach ($rel in $paths) {
    $file = Join-Path $Root $rel
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing release file: $rel" }
    '{0}={1}' -f $rel, (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]::Join([Environment]::NewLine, $manifest))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $digest = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha.Dispose() }
  $previous = if (Test-Path $HashFile) { (Get-Content $HashFile -Raw).Trim() } else { '' }
  if ($previous -eq $digest) { Write-Output "NO_CHANGE $digest"; exit 0 }
  if ($DryRun) { Write-Output "DRY_RUN $digest files=$($paths.Count)"; exit 0 }
  Set-Location $Root
  & node '.\tools\Release-Regression.mjs' *>> $Log
  if ($LASTEXITCODE -ne 0) { throw 'Regression failed; production unchanged' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\tools\Release-QA.ps1' *>> $Log
  if ($LASTEXITCODE -ne 0) { throw 'Release QA failed; production unchanged' }
  $linkPath = Join-Path $Stage '.vercel\project.json'
  if (-not (Test-Path $linkPath)) { throw 'Release staging is not linked to Vercel' }
  $link = Get-Content $linkPath -Raw | ConvertFrom-Json
  if ($link.projectId -ne 'prj_pWqCMpUkL1XyEYwSLidOcP0pzMno' -or
      $link.orgId -ne 'team_SDHPInEQjiVcXhbuKPZtQ6CA') { throw 'Wrong Vercel project or team' }
  Get-ChildItem -LiteralPath $Stage -Force | Where-Object { $_.Name -ne '.vercel' } | Remove-Item -Recurse -Force
  foreach ($rel in $paths) {
    $dest = Join-Path $Stage $rel
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root $rel) -Destination $dest
  }
  $npx = 'C:\Program Files\nodejs\npx.cmd'
  if (-not (Test-Path $npx)) { throw 'Vercel CLI launcher missing' }
  $stdout = Join-Path $StateDir 'production-deploy.stdout.log'
  $stderr = Join-Path $StateDir 'production-deploy.stderr.log'
  $proc = Start-Process -FilePath $npx -ArgumentList @('--yes','vercel@63.1.2',
    'deploy','--prod','--yes','--scope','jess-and-roo') -WorkingDirectory $Stage -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Get-Content $stdout -ErrorAction SilentlyContinue | Add-Content $Log
  Get-Content $stderr -ErrorAction SilentlyContinue | Add-Content $Log
  if ($proc.ExitCode -ne 0) { throw "Deployment exited $($proc.ExitCode)" }
  $response = Invoke-WebRequest -UseBasicParsing -Uri $PublicUrl -TimeoutSec 20
  if ($response.StatusCode -ne 200) { throw "Production HTTP $($response.StatusCode)" }
  Set-Content -LiteralPath $HashFile -Value $digest -Encoding ASCII
  Add-Content $Log "SUCCESS $(Get-Date -Format o) sha256=$digest"
  Write-Output "PUBLISHED $PublicUrl sha256=$digest"
} catch {
  Add-Content $Log "FAILED $(Get-Date -Format o) $($_.Exception.Message)"
  Write-Error $_.Exception.Message
  exit 1
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}
