# Validation notes

Updated: 2026-09-23

## 2025/26 Alberta historical-source check
Official/source system queried: Curling I/O Alberta API.

Observed competition:
- Event ID: 24023
- Event: 2026 U20 Mixed Doubles Provincial Championship North Hill Curling Club
- Published results: true

Observed team record:
- Team ID: 117090
- Team: Abbs/Cook
- Affiliation: Airdrie C.C./Medicine Hat C.C.
- Coach: Ken Abbs

Observed lineup:
- Sophie Abbs — curler ID 49287 — second — skip flag true
- Emmett Cook — curler ID 103749 — first

These values are recorded only as source observations from the fetched event payload. They are not inferred beyond what the payload states.

## Product defect found
The live/current event search correctly uses current season delta 0, but the "most recent completed event" fallback was also limited to delta 0. That meant a curler with no current-season appearance could fail to show a valid recent event from the prior season.

## Fix
The recent completed-event fallback now searches season deltas 0, -1, and -2 while the live/current discovery remains delta 0. This widens recent-history lookup without slowing live discovery across a decade of seasons.

This was the remaining beta validation item at the time; the broader checks completed on 2026-09-24 are recorded below. Full historical coverage remains ongoing.

## Release truthfulness hardening
- Missing position totals now remain unknown instead of defaulting to 0.
- Missing end scores remain unknown instead of defaulting to 0.
- Hammer derivation skips ends unless both posted end scores are present and numeric.
- Team-name alias text alone no longer links an unassigned game to the tracked team.
- Career history is loaded on demand and uses the source-native Curling I/O curler ID within the same source association.
- Release QA: 13 checks passed, 0 failed on 2026-09-23.

## Friend-test beta release verification — 2026-09-24

The generated recent-history index contains 25,849 public Curling I/O roster observations from 769 published-result events across 13 association files and three seasons (current plus two prior). The build completed with zero source fetch failures. British Columbia was checked but did not produce a lineup-bearing history file for the selected published-result scope.

Identity is scoped to the source association plus Curling I/O `curler_id`. A generic lineup-row ID is not accepted as athlete identity. Each record retains its published name, event/team IDs, source URL, source generation time, team, position, season, coach and affiliation when supplied. Different published names sharing the same scoped source-native curler ID remain connected; same-name rows with a different ID are not merged.

Thirteen live API samples—one per generated association file—were compared with the stored event, team, curler name and position records. Repeated source roster entries, including contradictory positions for the same event/team/curler, are preserved and visibly qualified instead of silently deduplicated.

Release checks completed after the final source and error-state changes:
- 18 static/live-source release checks passed;
- 18 focused regression checks passed, including stale-request isolation, name continuity, conflicting roster rows, missing-score truthfulness, incomplete-source handling and offline-cache behavior;
- 22 dashboard active/paused/stale/estimate checks passed;
- 17 Edge 153 browser checks passed at 320 px, 390 px and 1365 px widths.

The browser run verifies desktop Edge plus responsive viewport behavior. It does not establish physical iPhone/Android or Safari compatibility. Historical coverage remains explicitly incomplete and is not represented as a complete career archive.

