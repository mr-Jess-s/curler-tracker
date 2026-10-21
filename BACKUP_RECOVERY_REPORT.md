# Backup and recovery report

Evidence reconciled 2026-10-21T09:13:53.750522+00:00. Current machine-readable status: `RELEASE_EVIDENCE.json`.

Two separate backup streams protect the release worktree/Git bundle and private collector archive. Both were restored to isolated temporary directories today.

- Release: 2270 files, 109580790 bytes; zero mismatches/invalid files; Git clone, fsck, exact commit checkout and 39 regressions passed.
- Collector: 12119 files; zero mismatches/invalid files. See the detailed JSON for byte counts and source paths.
- Fresh backup task results were successful.

Evidence: `release-evidence/2026-10-21/release-restore.json` and `collector-restore.json`. These verify local recovery. OneDrive cloud delivery and recovery on another device remain unverified; they are not inferred from a local folder.
