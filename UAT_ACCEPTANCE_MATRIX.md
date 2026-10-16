# UAT acceptance matrix — 2026-10-16
Candidate v26.19; code98b988ec507090f436958c38d1ae995417f635e5. Earlier evidence below retains its actual build; final candidate reruns remain separate.
PASS applies only to the stated scope. The local browser suite ran on preceding code commit 3ad2ba2; subsequent change only made the feedback background explicit. Staging regression is required.

| Requirement | Status | Actual evidence / result |
|---|---|---|
| Exact identity, source provenance, unknown scores and stale-response guards | PASS | Release-Regression.mjs, 32/32, Polly Oct16 ~13:51 UTC; repeated from prior 32/32 run |
| Rendered first visit, seasons, source links, Farrol/Jody/Adam, race/fault/offline/back navigation | PASS | browser-local-repeat.json, 38/38, 13:52:24Z, Edge155, 3ad2ba2 |
| Actual 320/390/1365px widths with no horizontal overflow | PASS | Named viewport assertions in same browser artifact |
| Farrol exact spelling and two documentary citations | PASS | Same artifact: documented-history, 2 references; incomplete live status retained |
| Live authoritative ID/roster source consistency and asset/version checks | PASS | Release-QA.ps1, 18/18, Polly Oct16 ~13:53Z; raw log capture pending |
| Collector conditional acquisition, retries and atomic persistence | PASS | Python test_*.py suite, 7/7, Polly ~13:53Z; no live sources in fixtures |
| Health failures cannot hide behind a heartbeat | PASS | Test-OperationsHealth.py, 2/2, same session |
| Missing/stale/blocked acceptance rejects publication | PASS | Test-ReleaseGate.py, 3/3; canonical direct gate rejects absent acceptance file |
| Backup restoration and Git recovery | PASS | backup-restore.json, finished06:32:04Z, source main backup, no mismatches, exit0 |
| Actual successful collection and disk/backup freshness | PASS | operations-health.json, 13:53:51Z, 11/11; fresh output writes13:23Z |
| Automated accessibility subset | PASS | axe-core4.14 on four local views: zero violations; one manual contrast item remains |
| Complete WCAG2.2AA, human screen reader and physical iPhone Safari | BLOCKED | Automated checks cannot certify these; no physical/AT test evidence |
| Final staging hashes and staging rendered checks | PASS | v26.19:staging-v2619-verification.json,14:18:47Z,53files+manifest match;staging-browser.json,14:19:22Z,38/38 |
| Full requested functional UAT (share delivery, expired cache, reload during search, alternate spelling, slow network) | BLOCKED | Some regression coverage exists; not every rendered interaction has evidence |
| Load/capacity and bounded aggregate upstream traffic | FAIL | Static probe passed60requests,0errors,p95=451.46ms;clients still call source APIs directly without a shared aggregate request ceiling |
| Private privacy/correction handling and media/source rights | BLOCKED | No configured private channel or clearance evidence supplied |
| Rollback rehearsal, incident alert delivery, unattended recovery | BLOCKED | Staging alias rehearsal passed14:19:19Z;production rollback endpoint remains untested;log-only health needs an operator |
| Production byte/commit verification of final candidate | BLOCKED | Candidate not promoted |
| Every country/territory surveyed | FAIL | Existing registry covers80 World Curling members, not every jurisdiction |
| Cloud backup sync to other devices | BLOCKED | OneDrive runs, but remote cloud/file integrity has not been verified |
| Purchase advertising or contact broadcasters | NOT APPLICABLE | Neither requested nor performed |

No failed mandatory row may be converted to PASS because implementation code exists.

Additional measured staging evidence (v26.17/v26.18): Security-Deployment-QA.py14/14; Extended-Browser-QA.py12/12 on Edge155 and12/12 on Chrome154. Share/download actions stayed inside isolated fixtures, without contacting anyone. Feedback contrast6.12:1; screenshot inspection found no text obstruction. These do not certify screen-reader or physical-Safari behaviour.


## Final v26.19 evidence addendum (supersedes pending staging rows)
All artifacts below target98b988ec507090f436958c38d1ae995417f635e5.

| Test/gate scope | Status | Timestamp / evidence / actual result |
|---|---|---|
| Application regressions incl. unverified spelling and off-branch fallback rejection | PASS | Polly14:20Z;regression.log;34/34 |
| Rendered staging suite | PASS |14:19:22Z;staging-browser.json;38/38 |
| Keyboard/share/feedback/cache/motion/slow-network Edge | PASS |14:19:44Z;extended-browser.json;12/12 |
| Same extended interactions Chrome154 | PASS |14:19:56Z;extended-browser-chrome.json;12/12 |
| Transport/header/private-path staging | PASS |14:20:01Z;security-deployment.json;14/14 |
| Deployed candidate bytes and manifest | PASS |14:18:47Z;staging-v2619-verification.json;53files+manifest match |
| Small static controlled load probe | PASS |14:18:59Z;controlled-load-v2619.json;60requests,0errors,p95=451.46ms |
| Staging alias rollback and restoration | PASS |14:19:19Z;staging-rollback-v2619.json;3/3commit transitions |
| Automated axe subset | PASS |14:19:33Z;accessibility.json;0violations,0errors across4views |
| Flagged contrast manual/computed review | PASS |14:19:44Z;extended-browser.json+feedback-manual-review.png;6.12:1, no observed text obstruction |

Full WCAG/physicalSafari, all requested UAT edge cases, production rollback endpoint, sensitive-correction workflow, production final build and television capacity remain BLOCKED/FAIL as stated above. Staging-only rollback does not certify production rollback. Do not sum repeated historical runs as unique test cases.
