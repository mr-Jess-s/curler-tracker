# Backup and recovery — 2026-10-16
Local OneDrive destination on Arthur: C:\Users\mrjes\OneDrive\CurlerTracker-Backup.
Manual backup06:28:42Z, robocopy3(success with differences), Git bundle verification succeeded.
Scheduled subsequent backup07:30:04Z, robocopy3. Arthur health13:53:51Z considers it fresh.

Safe restore to a new temporary directory started06:29:30Z and finished06:32:04Z:
11,037files;1,642,624,913bytes;10,696raw files/1,608,145,821bytes;205normalizedJSONvalidated.
SHA256 source/restore mismatches0; invalidJSON/gzip0; git clone0; git fsck0; restored regression0.
Artifact: release-evidence/2026-10-16/backup-restore.json.
This tests the canonical main backup, not the later v26.17 release branch. The later source commits must also remain pushed/recoverable.

Daily02:30local scheduled task uses StartWhenAvailable, nonoverlap and2hlimit. Windows user sign-in and a powered/networked Arthur remain operational dependencies.
OneDrive process exists, but that does NOT prove cloud upload or synchronization to another device. Cloud recovery gate remains BLOCKED.
Recovery: copy backup project to a separate new directory; clone the repository bundle to another new directory; run git fsck, Release-Regression.mjs, JSON/gzip integrity and hash comparisons using Backup-Restore-Test.py. Inspect failures before replacing any production/canonical data. Never restore over the only surviving copy.


A new local backup succeeded14:20:06Z, robocopy3;the operations check14:21:27Z passed. A second restore now selects exact release98b988ec507090f436958c38d1ae995417f635e5 from the Git bundle before regressions. Its actual result will be stored as candidate-backup-restore.json;until that artifact exists, do not infer completion. Cloud sync remainsunverified.

Final candidate restoration PASS at2026-10-16T14:22:13Z:11,045files,1,642,665,887bytes;10,699raw files,1,608,178,339bytes;205normalizedJSONvalid;0hash mismatches/invalid files;Git clone/fsck/checkout/regression exits0. The restored commit exactly matched98b988ec507090f436958c38d1ae995417f635e5 and all34regressions passed. Artifact:candidate-backup-restore.json. Cloud synchronization remainsunverified. This result supersedes the preceding pending-restoration statement.
