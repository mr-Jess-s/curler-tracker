# Curler Tracker operations on Arthur

Public production: https://curler-tracker.vercel.app

Canonical working tree: C:\Jess\curler-tracker
Private archive: C:\Jess\curler-tracker\data\raw (never deploy or commit raw snapshots)
Normalized public website data: data/history, data/offline-curler-index, data/home-summary.json, data/history-manifest.json

## Independent operation without an LLM

- The existing collector supervisor starts with Windows sign-in and runs bounded Python maintenance jobs on Arthur.
- Collector source health and acquisition status are on disk at data/global/maintenance-state.json and data/global/collector-runtime.json.
- The release publisher stages ONLY the seven web entry files plus normalized public history/lookup data, validates JSON, runs JavaScript syntax checks and 24 regression tests, hashes staged files, deploys to Vercel, checks the staged URL, promotes and checks the public URL.
- If the staged content is unchanged, the publisher exits without redeploying.
- The publisher is scheduled daily at 07:00 local time, catches up on missed runs when Arthur is signed in, and requires ordinary network access and existing Vercel CLI sign-in on Arthur.
- It does not ask an LLM for routine ingest or release work and does not publish raw downloaded HTML, scans, or source credentials.

Manual health report:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\CurlerTracker-Health.ps1

Manual verified publication:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Publish-SafeProduction.ps1 -Publish

Manual publisher dry run (validates without deploying):
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Publish-SafeProduction.ps1

Install or repair publisher schedule:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Install-PublisherSchedule.ps1

Publisher logs/state: %LOCALAPPDATA%\CurlerTracker\publisher.log and last-published.json.

IMPORTANT: Curling I/O current-season registry can legitimately have zero entries for the specifically enumerated result-filtered association endpoints even when curling is happening elsewhere. An HTTP-200 with empty items is not evidence that no curling events exist. The live app uses source-specific lookups and separately qualified fallback data. Do not claim country or archive completeness based on empty lists.

Publishing is not a substitute for expanding adapters. New source families require explicit deterministic parsers and evidence-based validation. Arthur must be on and signed into Windows for the collector and scheduled publisher to run.

## Portable backup for personal devices

Arthur also copies the complete working project including the raw archive into the user's OneDrive sync folder at C:\Users\mrjes\OneDrive\CurlerTracker-Backup\project. Git history is preserved separately as the verified curler-tracker-repository.bundle, which can be cloned with git clone <bundle-file> <folder>.
The incremental backup runs daily at 02:30 when Arthur is signed in. It never deletes prior OneDrive files. OneDrive transfer to Microsoft's cloud and arrival on other devices depend on OneDrive synchronization and storage quota; the script records local copy success only, not cloud upload completion.
Manual backup:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Backup-CurlerTracker.ps1
Reinstall backup schedule:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\Install-ArchiveBackup.ps1
Health: %LOCALAPPDATA%\CurlerTracker\backup-state.json and backup.log.
