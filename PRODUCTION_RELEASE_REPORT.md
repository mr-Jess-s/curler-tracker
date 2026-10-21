# Production release report

Evidence reconciled 2026-10-21T09:13:53.750522+00:00. Current machine-readable status: `RELEASE_EVIDENCE.json`.

Public production is v26.21 at `9a0b093d0bbc154aafe45795d1b7cc2c8943f6df`: https://curler-tracker.vercel.app . Arthur serves the same last successfully published build at http://127.0.0.1:8766/ . The former authorization and HTTP 502 blockers are resolved; the source service now serves cached archive responses.

Verified today: 42 rendered-browser checks, 14 security checks, 19 operational checks, and 400 public asset hashes. Both isolated backup restores pass. The newer daily archive commit is distinct from the deployed commit and remains eligible for the scheduled publisher's gates.

Software delivery is deployed and verified. Full product acceptance still requires physical-device testing under PRODUCT_ACCEPTANCE.md. This is not a claim of complete historical coverage or national advertising readiness. No spending or human contact was authorized or performed.
