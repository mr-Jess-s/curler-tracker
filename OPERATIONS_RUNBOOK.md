# Current reconciliation

Evidence reconciled 2026-10-21T09:13:53.750522+00:00. Current machine-readable status: `RELEASE_EVIDENCE.json`.

Arthur local app: `CurlerTracker-ArthurApp` starts at owner sign-in and serves the last successful published build on 127.0.0.1:8766. Reinstall using `tools\Install-ArthurApp.ps1`. It has three restart attempts; sign-in and power remain required. Source scripts are included in the release backup. Production and local source service are archive-backed; healthy does not mean complete/live source coverage. Budget remains zero; do not contact people without permission.

---

# Operations Runbook

Arthur owns routine operation; no LLM is required.

## Scheduled tasks

| Time | Task | Function |
|---|---|---|
| 01:00 local | `CurlerTracker-ArthurAutomation` | Refresh history, build indexes/shards, run QA, commit/push allowlisted data, back up |
| 02:30 local | `CurlerTracker-ArchiveBackup` | Release tree plus verified Git bundle |
| 03:00 local | `CurlerTracker-CollectorBackup` | Private raw/global archive |
| 07:00 local | `CurlerTracker-VerifiedPublisher` | Staged candidate, byte/service/security/rendered gates, promotion and rollback |
| Every 15 minutes | `CurlerTracker-OperationsHealth` | Data, collector, tasks, backups, disk, production identity and source service |

The collector supervisor starts once from the Windows Startup folder. All scheduled tasks require Arthur to be powered on and signed into Windows, refuse destructive overlap, and have execution limits.

## Operational locations

- Release worktree: `C:\Jess\curler-tracker-release-steps1-10`
- Collector worktree: `C:\Jess\curler-tracker`
- State/logs: `%LOCALAPPDATA%\CurlerTracker`
- Release branch: `origin/release/2026-10-13-readiness`

## Recovery and release

Run `python tools\Operations-Health.py` and inspect every check. A non-zero scheduled-task result, stale collector heartbeat, backup failure, deployment mismatch, or unhealthy source service blocks release.

Use `tools\Publish-VerifiedRelease.ps1 -DryRun` for local gates. Use `-DeployReviewedNow` only with a clean committed worktree and authorized Vercel team scope. The script records the prior production deployment, deploys without assigning the domain, validates the candidate, promotes only after all gates pass, and rolls back if production verification fails.

Never publish `data\raw`, `data\global`, credentials or tools. Never treat an empty upstream response as proof that no records exist. External alert delivery and physical-device UAT require owner-approved external resources.
