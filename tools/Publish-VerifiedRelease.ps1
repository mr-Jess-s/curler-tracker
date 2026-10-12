param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stage = 'C:\Jess\CurlerTrackerRelease'
$Cli = 'C:\Program Files\nodejs\npx.cmd'
$LogDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$Log = Join-Path $LogDir 'publisher.log'
$DigestFile = Join-Path $LogDir 'last-published-sha256.txt'
$Mutex = [Threading.Mutex]::new($false, 'CurlerTrackerVerifiedPublisher')
if (-not $Mutex.WaitOne(0)) { Write-Output 'Another publisher is running.'; exit 0 }
try {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  function Note([string]$Value) {
    $message = "$(Get-Date -Format o) $Value"
    Add-Content -LiteralPath $Log -Value $message
    Write-Output $message
  }
  if (-not (Test-Path -LiteralPath $Cli)) { throw 'Pinned deployment CLI launcher missing.' }
  $core = @('index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'noble-beaver.svg', 'noble-beaver-icon.svg')
  $data = @('data\home-summary.json', 'data\history-manifest.json')
  foreach ($path in ($core + $data)) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $path))) { throw "Missing release asset: $path" }
  }
  foreach ($dir in @('data\history', 'data\offline-curler-index')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $dir))) { throw "Missing release directory: $dir" }
  }
  Push-Location $Root
  try {
    & node --check app.js
    if ($LASTEXITCODE -ne 0) { throw 'App syntax check failed.' }
    & node --check sw.js
    if ($LASTEXITCODE -ne 0) { throw 'Service worker syntax check failed.' }
    & node tools\Release-Regression.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Release regression suite failed.' }
    & git diff --quiet HEAD -- $core
    if ($LASTEXITCODE -ne 0) { throw 'Uncommitted website changes detected; refusing automatic publication.' }
  } finally { Pop-Location }
  $sources = foreach ($path in ($core + $data)) { Get-Item -LiteralPath (Join-Path $Root $path) }
  $sources += Get-ChildItem (Join-Path $Root 'data\history') -File -Recurse
  $sources += Get-ChildItem (Join-Path $Root 'data\offline-curler-index') -File -Recurse
  if (($sources | Measure-Object).Count -lt 20) { throw 'Refusing unexpectedly small release set.' }
  $newest = ($sources | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
  if (-not $DryRun -and $newest -gt (Get-Date).ToUniversalTime().AddMinutes(-5)) {
    Note 'Release data is being updated; deferring until it is stable.'
    exit 0
  }
  $fingerprints = $sources | Sort-Object FullName | ForEach-Object {
    "$($_.FullName.Substring($Root.Length)) $((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = ([BitConverter]::ToString(
      $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($fingerprints -join "`n")))
    )).Replace('-', '')
  } finally { $sha.Dispose() }
  $old = if (Test-Path -LiteralPath $DigestFile) { (Get-Content -LiteralPath $DigestFile -Raw).Trim() } else { '' }
  Note "Release assets=$($sources.Count) digest=$digest changed=$($digest -ne $old)"
  if ($digest -eq $old) { Note 'No new verified assets; nothing to deploy.'; exit 0 }
  if ($DryRun) { Note 'Dry-run passed; no deployment executed.'; exit 0 }
  New-Item -ItemType Directory -Force -Path $Stage | Out-Null
  foreach ($path in $core) { Copy-Item -LiteralPath (Join-Path $Root $path) -Destination (Join-Path $Stage $path) -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'data') | Out-Null
  foreach ($path in $data) { Copy-Item -LiteralPath (Join-Path $Root $path) -Destination (Join-Path $Stage $path) -Force }
  foreach ($dir in @('data\history', 'data\offline-curler-index')) {
    $dest = Join-Path $Stage $dir
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force -Recurse }
    Copy-Item -LiteralPath (Join-Path $Root $dir) -Destination $dest -Recurse
  }
  $link = Join-Path $Stage '.vercel\project.json'
  if (-not (Test-Path -LiteralPath $link)) { throw 'Release staging is not linked to Vercel.' }
  $project = Get-Content -LiteralPath $link -Raw | ConvertFrom-Json
  if ($project.projectId -ne 'prj_pWqCMpUkL1XyEYwSLidOcP0pzMno' -or $project.orgId -ne 'team_SDHPInEQjiVcXhbuKPZtQ6CA') {
    throw 'Refusing unexpected Vercel project or team.'
  }
  $logFile = Join-Path $LogDir 'latest-publisher-deployment.log'
  Push-Location $Stage
  try {
    & $Cli --yes vercel@63.1.2 deploy --prod --yes --scope jess-and-roo *> $logFile
    $rc = $LASTEXITCODE
  } finally { Pop-Location }
  if ($rc -ne 0) { throw "Vercel deployment failed ($rc); inspect $logFile." }
  $healthy = $false
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try {
      $response = Invoke-WebRequest 'https://curler-tracker.vercel.app/' -UseBasicParsing -TimeoutSec 20
      if ($response.StatusCode -eq 200 -and $response.Content -match 'Curler Tracker') { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 4
  }
  if (-not $healthy) { throw 'Deployment finished, but production smoke check did not pass.' }
  Set-Content -LiteralPath $DigestFile -Value $digest -Encoding ASCII
  Note 'Production release verified and digest recorded.'
} catch {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Add-Content -LiteralPath $Log -Value "$(Get-Date -Format o) FAILED: $($_.Exception.Message)"
  Write-Error $_
  exit 1
} finally {
  $Mutex.ReleaseMutex() | Out-Null
  $Mutex.Dispose()
}