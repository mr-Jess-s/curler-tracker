# UAT Acceptance Matrix

Evidence date: 2026-10-18 UTC. Build: v26.20 / `e2708537`.

| Requirement | Status | Evidence |
|---|---|---|
| Public website and exact build | PASS | Production byte verifier: 54 files, 0 mismatches |
| First visit, navigation, seasons, back button | PASS | Production rendered UAT: 39/39 |
| Known, unknown, partial and ambiguous searches | PASS | Production rendered UAT; fixed-name QA |
| Typo suggestions without automatic identity selection | PASS | 71/71 exact, 64/64 severe, 284/284 realistic |
| Search progress and stale-result isolation | PASS | Visible progress 6–25 ms; rendered UAT |
| Farrol Asham case | PASS | Two cited records; partial/live-source warning; screenshot |
| Mobile layouts | PASS | 320, 390 and 1365 px, no horizontal overflow |
| Keyboard, reduced motion, semantics, contrast | PASS | Extended browser 12/12; axe 0 violations in four views |
| Security headers and private-file exclusion | PASS | Production security 14/14 |
| Archive automation | PASS | Scheduled cycle result 0; 44,847 sourced appearances |
| Backup restoration | PASS | 12,789 files, 0 mismatches, Git fsck and 38 regressions pass |
| Physical mobile and human screen-reader test | BLOCKED | Requires physical devices and qualified human testing |
| Private correction channel | BLOCKED | Requires owner-approved destination; no personal address published |
| Rights clearance | BLOCKED | Mascot/artwork/source-use documentation not supplied |
| National-load capacity | BLOCKED | Controlled static load passed; national traffic not established |
| External alert delivery | BLOCKED | Local health task works; no authorized external destination |

Current release-gate suites total 554 PASS and 0 FAIL. Blocked requirements are not counted as passes.
