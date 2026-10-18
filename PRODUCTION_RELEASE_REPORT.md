# Production Release Report

Evidence date: 2026-10-18 UTC

- Public URL: https://curler-tracker.vercel.app
- Current public release: v26.21, commit `ffa60f3880c0dcdbd2049a78cccf4f03ffbe4a6f`
- Existing UAT URL: https://curler-tracker-uat-20261017.vercel.app
- Existing UAT release: v26.20, commit `76f25188a31be5b9b49dbd9f1a26f8838cfbea24`
- Reviewed release-candidate branch: `release/2026-10-13-readiness`
- Reviewed candidate code/data commit: `3a551ed502ded7adf669bb77ea7f7a5d4fe0190d`
- Intended release: v26.21

The candidate implements sharded typo-tolerant identity lookup, network-first data updates, deterministic archive summaries, separate identity/profile choices, five-season history, strict result states, two independent backup streams, collector monitoring, and staged release gates. Local rendered UAT passed 39/39; regression passed 39/39; cache QA passed 4/4; identity QA passed 71/71 exact, 64/64 severe typo, and 284/284 realistic typo cases. Automated accessibility testing reported zero violations in four rendered views.

Arthur completed an unattended collection/test/commit/push/backup cycle with Task Scheduler result 0. The archive now contains 44,895 sourced appearances, 13,338 indexed names and 16,165 source-scoped profiles.

## Release verdict

**BLOCKED — not public-launch ready and not advertising ready.**

The reviewed candidate could not be staged or promoted because both Arthur's Vercel CLI and the connected Vercel integration return HTTP 403 for the `jess-and-roo` scope. The current production source proxy returns HTTP 502, so the browser uses a bounded direct-source fallback. Production therefore does not yet contain all reviewed fixes and cannot safely absorb national traffic without multiplying upstream requests.

Exact next action: restore Vercel authorization for the `jess-and-roo` team, run `tools\Publish-VerifiedRelease.ps1 -DeployReviewedNow`, and allow its byte, source-service, security, rendered-browser, promotion, production-verification and rollback gates to complete.
