# Curler Tracker data model direction

## Product principle
Follow the athlete, not the source website.

## Non-negotiable reality rule
Curler Tracker never invents, estimates, completes, predicts, or substitutes a score, result, end, hammer, opponent, roster, ranking, event, date, qualification, achievement, biographical detail, or any other fact about reality.

A value is displayed as fact only when supported by an identified source observation. If a source does not establish it, the value remains unknown/unavailable. Derived values are allowed only when they follow deterministically from sourced facts using an explicit rule; they must retain links to those source facts and be distinguishable from directly reported values.

Conflicting sources are preserved and flagged for reconciliation. Silence or missing data is never treated as evidence that an event did or did not occur.

## Core records
- Athlete: stable internal ID; current display name; competition-name history/aliases; source-native IDs; identity evidence.
- Athlete alias: name as published, effective date/season when established, source observation, verification state, and whether it is searchable.
- Team stint: athlete, teammates, position, club/region, season, evidence.
- Event: organizer, dates, venue, level, official source.
- Appearance: athlete/team/event relationship and position.
- Game: draw, opponent, result, score, end scores, hammer evidence where available.
- Achievement: qualification, playoff finish, championship/medal where directly supported.
- Ranking observation: ranking system, date, position/points, source.
- Source observation: URL/source authority, retrieval time, source-native IDs, fields observed.

## Athlete experience
NOW: current event, live/next game, score, active end, hammer.
CAREER: season-by-season teams, events, records and achievements.
PATH: chronological progression through club/provincial/national/international competition.

## Provenance rules
1. Prefer official organizer/governing-body/club sources.
2. Store source-native IDs and retrieved-at timestamps.
3. Never merge two athletes solely because names match.
3a. A surname/name change must never be inferred from marriage, gender, age, geography, or timing alone. Link names only from stable source IDs or corroborated public curling evidence.
4. Conflicting observations remain traceable rather than silently overwritten.
5. Unknown values remain unknown.
6. Secondary aggregators may supplement but must not be the only architecture dependency.
7. Every factual field must be traceable to its supporting source observation(s).
8. Do not create placeholder/mock/demo facts in production data paths.
9. Deterministic derivations must record the rule and source observations used.
10. Never infer that an undocumented event, game, result, team membership, or achievement occurred.

## Initial first-party source families
- Curling I/O documented API for participating clubs/associations and historical seasons.
- Curling Canada official event archives, historical rankings and fact books.
- World Curling official historical results database.
- Provincial/territorial association official event/results archives where publicly accessible.

## Safety/privacy
Use public competition records. Do not create private dossiers, infer sensitive traits, or collect non-public personal information. For minors, keep the product centered on published competition history and avoid subjective automated scouting scores.
