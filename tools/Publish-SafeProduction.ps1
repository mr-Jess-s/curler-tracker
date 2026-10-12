param(
    [switch]$Publish,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path $env:LOCALAPPDATA 'CurlerTracker\release-staging'
$StateDir = Join-Path $env:LOCALAPPDATA 'CurlerTracker'
$StateFile = Join-Path $StateDir 'last-published.json'
$Log = Join-Path $StateDir 'publisher.log'
$Scope = 'jess-and-roo'
$Production = 'https://curler-tracker.vercel.app'
$Vercel = 'C:\Program Files\nodejs\npx.cmd'
$Mutex = New-Object System.Threading.Mutex($false, 'CurlerTrackerVerifiedPublisher')
if (-not $Mutex.WaitOne(0, $false)) { Write-Output 'Publisher already running'; exit 0 }
try {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    if (-not (Test-Path $Vercel)) { throw 'Node.js npx.cmd is missing.' }
    if (-not (Test-Path (Join-Path $Root 'index.html'))) { throw 'Invalid project root.' }
    & node --check (Join-Path $Root 'app.js')
    if ($LASTEXITCODE -ne 0) { throw 'App JavaScript syntax failed.' }
    & node --check (Join-Path $Root 'sw.js')
    if ($LASTEXITCODE -ne 0) { throw 'Service worker syntax failed.' }
    & node (Join-Path $Root 'tools\Release-Regression.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Release regression failed.' }
    if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
    New-Item -ItemType Directory -Path $Stage -Force | Out-Null
    foreach ($name in @('index.html','app.js','styles.css','sw.js','manifest.webmanifest','noble-beaver.svg','noble-beaver-icon.svg')) {
        Copy-Item (Join-Path $Root $name) (Join-Path $Stage $name) -ErrorAction Stop
    }
    $DataOut = Join-Path $Stage 'data'
    New-Item -ItemType Directory -Path $DataOut -Force | Out-Null
    foreach ($name in @('home-summary.json','history-manifest.json')) {
        Copy-Item (Join-Path $Root ('data\' + $name)) (Join-Path $DataOut $name) -ErrorAction Stop
    }
    foreach ($folder in @('history','offline-curler-index')) {
        Copy-Item (Join-Path $Root ('data\' + $folder)) (Join-Path $DataOut $folder) -Recurse -ErrorAction Stop
    }
    $Files = @(Get-ChildItem $Stage -Recurse -File | Sort-Object FullName)
    if ($Files.Count -lt 45) { throw "Only $($Files.Count) release files: expected at least 45." }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($file in $Files) {
        if ($file.Extension -eq '.json') {
            $null = (Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop)
        }
        $relative = $file.FullName.Substring($Stage.Length + 1).Replace('\','/')
        $lines.Add($relative + ':' + (Get-FileHash -Algorithm SHA256 $file.FullName).Hash.ToLowerInvariant())
    }
    $joined = [string]::Join("\n", $lines)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($joined)) | ForEach-Object { $_.ToString('x2') })) }
    finally { $sha.Dispose() }
    $last = if (Test-Path $StateFile) { Get-Content $StateFile -Raw | ConvertFrom-Json } else { $null }
    Write-Output "Staged $($Files.Count) files; SHA256=$hash"
    if (-not $Publish) { Write-Output 'Validated dry-run. Use -Publish to deploy.'; exit 0 }
    if (-not $Force -and $last -and $last.hash -eq $hash) { Write-Output 'No changes since last successful publication.'; exit 0 }
    $VercelDir = Join-Path $Stage '.vercel'
    New-Item -ItemType Directory -Path $VercelDir -Force | Out-Null
    '{"projectId":"prj_pWqCMpUkL1XyEYwSLidOcP0pzMno","orgId":"team_SDHPInEQjiVcXhbuKPZtQ6CA","projectName":"curler-tracker"}' | Set-Content -Encoding ASCII (Join-Path $VercelDir 'project.json')
    $ErrorActionPreference = 'Continue'
    Push-Location $Stage
    try {
        $output = @(& $Vercel --yes vercel@63.1.2 deploy --prod --skip-domain --yes --scope $Scope 2>&1 | ForEach-Object { $_.ToString() })
        $exitCode = $LASTEXITCODE
    } finally { Pop-Location }
    $ErrorActionPreference = 'Stop'
    $output | Add-Content $Log
    if ($exitCode -ne 0) { throw "Vercel deployment failed with exit code $exitCode" }
    $url = ($output | Select-String -Pattern 'https://curler-tracker-[a-z0-9]+-jess-and-roo\.vercel\.app' -AllMatches | ForEach-Object {$_.Matches.Value} | Select-Object -Last 1)
    if (-not $url) { throw 'Vercel deployment URL not found in output.' }
    foreach ($path in @('/','/app.js','/data/home-summary.json','/data/history/mb.json','/data/offline-curler-index/a.json')) {
        $result = Invoke-WebRequest -Uri ($url + $path) -UseBasicParsing -TimeoutSec 40
        if ($result.StatusCode -ne 200 -or $result.RawContentLength -lt 100) { throw "Bad staged resource $path" }
    }
    $ErrorActionPreference = 'Continue'
    $promote = @(& $Vercel --yes vercel@63.1.2 promote $url --scope $Scope --yes 2>&1 | ForEach-Object {$_.ToString()})
    $ErrorActionPreference = 'Stop'
    $promote | Add-Content $Log
    if ($LASTEXITCODE -ne 0) { throw 'Vercel promotion failed.' }
    foreach ($path in @('/','/data/history/mb.json','/data/offline-curler-index/a.json')) {
        $response = Invoke-WebRequest -Uri ($Production + $path) -UseBasicParsing -TimeoutSec 40
        if ($response.StatusCode -ne 200 -or $response.RawContentLength -lt 100) { throw "Production verification failed for $path" }
    }
    @{ hash=$hash; published_at=(Get-Date).ToUniversalTime().ToString('o'); deployment=$url; files=$Files.Count } |
        ConvertTo-Json | Set-Content -Encoding UTF8 $StateFile
    Write-Output "PUBLISHED VERIFIED: $Production ($url)"
} catch {
    Add-Content -Path $Log -Value "$(Get-Date -Format o) ERROR $($_.Exception.Message)"
    Write-Output ('PUBLISH FAILED: ' + $_.Exception.Message)
    exit 1
} finally {
    $Mutex.ReleaseMutex() | Out-Null
    $Mutex.Dispose()
}
