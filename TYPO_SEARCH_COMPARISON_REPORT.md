# Typo search comparison

Reported 2026-10-16T15:56:35.010743+00:00. Fixed sample: 71 people; 64 queries changed.

Rule: replace every i with o and every r with t simultaneously, regardless of case, preserving capitalization. Examples below show the exact submitted query. Original field-audit evidence remains unchanged.

A recovery means the same source association and native curler ID as the exact-spelling search. This is a paired retrieval measure, not proof of identity: six exact-spelling production cases already required source/profile review. Different profiles and unverifiable identities are excluded from recovery. No sourced result is not proof of no history. Unchanged queries are reported separately.

| Target | Exact-spelling sourced profiles | Typo same-profile recovery | Recovery among changed queries with baseline profile | Other outcomes |
|---|---:|---:|---:|---|
| production | 71/71 | 0/5 | 0/5 (0.0%) | {"NO_SOURCED_PROFILE": 5} |

## Individual searches

| Target | Correct name | Submitted typo | Result |
|---|---|---|---|
| production | Colby Sherwick | Colby Shetwock | NO_SOURCED_PROFILE |
| production | Justin Morlock | Juston Motlock | NO_SOURCED_PROFILE |
| production | Julia Kennedy | Juloa Kennedy | NO_SOURCED_PROFILE |
| production | Sophie Abbs | Sophoe Abbs | NO_SOURCED_PROFILE |
| production | Aaron Sluchinski | Aaton Sluchonsko | NO_SOURCED_PROFILE |

## Limits

Both builds use actual rendered Edge mobile-emulated searches and the history control, sequentially with two seconds between names. Tests reuse source caches like a returning visitor and do not impose artificial traffic load. Baseline observations were collected earlier the same day, so this is a sequential comparison rather than a simultaneous controlled experiment. Production/staging build versions, timestamps and complete DOM/snapshot observations are saved. No app code, source data or deployment was changed. No verified live fixtures existed in the reference sample. A typo returning the original profile can still have the same older or cross-association history gaps. An ambiguous/no-match response is safer than silently selecting another person.
