# Operations Runbook

Arthur owns routine operation; no LLM is required.

## Scheduled tasks

- 01:00 local: `CurlerTracker-ArthurAutomation` — fetch, five-season incremental collection, index/summary build, regression/cache/name QA, allowlisted data commit/push, backup.
- Every 15 minutes: `CurlerTracker-OperationsHealth` — freshness, archive errors/count, index count, backup, Git bundle and disk.
- 07:00 local: `CurlerTracker-VerifiedPublisher` — clean allowlisted build, release gates, exact byte verification, production promotion and post-promotion verification.
- 02:30 local: `CurlerTracker-ArchiveBackup`.

Tasks ignore overlap and have execution limits. Failed validation stops publication. The publisher captures the previous production target and restores it if post-promotion verification fails.

## Operator checks

`Get-ScheduledTaskInfo -TaskName <name>` must show `LastTaskResult = 0`. Review `%LOCALAPPDATA%\CurlerTracker\operations-health.json` and task logs. On failure, preserve the last working production deployment, correct the source issue, run the relevant tests, then allow the verified publisher to promote.

Local monitoring cannot deliver an off-computer alert. Configure an owner-approved destination before treating monitoring as unattended incident response.
