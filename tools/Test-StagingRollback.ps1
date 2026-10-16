param(
  [string]$Alias = 'curler-tracker-uat-20261016.vercel.app',
  [string]$Candidate = 'https://curler-tracker-niyl9jl83-jess-and-roo.vercel.app',
  [string]$CandidateCommit = '579245420579b1c0945361a39f1a36bb007d21fc',
  [string]$Previous = 'https://curler-tracker-at8honw8l-jess-and-roo.vercel.app',
  [string]$OutputFile = 'release-evidence\2026-10-16\staging-rollback.json'
)
$ErrorActionPreference = 'Stop'
if ($Alias -notmatch '^curler-tracker-uat-[a-z0-9-]+\.vercel\.app$') { throw 'Only a dedicated UAT alias is permitted.' }
foreach ($url in @($Candidate, $Previous)) {
  if ($url -notmatch '^https://curler-tracker-[a-z0-9]+-jess-and-roo\.vercel\.app$') { throw 'Unexpected project deployment URL.' }
}
$cli = 'C:\Program Files\nodejs\npx.cmd'
$new = Invoke-RestMethod ($Candidate + '/release.json') -TimeoutSec 30
$old = Invoke-RestMethod ($Previous + '/release.json') -TimeoutSec 30
if ($CandidateCommit -notmatch '^[a-f0-9]{40}$' -or $new.commit -ne $CandidateCommit -or $old.commit -ne 'a6d6f816918862d699e7bbc131b333f2e37750df') { throw 'Unexpected rehearsal build identity.' }
$steps = @()
foreach ($step in @(@{name='candidate';url=$Candidate;commit=$new.commit}, @{name='rollback';url=$Previous;commit=$old.commit}, @{name='restore_candidate';url=$Candidate;commit=$new.commit})) {
  & $cli --yes vercel@63.1.2 alias set $step.url $Alias --scope jess-and-roo
  if ($LASTEXITCODE -ne 0) { throw 'UAT alias mutation failed; inspect before retry.' }
  # New aliases and reassignment can briefly return 404 or the preceding build.
  # Retry reads only; never resubmit a successful mutation to mask a read failure.
  $ok = $false
  $served = $null
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try {
      $served = Invoke-RestMethod ('https://' + $Alias + '/release.json') -TimeoutSec 10
      $ok = $served.commit -eq $step.commit
      if ($ok) { break }
    } catch { Write-Output ('Waiting for UAT alias propagation: ' + $_.Exception.Message) }
    Start-Sleep -Seconds 2
  }
  $steps += @{step=$step.name;expected_commit=$step.commit;actual_commit=$served.commit;passed=$ok;timestamp=(Get-Date).ToUniversalTime().ToString('o')}
  if (-not $ok) { throw 'UAT alias serves an unexpected build.' }
}
$report = @{timestamp=(Get-Date).ToUniversalTime().ToString('o');alias=('https://' + $Alias);steps=$steps;passed=$true;scope='Staging alias rollback only; production alias and production rollback endpoint were not exercised.'}
New-Item -ItemType Directory -Path (Split-Path -Parent $OutputFile) -Force | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $OutputFile
$report | ConvertTo-Json -Depth 6
