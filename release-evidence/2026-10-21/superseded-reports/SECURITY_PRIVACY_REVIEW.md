# Security and Privacy Review

Evidence date: 2026-10-18 UTC.

The current public deployment previously passed 14/14 transport, header, service-worker and private-path checks. The reviewed candidate keeps restrictive CSP, frame denial, MIME-sniffing prevention, no-referrer and permissions policies; public-build allowlisting excludes raw archives, tools, repository metadata and credentials. No secret was found in the public release set. Imported links are restricted to safe HTTPS source URLs, requests are allowlisted and time-bounded, and uncertain identities are not silently merged.

The deployment verifier was corrected: a controlled 502/503/504 from the source service now fails release acceptance. The publisher now requires exact byte matching, source-service health, security checks and rendered browser UAT before promotion, with automatic rollback after a failed production verification.

Privacy handling remains minimal: public competition records and local browser preferences only. The privacy page explains variable coverage and correction needs. A private correction destination, retention/deletion rules, identity-dispute workflow, and owner-approved handling procedure remain BLOCKED. Sensitive corrections must not be sent through a public channel.

Vercel account authorization could not be reviewed or changed because the integration returns 403. This report is not legal advice, a penetration test, or rights clearance.
