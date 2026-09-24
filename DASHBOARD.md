# Project status dashboard
Run tools/CurlerTracker-Dashboard.ps1; add -Once for a single console report.
The existing Arthur desktop shortcut uses this same script.

## Meaning of the report
The bounded target is the friend-test beta, not completion of the historical archive.
The first section reports state, current work, next work, blockers and user attention.
The initial estimate is 3-6.5 focused hours plus unknown approval/external wait:
history integration review 0.5-1.5h; additional source validation 0.75-1.5h;
browser/mobile QA and routine fixes 1.5-3h; release preparation/verification 0.25-0.5h.
These are engineering estimates from the inspected remaining scope, with LOW confidence,
not historical velocity or a promise. Major defects and scope changes require revision.
The 18 passing Release-QA checks do not establish full browser acceptance or deployment.

## Evidence and freshness
PROJECT_DASHBOARD_STATUS.json is local and ignored by Git. A reference schema/initial
snapshot is tools/Dashboard-Status.example.json. Do not copy its dates as fresh evidence.
Status verification and estimates expire after 24 hours. A changed HEAD or release-input
fingerprint also invalidates the current status. Display refresh never updates evidence.
The fingerprint covers root product/reference files, all data, and non-dashboard tools.
Last commit, last verified progress, verification time and display refresh are separate.

Live forecasting requires an explicitly registered worker, matching PID AND process start
time, a named in-progress milestone, observed progress evidence and a heartbeat <=120s old.
Dashboard, browser and preview server processes cannot establish active work.
The worker/agent must renew evidence only when work is actually observed. A running PID
without a new heartbeat stops counting as active after 120s. Exited workers suspend on
the next display refresh. No heartbeat generator or background work is implied.

Use tools/Update-DashboardWorker.ps1 -WorkerProcessId <id> -MilestoneId <id>
-Evidence '<specific observed work>' to record actual activity. Run with -Stop when done.
This does not refresh status verification or estimates. Do not register idle shells.
For interactive work without an observable process, remain paused/unverified.

## Updating the planning estimate
Inspect the current repository, actual remaining scope and relevant test/source results.
Update each milestone's state, evidence, estimate_basis, remaining_hours_min and
remaining_hours_max. Never deduct elapsed wall-clock time. Only mark verified work done.
After verification, record the current revision (git rev-parse HEAD), product_fingerprint
(Get-ProductFingerprint after dot-sourcing tools/Dashboard-Model.ps1), verified_at,
estimate.verified_at, confidence, basis, last_verified_progress_at and last_verified_work.
Use ISO 8601 timestamps with an offset. Record blockers and attention items explicitly.
Write the complete JSON via a same-directory temporary file and atomic replacement.

Remaining hours are summed from unfinished milestones. Unknown/invalid estimates disable
the forecast rather than silently treating missing effort as zero. PAUSED, STALE, BLOCKED
and AWAITING APPROVAL suspend live ETA while retaining a labelled planning range.
A live calendar window is anchored to estimate.verified_at plus the range; refreshes never
move it. It is conditional on uninterrupted work and prompt approval. Once expired, it
requires re-estimation. Paused/stale reports give an effort range after resumption,
not an invented calendar date. Stale attention information is labelled unknown.
No live countdown is rendered.

## Verification and recovery
Run tools/Test-Dashboard.ps1 for deterministic active/paused/stale/gate/range tests.
Run tools/CurlerTracker-Dashboard.ps1 -Once for the real repository report.
Backups of the previous script and local status are in C:\Jess\Backups with
before-status-20260924 / before-20260924 names. Malformed/missing status fails closed.
Existing uncommitted product work is intentionally preserved.
