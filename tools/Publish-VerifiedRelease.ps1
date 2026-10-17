param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Cli = 'C:\Program Files\nodejs\npx.cmd'
$Python = (Get-Command python.exe -ErrorAction Stop).Source
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
  $core = @('index.html', 'privacy.html', 'robots.txt', 'sitemap.xml', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'package.json', 'vercel.json', 'api\curling-io.js', 'noble-beaver.svg', 'noble-beaver-icon.svg')
  $data = @('data\home-summary.json', 'data\history-manifest.json', 'data\curler-name-catalog.json', 'data\curler-source-records.json')
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
    & node tools\Cached-Service-QA.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cached service QA failed.' }
    & node tools\Name-Resolution-QA.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Name-resolution QA failed.' }
    $dirty = & git status --porcelain --untracked-files=no
    if ($dirty) { throw 'Uncommitted tracked changes detected; refusing automatic publication.' }
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
  $Stage = Join-Path $LogDir ('verified-release-' + [guid]::NewGuid().ToString('N'))
  & $Python (Join-Path $PSScriptRoot 'Build-PublicRelease.py') $Stage
  if ($LASTEXITCODE -ne 0) { throw 'Clean allowlisted release build failed.' }
  $linkDir = Join-Path $Stage '.vercel'
  New-Item -ItemType Directory -Force -Path $linkDir | Out-Null
  '{"projectId":"prj_pWqCMpUkL1XyEYwSLidOcP0pzMno","orgId":"team_SDHPInEQjiVcXhbuKPZtQ6CA","projectName":"curler-tracker"}' |
    Set-Content -LiteralPath (Join-Path $linkDir 'project.json') -Encoding ASCII
  $logFile = Join-Path $LogDir 'latest-publisher-deployment.log'
  $priorFile = Join-Path $Stage 'prior-production.json'
  & $Cli --yes vercel@63.1.2 inspect https://curler-tracker.vercel.app --json --scope jess-and-roo 1> $priorFile 2>> $logFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not identify the current production deployment; refusing publication without rollback target.' }
  $prior = Get-Content -LiteralPath $priorFile -Raw | ConvertFrom-Json
  if (-not $prior.url -or $prior.readyState -ne 'READY') { throw 'Current production deployment is not a verified rollback target.' }
  Push-Location $Stage
  try {
    & $Cli --yes vercel@63.1.2 deploy --prod --skip-domain --yes --scope jess-and-roo *> $logFile
    $rc = $LASTEXITCODE
  } finally { Pop-Location }
  if ($rc -ne 0) { throw "Vercel deployment failed ($rc); inspect $logFile." }
  $deployment = (Get-Content -LiteralPath $logFile | Select-String -Pattern 'https://[^ ]+\.vercel\.app' -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -Last 1)
  if (-not $deployment) { throw 'Candidate deployment URL was not found in the deployment log.' }
  $candidateEvidence = Join-Path $Stage 'candidate-verification.json'
  & $Python (Join-Path $PSScriptRoot 'Verify-Deployment.py') $deployment $Stage --out $candidateEvidence
  if ($LASTEXITCODE -ne 0) { throw 'Candidate deployment bytes did not match the reviewed build; production was not changed.' }
  & $Cli --yes vercel@63.1.2 promote $deployment --yes --scope jess-and-roo *>> $logFile
  if ($LASTEXITCODE -ne 0) { throw 'Candidate passed smoke tests but promotion failed; existing production remains available.' }
  $productionEvidence = Join-Path $Stage 'production-verification.json'
  & $Python (Join-Path $PSScriptRoot 'Verify-Deployment.py') https://curler-tracker.vercel.app $Stage --out $productionEvidence
  if ($LASTEXITCODE -ne 0) {
    & $Cli --yes vercel@63.1.2 rollback ('https://' + $prior.url) --yes --scope jess-and-roo *>> $logFile
    if ($LASTEXITCODE -ne 0) { throw 'Production verification and automatic rollback both failed; operator action is required.' }
    throw 'Production verification failed; the prior verified deployment was restored.'
  }
  $manifest = Get-Content -LiteralPath (Join-Path $Stage 'release.json') -Raw | ConvertFrom-Json
  [ordered]@{commit=$manifest.commit;version=$manifest.version;deployment=$deployment;prior_deployment=('https://' + $prior.url);published_at=(Get-Date).ToUniversalTime().ToString('o');evidence=$Stage} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $LogDir 'last-published.json') -Encoding UTF8
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
