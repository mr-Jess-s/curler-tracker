# Performance and load report — 2026-10-16
Local rendered Edge155 on Polly, code3ad2ba2, timestamp13:52:24Z.
Actual measurements from browser-local-repeat.json:

| Operation | Progress | First useful view | Live checks finish |
|---|---:|---:|---:|
| Farrol Asham |145ms|177ms|20,854ms|
| Jody Sutherland |56ms|61ms|14,443ms|
| Adam Flatt |64ms|69ms|3,170ms|

The first useful view can contain a dated archived fallback, not a live conclusion. Initial archive visibility:2,722ms including a deliberate2,000ms service-worker settle delay; this is NOT LCP or a Lighthouse score. Local network/timing does not establish public mobile performance.

Defined thresholds: progress<=500ms; archived first-useful<=2s when cached/local data available; bounded per-fetch timeout12s; source discovery25s and recent12s plus in-flight deadlines. Static staging probe:60requests, at most5concurrent and5requests/sec; zeroerrors andp95<=2,000ms. Probe results pending. Never load-test production or source providers.

Current memory caches are per visitor, not shared globally. Static data has CDN cache headers. Repeated independent visitors can still multiply live source calls. No national television surge capacity, aggregate source request cap or robust incident degradation has passed verification. Advertising capacity gate FAIL until shared source caching/rate protection and a realistic traffic model pass controlled tests.


## Final public staging measurements — v26.19
staging-browser.json14:19:22Z: initial archive3,356ms including2,000ms deliberate settle; Farrol progress61ms/first useful575ms/live checkcomplete22,219ms;Jody37ms/559ms/14,991ms;Adam40ms/554ms/14,408ms. Useful initial records are explicitly archived, not live verification.
controlled-load-v2619.json14:18:59Z:60static requests,12.01s,0errors,p50=301.625ms,p95=451.46ms,max605.19ms,2,327,560bytes;probe thresholdsPASS. No source requests originated from this load generator.
Slow-network render check:150msconfigured latency,200,000bytes/sec download; exact observed times remain in extended-browser.json and extended-browser-chrome.json. These reloads may use the application service-worker cache and are not cold mobile-vitals measurements. Prior local results above remain historical observations, not substitutes for public tests.

## Independent 71-curler field audit — 2026-10-16

Actual sequential Edge 155 browser searches at a 390px mobile-emulated viewport used normal user form submission and reused browser/source caches. Timing ends when the app leaves its running state, before the separate history request.

| Target | Cases | Median | p95 nearest rank | Maximum |
|---|---:|---:|---:|---:|
| Production v26.15 | 71 | 14338 ms | 15432 ms | 16491 ms |
| Staging v26.19 | 71 | 14341 ms | 15614 ms | 18094 ms |

These are source-backed user-search observations, not cold page-load, concurrent-user, physical iPhone or national-advertising capacity measurements. No controlled high-volume traffic was sent to third-party curling sources. Search progress latency was not separately sampled in this field run.
