param(
    [switch]$Publish,
    [switch]$Force,
    [string]$AcceptanceFile
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$Log = Join-Path $StateDir 'publisher.log'
$Production = 'https://curler-tracker.vercel.app'
$Vercel = 'C:\Program Files\nodejs\npx.cmd'
$Python = (Get-Command python.exe -ErrorAction Stop).Source
$Mutex = New-Object System.Threading.Mutex($false, 'CurlerTrackerVerifiedPublisher')
if (-not $Mutex.WaitOne(0, $false)) { Write-Output 'Publisher already running'; exit 0 }
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
try {
    if (-not $AcceptanceFile) { $AcceptanceFile = Join-Path $StateDir 'release-acceptance.json' }
    if ($Publish) {
        & $Python (Join-Path $PSScriptRoot 'Check-ReleaseGate.py') $AcceptanceFile
        if ($LASTEXITCODE -ne 0) { throw 'Release acceptance blocked. Existing production remains unchanged.' }
        $Acceptance = Get-Content $AcceptanceFile -Raw | ConvertFrom-Json
    }
    & node --check (Join-Path $Root 'app.js')
    if ($LASTEXITCODE -ne 0) { throw 'App syntax failed.' }
    & node --check (Join-Path $Root 'sw.js')
    if ($LASTEXITCODE -ne 0) { throw 'Service worker syntax failed.' }
    & node (Join-Path $PSScriptRoot 'Release-Regression.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed.' }
    & node (Join-Path $PSScriptRoot 'Cached-Service-QA.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Cached service tests failed.' }
    & node (Join-Path $PSScriptRoot 'Name-Resolution-QA.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Name-resolution tests failed.' }
    & powershell.exe -NoLogo -NoProfile -File (Join-Path $PSScriptRoot 'Release-QA.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Source verification failed.' }
    $Stage = Join-Path $StateDir ('release-' + [guid]::NewGuid().ToString('N'))
    & $Python (Join-Path $PSScriptRoot 'Build-PublicRelease.py') $Stage
    if ($LASTEXITCODE -ne 0) { throw 'Clean allowlisted build failed.' }
    if (-not $Publish) { Write-Output "Validated dry-run: $Stage. No deployment."; exit 0 }
    $VercelDir = Join-Path $Stage '.vercel'
    New-Item -ItemType Directory -Path $VercelDir | Out-Null
    '{"projectId":"prj_pWqCMpUkL1XyEYwSLidOcP0pzMno","orgId":"team_SDHPInEQjiVcXhbuKPZtQ6CA","projectName":"curler-tracker"}' | Set-Content -Encoding ASCII (Join-Path $VercelDir 'project.json')
    Push-Location $Stage
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Vercel --yes vercel@63.1.2 deploy --prod --skip-domain --yes --scope jess-and-roo 2>&1 | ForEach-Object {$_.ToString()})
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
    } finally { Pop-Location }
    $output | Add-Content $Log
    if ($code -ne 0) { throw 'Staged production deployment failed; public alias unchanged.' }
    $url = ($output | Select-String -Pattern 'https://curler-tracker-[a-z0-9]+-jess-and-roo\.vercel\.app' -AllMatches | ForEach-Object {$_.Matches.Value} | Select-Object -Last 1)
    if (-not $url) { throw 'Deployment URL missing; no promotion.' }
    & $Python (Join-Path $PSScriptRoot 'Verify-Deployment.py') $url $Stage --out (Join-Path $Stage 'staging-verification.json')
    if ($LASTEXITCODE -ne 0) { throw 'Staged deployed bytes differ; no promotion.' }
    & $Vercel --yes vercel@63.1.2 promote $url --scope jess-and-roo --yes
    if ($LASTEXITCODE -ne 0) { throw 'Promotion failed; inspect alias before any retry.' }
    & $Python (Join-Path $PSScriptRoot 'Verify-Deployment.py') $Production $Stage --out (Join-Path $Stage 'production-verification.json')
    if ($LASTEXITCODE -ne 0) {
        & $Vercel --yes vercel@63.1.2 rollback $Acceptance.rollback_deployment --scope jess-and-roo --yes
        if ($LASTEXITCODE -ne 0) { throw 'Production verification AND rollback failed. Immediate operator action required.' }
        throw 'Production verification failed; rollback requested. Verify old release independently.'
    }
    $manifest = Get-Content (Join-Path $Stage 'release.json') -Raw | ConvertFrom-Json
    @{commit=$manifest.commit; version=$manifest.version; deployment=$url; published_at=(Get-Date).ToUniversalTime().ToString('o'); evidence=$Stage} |
        ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $StateDir 'last-published.json')
    Write-Output "PUBLISHED AND BYTE VERIFIED: $Production ($url)"
} catch {
    Add-Content $Log "$(Get-Date -Format o) BLOCKED/FAILED $($_.Exception.Message)"
    Write-Output $_.Exception.Message
    exit 1
} finally {
    $Mutex.ReleaseMutex() | Out-Null
    $Mutex.Dispose()
}
