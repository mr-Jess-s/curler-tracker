# Curler Tracker operations on Arthur

Public production: https://curler-tracker.vercel.app
Current verified production identity is recorded in `RELEASE_EVIDENCE.json`.

## Worktrees and ownership

- Release automation: `C:\Jess\curler-tracker-release-steps1-10`.
- Collector/archive: `C:\Jess\curler-tracker`.
- Raw and global acquisition data remain private and are never included in the public build.
- The release worktree may be detached intentionally; `Run-Arthur-Automation.ps1` fast-forwards it only to `origin/release/2026-10-13-readiness`.

## Scheduled operation without an LLM

- 01:00: `CurlerTracker-ArthurAutomation` refreshes five-season history, builds deterministic indexes and name shards, runs regression/cache/name QA, commits only allowlisted public data, pushes, and backs up.
- 02:30: `CurlerTracker-ArchiveBackup` backs up the clean release tree and verified Git bundle.
- 03:00: `CurlerTracker-CollectorBackup` backs up private raw/global collector data separately.
- 07:00: `CurlerTracker-VerifiedPublisher` builds an allowlisted release, deploys a non-aliased production candidate, verifies exact bytes, security and rendered UAT, then promotes. A failed candidate cannot replace production.
- Every 15 minutes: `CurlerTracker-OperationsHealth` checks data freshness, collector heartbeat, both backups, scheduled-task results, disk, production identity and source-service health.
- The collector supervisor starts once from the Windows Startup folder and writes its heartbeat to `data\global\collector-runtime.json`.

All scheduled tasks require Arthur to be powered on and the owner signed into Windows. Overlap is refused and execution time is bounded.

## Operator commands

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Run-Arthur-Automation.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Publish-VerifiedRelease.ps1 -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Publish-VerifiedRelease.ps1 -DeployReviewedNow
python tools\Operations-Health.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Backup-CurlerTracker.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Backup-CurlerArchive.ps1
~~~

Logs and state are in `%LOCALAPPDATA%\CurlerTracker`. Confirm `LastTaskResult = 0` with `Get-ScheduledTaskInfo`. The Vercel CLI/account must be authorized for the `jess-and-roo` scope; an authorization failure is a hard stop, not a reason to bypass the staged-release gate.

OneDrive local copies do not prove cloud upload or restoration on another device. Local health evidence does not provide off-computer alert delivery.
