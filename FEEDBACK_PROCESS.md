# Curler Tracker feedback and improvement process

Updated: 2026-09-23

## Purpose
Collect useful user feedback without turning individual comments into product decisions. Feedback informs investigation. Changes require evidence, design/engineering review, and approval before implementation when they materially change the product.

## Feedback record
Each feedback item should preserve:
- submitted_at
- app_version
- page/view
- curler searched, only when voluntarily supplied and relevant
- device/browser class where available
- raw user wording
- optional screenshot or attachment
- feedback type
- severity
- reproducibility status
- related source/data issue, if any
- reviewer notes
- status
- linked issue/change proposal

Do not rewrite or discard the original wording.

## Types
- bug
- incorrect or missing data
- identity mismatch
- curler name/profile update
- confusing workflow
- accessibility/usability
- feature request
- visual/design
- performance/reliability
- source/provenance concern
- praise/general comment
- other

## Triage
1. Preserve the raw submission.
2. Separate factual defect reports from preferences and feature ideas.
3. For factual/data reports, verify against source evidence before changing records.
4. Reproduce software defects where possible.
5. Group duplicate or substantially similar reports without deleting originals.
6. Record affected versions and surfaces.
7. Assign severity based on user harm/product impact, not volume or tone alone.

## Severity
- Critical: fabricated/wrong factual assertion, privacy/security problem, destructive behavior, or core tracker unusable.
- High: materially incorrect data presentation, identity error, live-game failure, or major workflow blockage.
- Medium: confusing behavior, incomplete context, significant usability issue, or repeatable non-core defect.
- Low: polish, wording, minor visual issue, or isolated preference.

## Summarization methodology
Summaries must be evidence-based and link back to the underlying submissions.

For each review cycle produce:
- volume by type and app version;
- confirmed defects;
- unverified reports needing investigation;
- recurring usability themes;
- distinct feature requests;
- data/source gaps;
- positive signals worth preserving;
- conflicts between user preferences;
- unknowns and sampling limitations.

Do not treat repeated feedback from one person as independent consensus.
Do not turn a minority preference into a universal user need.
Do not use sentiment alone as evidence of severity.

## Improvement proposal methodology
A proposed improvement should include:
- problem statement;
- supporting feedback IDs;
- observed/reproduced evidence;
- affected users/surfaces;
- root cause or leading hypothesis;
- proposed change;
- alternatives considered;
- risk of changing nothing;
- implementation risk;
- data/provenance implications;
- test/acceptance criteria;
- rollback plan;
- approval status.

No production implementation should be justified by summary text alone. It must remain traceable to raw feedback and evidence.

## Approval states
- Inbox
- Triaged
- Investigating
- Confirmed
- Proposal drafted
- Awaiting approval
- Approved
- Implemented
- Verified
- Closed
- Rejected / no change

## Release feedback loop
Before each public/friend-test release:
1. Record release version and intended test questions.
2. Collect feedback against that version.
3. Triage and summarize.
4. Investigate high-impact themes.
5. Draft concrete improvement proposals.
6. Obtain approval where required.
7. Implement on a development branch.
8. Verify against acceptance criteria.
9. Release and observe again.

## Reality rule
User feedback can identify a possible factual problem but cannot itself establish a curling fact. Scores, identities, results, rosters, events, rankings, and historical claims still require source evidence.

## Friend-test collection implementation
The beta includes an in-app Feedback dialog. It does not transmit anything automatically.
A tester can copy a structured report or download JSON. The raw wording and basic app context are preserved.
Returned JSON files can be placed in feedback-inbox/ on Arthur.
Run tools/Summarize-Feedback.ps1 to produce a mechanical feedback-summary.md before qualitative review.
The generated summary is not an improvement recommendation; FEEDBACK_PROCESS.md triage and evidence review still apply.