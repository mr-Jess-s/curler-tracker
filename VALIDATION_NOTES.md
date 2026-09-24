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

Further validation is required across multiple provinces and event formats before public release.

## Release truthfulness hardening
- Missing position totals now remain unknown instead of defaulting to 0.
- Missing end scores remain unknown instead of defaulting to 0.
- Hammer derivation skips ends unless both posted end scores are present and numeric.
- Team-name alias text alone no longer links an unassigned game to the tracked team.
- Career history is loaded on demand and uses the source-native Curling I/O curler ID within the same source association.
- Release QA: 13 checks passed, 0 failed on 2026-09-23.

