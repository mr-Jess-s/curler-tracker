# Operations runbook — 2026-10-16
Canonical collector: C:\Jess\curler-tracker on Arthur. Development/UAT: C:\Jess\curler-tracker-release-20261016 on Polly.
No routine collector step needs ChatGPT or another LLM. This does not eliminate operator responsibility.

## Actual schedules
Collector startup shortcut launches a mutex-protected supervisor. Maintenance subprocesses use a file lock, bounded task timeouts, retry/backoff and checkpoints. Supervisor checks every15minutes; task-specific frequencies range6hours to7days.
Backup daily02:30local. Health every15minutes, installed and actually returned0. Publisher daily07:00local remains scheduled but now fails closed without %LOCALAPPDATA%\CurlerTracker\release-acceptance.json matching the exact Git commit and mandatory evidence.
Legacy CurlerTrackerProductionPublish task is disabled.

## Routine inspection without ChatGPT
Run python tools\Operations-Health.py on Arthur. Exit0means configured freshness/disk checks pass;1requires investigation. Read %LOCALAPPDATA%\CurlerTracker\operations-health.json and global-collector.log. A heartbeat alone never proves successful collection. Confirm actual successful writes.
Run tools\Backup-CurlerTracker.ps1; then tools\Backup-Restore-Test.py into a separate temporary directory periodically.
Task Scheduler shows failure exit statuses. No outside alert recipient or independently monitored incident destination exists. Health currently records local failures, not guaranteed delivered alerts.

## Deployment
Use the existing project prj_pWqCMpUkL1XyEYwSLidOcP0pzMno and team team_SDHPInEQjiVcXhbuKPZtQ6CA only.
Commit/review changes, run deterministic+rendered tests, build a NEW directory with Build-PublicRelease.py. Preserve release.json.
Use independent staging, verify all served hashes with Verify-Deployment.py and repeat UAT.
A production release must stage with --prod --skip-domain, test that exact deployment, then promote. Do not promote a preview assuming identical production configuration.
Publish-SafeProduction.ps1 requires exact-commit acceptance and a rollback deployment, tests and an allowlisted clean build. It verifies hashes before and after promotion and attempts rollback on mismatch. Its real rollback branch has NOT passed rehearsal; do not mark it operationally accepted.
Pinned CLI63.1.2. Never print or transfer credentials. Existing Arthur login works; connector scope authorization failed403.

## Incident response
Preserve logs/checkpoints and current data. Do not retry a permission denial indefinitely or disable security controls. Keep last known public static build when collectors fail. Roll back to a verified prior deployment only after checking exact project/alias/commit. Then verify the old live bytes independently. Restore collector data only from a validated separate restore.
Disk threshold10GiBfree; backup freshness30h; current-season/offline/world/coverage12h; country registry48h; historical/home192h; world inventory96h.

## Remaining dependencies
Arthur must remain powered, networked and signed in. Source changes, credentials, privacy requests and failures need a designated operator. No paid always-on migration or external alerts occurred. Publisher remains gated, so fully unattended public-data publishing is not yet accepted.


## Verified UAT recovery target
Stable UAT alias:https://curler-tracker-uat-20261016.vercel.app . Final candidate URL:https://curler-tracker-cfsx8a51e-jess-and-roo.vercel.app ;commit98b988ec507090f436958c38d1ae995417f635e5.
Test-StagingRollback.ps1 restricts mutations to a dedicated curler-tracker-uat-*alias and validates both commit manifests. It passed for v26.19 with bounded propagation-read retries, ending on the candidate. Production alias/rollback endpoint did not change. The latest actual operations health check14:21:27Z passed11/11;scheduled health task's last result0. This is local monitoring, not delivered incident escalation.
