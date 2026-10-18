# Performance and Load Report

Evidence date: 2026-10-18 UTC.

- Candidate rendered search progress: 14–30 ms; release threshold: under 500 ms.
- Candidate useful archived/documented result in local rendered UAT: approximately 0.5–0.6 seconds for exercised profiles.
- Identity algorithm QA: 419 cases; median 190.85 ms, p95 249.49 ms, maximum 314.42 ms.
- Name delivery changed from one 2.9 MB browser scan to keyed first-name/surname shards; 53 deterministic shards cover 13,338 names.
- Mobile widths tested: 320 and 390 px; desktop: 1365 px; no horizontal overflow.
- Existing controlled UAT load evidence: 60 static requests, concurrency 5, 0 errors, p95 425.46 ms.
- Service-worker data handling is network-first with offline fallback, preventing an unchanged app cache name from pinning old data.

The reviewed candidate was not deployed, so a new exact-candidate staging load run is BLOCKED by Vercel team authorization. The current source proxy returns 502 and browser fallback traffic reaches the upstream service directly. The existing limited probe does not establish national-audience capacity. National advertising remains blocked until the source service is cache-isolated and the exact promoted build passes a controlled staging load test.
