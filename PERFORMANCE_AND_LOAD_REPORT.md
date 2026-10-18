# Performance and Load Report

Evidence date: 2026-10-17/18 UTC. Candidate and production use the same verified public bytes.

- First visible search progress: 6–25 ms in rendered production tests; threshold 500 ms.
- Local indexed-name resolution: median 193.57 ms, p95 252.09 ms, maximum 269.37 ms.
- Controlled staging load: 60 static requests, five concurrent over five seconds, 0 errors.
- Load latency: p50 248.45 ms, p95 425.46 ms, maximum 503.86 ms.
- Mobile widths tested: 320 px and 390 px; no horizontal overflow.
- Cache policy: browser five minutes, shared cache one hour, stale-while-revalidate one day.

This controlled run validates the release threshold for indexed and static traffic; it is not evidence of national-audience capacity. Curling I/O rejects the Vercel server egress path, so the bounded official-source browser fallback still scales some source traffic with visitors. National advertising remains blocked until this dependency is resolved or load-isolated.
