# Production release report — 2026-10-16
Status: IN PROGRESS / NOT APPROVED FOR PUBLIC LAUNCH OR ADVERTISING.

## Verified baseline
Production: https://curler-tracker.vercel.app . Read-only check on Polly at 13:49 UTC returned app version v26.15.
Vercel CLI inspection on Arthur identified production deployment dpl_2SUeUnQud5GorUoaBDpwkvHA7feW, underlying URL https://curler-tracker-lrii7wp1u-jess-and-roo.vercel.app . The scheduled legacy publisher created it on October 16. Its Git commit is NOT independently established; do not equate the version string with a verified commit.
Baseline Git main: 34487688ba620fdc7120ae035dd088c549f55f89. Canonical Arthur worktree contains collector-generated data and prior repairs; no reset or blanket overwrite occurred.

## Candidate
Version v26.19, app/code commit 98b988ec507090f436958c38d1ae995417f635e5.
Branch release/2026-10-13-readiness.
Staging https://curler-tracker-cfsx8a51e-jess-and-roo.vercel.app
Deployment dpl_J4cAKNiWhJHNju3vXhpq3Ft1iTmq, READY. Manifest verification and rendered staging checks are in progress; READY alone is not acceptance.

## Implemented repairs
Exact published Farrol spelling now resolves two documentary sources and now refuses documentary results for the unverified Ferrol variant. Adversarial review reproduced that misleading variant outcome before the repair; the saved-snapshot key changed to exclude legacy results. Failed local archive requests no longer load unreviewed GitHub main data. The expanded regression suite passes34checks. Local partial historical records appear during bounded live checks. Search progress and incomplete outcomes remain distinct. Partial/ambiguous name matches cannot select an identity. Switching names aborts earlier fetches and guards delayed rendering. Back navigation restores the previous curler. Mobile tests assert actual 320/390/1365 px viewport widths. Source links require HTTPS. Service-worker cleanup targets only this application's caches. Public build uses an explicit allowlist and a per-file SHA256 manifest.

## Evidence
Before the final repairs, Polly repeated32regression checks, 38 browser checks and 18 source/release checks successfully. Python acquisition suite: 7; operations suite: 2; release gate: 3. These 100 checks do not equal full acceptance. Browser run 13:52:24 UTC used local preview and Edge 155, not physical Safari.
Fresh restoration test finished 06:32:04 UTC: 11,037 files; 1,642,624,913 bytes; no mismatches or invalid files; Git clone/fsck and restored regressions exit 0.
Arthur operations check 13:53:51 UTC: all 11 health checks passed. See linked reports and JSON evidence.

## Release decision
No final production promotion occurred in this work. The publisher now refuses missing exact-commit acceptance evidence; its existing schedule remains installed. Artwork/source rights, private correction channel, surge/upstream protection, complete accessibility/UAT, rollback rehearsal and final deployment evidence remain release gates. No claim of no known P0/P1 defects is justified.

The earlier v26.17/v26.18 deployments passed53file comparisons,38browser checks and bounded load probes; these do not substitute for final-candidate evidence. Staging-only alias rollback passed for each earlier candidate. Production's rollback endpoint remains unexercised.


## Final candidate verification — October16,14:20UTC
v26.19 /98b988ec507090f436958c38d1ae995417f635e5 passed the repeated suites:34application,38rendered browser,18source/release,7collector,2health,3release-gate,14security,12extendedEdge and12extendedChrome checks:140assertions,0failures in these suites. This excludes blocked acceptance gates and does not imply complete UAT.
All53served public files and release.json matched the staging build. Four axe views:0violations,0errors; one manual contrast item measured6.12:1 and received screenshot review. Static load60requests:0errors,p95=451.46ms. Staging-only rollback restored a6d6f81 then98b988e, verifying each manifest commit. Stable staging alias:https://curler-tracker-uat-20261016.vercel.app . Production remainsv26.15, reconfirmed14:21UTC.
These facts supersede earlier pending test statements. Public/advertising readiness remains BLOCKED: private privacy channel, source/artwork clearance, aggregate source traffic protection/incident delivery, physicalSafari/assistive-technology review and final production acceptance remain outstanding. No full unattended-publication or television-capacity claim is justified.

Final candidate restoration PASS at2026-10-16T14:22:13Z:11,045files,1,642,665,887bytes;10,699raw files,1,608,178,339bytes;205normalizedJSONvalid;0hash mismatches/invalid files;Git clone/fsck/checkout/regression exits0. The restored commit exactly matched98b988ec507090f436958c38d1ae995417f635e5 and all34regressions passed. Artifact:candidate-backup-restore.json. Cloud synchronization remainsunverified. This result supersedes the preceding pending-restoration statement.
