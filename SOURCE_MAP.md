# Curler Tracker source map

Updated: 2026-10-24

## Source priority
1. Official competition operator / governing body / association / club.
2. Official results or ranking system operated for that competition.
3. Public secondary source only to fill a documented gap, with provenance retained.

No source is allowed to silently override another source. Conflicts are stored as conflicts.

## World Curling Results Database
Authority: World Curling official historical results and statistics service.
Coverage stated by source: the database aims to provide results and statistics for international championships organized since 1924.
Useful fields: person identity within World Curling, championship appearances, team/position, association, ranking/finish, game scores, games played, wins/losses, medals.
Limits stated by source: not complete playing statistics; detailed shot-level/statistical coverage is not complete. World Curling says historical results and lineups have known gaps and that recovery is ongoing. Its history page specifically identifies the 1989 World Curling Challenge as missing.
Role: primary international career-history backbone.
Completeness rule: this archive is a source backbone, not evidence that every championship, team lineup, player, score, or game has been recovered. Coverage counts must be reported from fetched and verified records, with missing years/events and source outages shown separately.
Implementation: saved association pages are normalized into `data/world-curler-index.json` using World Curling person IDs. The player search requires an exact normalized published name and a unique World Curling ID; it keeps source labels and links. Cross-source identity merges are not inferred.

## Curling Canada Event Archives
Authority: Curling Canada.
Coverage: national championship archives and statistical summaries. Curling Canada states Curling I/O was first implemented in 2014 and that select pre-2014 scores may not be available on the archive page.
Examples exposed by archive: Brier, Scotties, Trials, Canada Cup, U20/juniors, U18, club championships, mixed, mixed doubles, seniors, wheelchair, CCAA and U SPORTS.
Role: primary Canadian national-event history backbone.

## Curling Canada rankings
Authority: Curling Canada.
CTRS: official Canadian team ranking system; historical season standings are published.
CMDR: official Canadian mixed doubles ranking; historical ranking downloads are published.
Role: sourced ranking observations. Rankings are team/system observations, not invented individual talent ratings.

## Curling Canada Season of Champions fact books
Authority: Curling Canada.
Coverage: downloadable annual fact books for multiple seasons.
Role: historical corroboration and structured extraction candidate.

## Curling I/O
Authority varies by competition/club using the platform.
The published [Terms of Use](https://curling.io/terms) prohibit automated crawling, extraction, caching and republication without prior written permission, and restrict using System data to build a competing database or finder.
Status (2026-10-24): the project owner confirmed existing written permission for Curler Tracker's automated collection, expansion, retention, and republication. The source policy records the confirmation; the permission document is retained outside the repository.
Historical role: current and recent Canadian club/provincial event structures, rosters, draws and scores where published. The collector will enumerate seasons exposed by each association and report that source's available range; this does not establish complete Canadian curling history.

## Provincial/territorial associations and clubs
Role: required for the path below national championships, especially qualification chains and early career history.
Status: source-by-source inventory required. Only publicly accessible records and permitted interfaces will be used.

## Identity resolution
Names are search keys, not identity proof.
A cross-source athlete link requires corroborating evidence such as overlapping team members, association/region, event appearance, position, club, source-native identifiers, or another independently sourced discriminator.
Ambiguous matches remain separate/unresolved.

## Product display rule
Each factual career item must retain source authority, source-native ID/URL where available, and retrieval time.
Missing history is labelled incomplete/unknown. It is never filled by inference.


## Paper and offline records
A material portion of Canadian curling history may exist only on paper at curling clubs, associations, museums, personal collections, yearbooks, draw sheets, scorebooks, honour boards, newsletters, photographs, scrapbooks, newspaper clippings, and tournament programs.

These records are valid evidence sources when their provenance can be recorded. Digitization must preserve:
- club/collection and physical-record description;
- document title/type where known;
- season/date as printed, without guessing missing dates;
- page/image reference;
- who digitized it and when;
- original image/file alongside any transcription;
- transcription confidence or unresolved text;
- links from every extracted factual observation back to the source image/page.

OCR or AI transcription is an extraction aid, not the authority. The photographed/scanned original is the evidence. Unclear handwriting, damaged pages, ambiguous names, and conflicting records remain unresolved until corroborated.

Community submissions should enter a review queue and must not become asserted production facts merely because a user submitted them.

## Athlete names and aliases
Curler identity is independent of display name. A person may compete under different surnames or names over time.

Preferred evidence order:
1. Stable source-native athlete/curler ID continuing across names.
2. Official curling source explicitly connecting former/current names.
3. Official team, club, association, or athlete announcement.
4. Multiple corroborating competition facts sufficient for manual review.

A name change must not be assumed to be caused by marriage. Curler Tracker records competition-name continuity, not private relationship history.

Every verified alias should preserve the published name, source, effective date/season when known, and verification state. All verified aliases should remain searchable.

## Community and self-reported corrections
Curlers, clubs, associations, teams, coaches, family members, and other community members may submit proposed updates and supporting evidence.

A submission is a lead, not a fact. It enters review and must retain raw wording, submitter-declared relationship if voluntarily supplied, relevant athlete/event/team, source URL or document/image when available, submission time/app version, verification status, and reviewer notes.

Self-identification or club affiliation may raise review priority but does not silently override conflicting official records. Verified corrections remain traceable to both the submission and the evidence used to accept them.
