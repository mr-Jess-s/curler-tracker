# Backup and Recovery Report

Evidence date: 2026-10-18 UTC.

Arthur now runs two isolated, non-overlapping OneDrive backup tasks:

- `CurlerTracker-ArchiveBackup` at 02:30 backs up the clean release worktree to `CurlerTracker-Release-Backup` and creates/verifies a complete Git bundle.
- `CurlerTracker-CollectorBackup` at 03:00 backs up private `data\raw` and `data\global` to `CurlerTracker-Archive-Backup`.

Both tasks were invoked through Task Scheduler and returned result 0.

Release restore test:

- 1,964 files and 108,119,106 bytes restored to an isolated temporary directory.
- 1,486 raw files and 256 normalized JSON files validated.
- 0 mismatches and 0 invalid files.
- Git clone, full fsck, checkout of `916643c4f45e2f7ee893aceb5b2c394702cacb4f`, and 39 regression checks passed.

Collector restore test:

- 11,717 files and 1,864,186,726 bytes restored.
- 11,555 raw files and 162 normalized JSON files validated.
- 0 mismatches and 0 invalid files.

Cloud synchronization and restoration on another owner device are **not verified**. Local OneDrive paths and a sync client are not proof of remote completion.
