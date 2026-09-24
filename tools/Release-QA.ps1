param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = 'C:\Jess\curler-tracker'
$failures = New-Object System.Collections.Generic.List[string]
$passes = New-Object System.Collections.Generic.List[string]

function Pass([string]$Message) { $passes.Add($Message) }
function Fail([string]$Message) { $failures.Add($Message) }
function Check([bool]$Condition, [string]$Message) {
  if ($Condition) { Pass $Message } else { Fail $Message }
}

Push-Location $ProjectRoot
try {
  node --check app.js 2>$null
  Check ($LASTEXITCODE -eq 0) 'JavaScript syntax passes.'

  $app = Get-Content app.js -Raw
  $html = Get-Content index.html -Raw
  $sw = Get-Content sw.js -Raw

  $ids = [regex]::Matches($app, "getElementById\('([^']+)'\)") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  $missingIds = @($ids | Where-Object { $html -notmatch ('id="' + [regex]::Escape($_) + '"') })
  Check ($missingIds.Count -eq 0) ('All JavaScript element IDs exist in index.html' + $(if($missingIds.Count){': '+($missingIds -join ', ')}else{'.'}))

  $version = ([regex]::Match($app, "APP_VERSION = '([^']+)'")).Groups[1].Value
  Check ($html -match [regex]::Escape("app.js?v=$version")) "index.html loads app.js at $version."
  Check ($html -match [regex]::Escape("styles.css?v=$version")) "index.html loads styles.css at $version."
  Check ($sw -match [regex]::Escape("app.js?v=$version")) "Service worker caches app.js at $version."
  Check ($sw -match [regex]::Escape("styles.css?v=$version")) "Service worker caches styles.css at $version."

  Check ($app -notmatch 'return Number\(pos\?\.score \?\? pos\?\.total_score \?\? pos\?\.totalScore \?\? 0\)') 'Missing position scores are not converted into zero.'
  Check ($app -notmatch 'linked = !!ourPos \|\| aliasMatch') 'Alias text alone cannot assert that a game belongs to the tracked team.'
  Check ($app -match "careerLookbackSeasons: \[0, -1, -2\]") 'Recent career lookup is bounded to three Curling I/O seasons.'

  $base = 'https://api-curlingio.global.ssl.fastly.net/en/clubs/ab/events'
  $e2026 = Invoke-RestMethod -Uri "$base/24023" -TimeoutSec 20
  $e2025 = Invoke-RestMethod -Uri "$base/20424" -TimeoutSec 20
  $eU18  = Invoke-RestMethod -Uri "$base/20396" -TimeoutSec 20

  function Find-Curler($event, [int]$curlerId) {
    foreach($team in $event.teams) {
      foreach($curler in $team.lineup) {
        if([int]$curler.curler_id -eq $curlerId) {
          return [pscustomobject]@{ Curler=$curler; Team=$team }
        }
      }
    }
    return $null
  }

  $a = Find-Curler $e2026 49287
  $b = Find-Curler $e2025 49287
  $c = Find-Curler $eU18 49287
  Check ($null -ne $a) 'Source validation: curler ID 49287 appears in 2026 U20 Mixed Doubles event.'
  Check ($null -ne $b) 'Source validation: same source-native curler ID appears in 2025 U20 Women event.'
  Check ($null -ne $c) 'Source validation: same source-native curler ID appears in 2024/25 U18 qualifier.'
  if($a -and $b -and $c) {
    Check (($a.Curler.name -eq $b.Curler.name) -and ($b.Curler.name -eq $c.Curler.name)) 'Observed source records use the same published curler name across the validation path.'
  }

  foreach($subdomain in @('mb','canada')) {
    $list = Invoke-RestMethod -Uri "https://api-curlingio.global.ssl.fastly.net/en/clubs/$subdomain/competitions?occurred=-1&registrations=f" -TimeoutSec 20
    $published = @($list.items | Where-Object { $_.publish_results })[0]
    Check ($null -ne $published) ("$subdomain source exposes a published-results event for the prior season.")
    if($published) {
      $event = Invoke-RestMethod -Uri "https://api-curlingio.global.ssl.fastly.net/en/clubs/$subdomain/events/$($published.id)" -TimeoutSec 20
      $lineupRows = @($event.teams | ForEach-Object { $_.lineup } | Where-Object { $_ })
      Check (($event.teams.Count -gt 0) -and ($lineupRows.Count -gt 0)) ("$subdomain event payload exposes team and lineup records.")
    }
  }

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'tools\Summarize-Feedback.ps1') 2>$null | Out-Null
  Check ($LASTEXITCODE -eq 0) 'Feedback summarizer executes successfully.'
}
catch {
  Fail ("QA script exception: " + $_.Exception.Message)
}
finally {
  Pop-Location
}

Write-Host ''
Write-Host 'CURLER TRACKER RELEASE QA'
foreach($p in $passes) { Write-Host ("PASS  " + $p) -ForegroundColor Green }
foreach($f in $failures) { Write-Host ("FAIL  " + $f) -ForegroundColor Red }
Write-Host ''
Write-Host ("Passed: {0}  Failed: {1}" -f $passes.Count,$failures.Count)
if($failures.Count -gt 0) { exit 1 }
exit 0
