# Security and privacy review — 2026-10-16
Scope: static v26.19 release candidate. This is an engineering review, not legal clearance.

HTTPS-only imported source URLs and noopener links prevent script URL injection and opener access. The allowlisted public build excludes Git history, raw archive, collector configuration and tools. vercel.json defines CSP restricted to self plus api.curling.io/raw.githubusercontent.com for connections, nosniff, DENY framing, no-referrer and no camera/microphone/location permissions. Earlier staging verification passed14transport/header/private-path checks; final candidate retest remains required.

The browser persists last searched name, snapshot and feedback drafts; shared URLs include the name. No analytics/advertising SDK or application package dependency exists. Hosting and source providers still receive request metadata. The public privacy page discloses storage, providers, coverage and identity limits. Feedback copies/downloads locally; it does not submit.

Public GitHub issues provide only a nonsensitive correction route. A private privacy/minor-record channel is absent (P1 release gate). Do not publish the owner's personal address without direction. No response/removal procedure has passed an end-to-end private test.
Public junior records can identify minors; source availability does not establish unrestricted reuse rights. Collectors honour robots and access controls; source-policy host terms remain unreviewed. The archive must not claim clearance.

No authentication/payment/database exists in the public static app. Production hosting/GitHub permission audit and comprehensive secret-history scan remain incomplete. Test-only Selenium/axe live outside app assets. CI pins checkout to a commit and uses read-only repository permissions. Vercel CLI pins63.1.2; no tokens were printed or copied between devices.

Outstanding: verify served headers; perform private correction workflow; review source/artwork rights; verify hosting permissions and dependency/security scan evidence; complete accessible assistive-technology checks.

A tracked-file scan on Polly found no matching GitHub PAT, AWS access-key-ID or OpenAI project-key token signatures (git grep exit1). This limited signature scan does not replace repository-history/hosting-permission review. v26.19 removes off-branch GitHub archive fallback to preserve release data boundaries.


Finalv26.19 served checks passed14/14 at14:20:01Z (security-deployment.json). Missing.git/.env/raw/tools/state/config paths returned404;the expected transport/security/cache headers matched. This verifies their behaviour, not just configuration presence. No comprehensive permission/legal/security assurance is asserted.
