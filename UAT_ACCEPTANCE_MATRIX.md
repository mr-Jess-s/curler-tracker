# UAT acceptance matrix

Evidence reconciled 2026-10-21T09:13:53.750522+00:00. Current machine-readable status: `RELEASE_EVIDENCE.json`.

| Requirement | Current evidence |
|---|---|
| Public deployment identity and assets | PASS: 400 assets match the published build |
| Rendered search, navigation, failure and offline states | PASS: 42 checks |
| Responsive layout at 320, 390 and 1365 px | PASS: rendered production checks |
| Production security subset | PASS: 14 checks |
| Scheduled archive, publisher, monitoring and backups | PASS: 19 operational checks |
| Release and collector recovery | PASS: isolated restores with zero mismatches |
| Arthur local app | Running; sign-in startup configured; published assets verified October 20 |
| Physical-phone and assistive-technology testing | PENDING: not simulated by browser emulation |
| Remote cloud restore | PENDING: local recovery alone does not establish this |

Automated software acceptance passes. Full PRODUCT_ACCEPTANCE.md acceptance remains pending physical-device evidence. Original dated reports are retained as historical evidence, not current failures.
