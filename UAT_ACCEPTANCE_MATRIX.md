# UAT Acceptance Matrix

Evidence date: 2026-10-18 UTC. Candidate: v26.21 / `3a551ed`.

| Requirement | Status | Evidence |
|---|---|---|
| Public website responds | PASS | Public `release.json` returned v26.21 / `ffa60f3` |
| Candidate syntax and deterministic regression | PASS | 39/39 release checks; 4/4 cache checks |
| Exact and typo identity resolution | PASS | 71/71 exact; 64/64 severe; 284/284 realistic |
| Rendered first visit, search, state changes and navigation | PASS | Local candidate Edge UAT 39/39 |
| 320/390/1365 px responsive layouts | PASS | No horizontal overflow in rendered UAT |
| Progress announcement and stale-search isolation | PASS | Rendered checks; visible progress 14–30 ms |
| Ambiguous identities require visitor choice | PASS | Regression and rendered profile-picker checks |
| Unknown, partial, unavailable, timed-out and incomplete states | PASS | Fault-injection and regression checks |
| Season navigation and sourced history links | PASS | Rendered UAT and five-season manifest |
| Automated accessibility subset | PASS | axe-core 4.14.0; four views; 0 violations/errors |
| Arthur collector and archive automation | PASS | Scheduled cycle result 0; fresh heartbeat and 0 failed jobs |
| Release-tree backup and restore | PASS | 1,964 files; 108,119,106 bytes; 0 mismatches; Git/fsck/regression pass |
| Raw/global archive backup and restore | PASS | 11,717 files; 1,864,186,726 bytes; 0 mismatches/invalid files |
| Candidate staging on Vercel | BLOCKED | Vercel CLI and connector return 403 for team scope |
| Production source application service | FAIL | `/api/curling-io` returns 502; verifier now fails this condition |
| Promote and verify reviewed candidate | BLOCKED | Cannot proceed without Vercel team authorization |
| Off-computer alert delivery | BLOCKED | No owner-authorized alert destination |
| Physical-device and human assistive-technology UAT | BLOCKED | Physical devices/qualified testers unavailable |
| Private correction destination and retention workflow | BLOCKED | Owner decision required |
| Media/source-use rights clearance | BLOCKED | Documentary clearance not supplied |
| National-traffic capacity | BLOCKED | Existing controlled probe is not national-capacity evidence |

Local candidate assertions: 501 passed, 0 failed. Production acceptance: one active source-service failure. Blocked requirements are not counted as passes.
