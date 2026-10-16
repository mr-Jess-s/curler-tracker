"""Attach completed empirical field-audit findings to the release record."""
import datetime as dt
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/2026-10-16/field-audit'
summary=json.loads((OUT/'summary.json').read_text(encoding='utf-8'))
assert summary['sample_size']==71
assert all(summary['target_summaries'][t]['complete'] and summary['target_summaries'][t]['completed']==71 for t in ['production','staging']), 'Both browser runs must finish before finalization'
rendered=json.loads((OUT/'rendered-source-validation.json').read_text(encoding='utf-8'))
assert {c['target'] for c in rendered['checks']}=={'production','staging'}
marker='## Independent 71-curler field audit — 2026-10-16'
def append(name,body):
 path=ROOT/name;text=path.read_text(encoding='utf-8-sig')
 text=text.split(marker)[0].rstrip()+'\n\n'+marker+'\n\n'+body.strip()+'\n'
 path.write_text(text,encoding='utf-8')
p=summary['target_summaries']['production'];s=summary['target_summaries']['staging']
append('KNOWN_LIMITATIONS.md','''The independently sourced 71-curler sample covers 23 Alberta, 24 Manitoba and 24 Curling Canada cases; 319 published event payloads support the comparison. See CURLER_FIELD_AUDIT_REPORT.md and its linked missing records.

| Priority | Observed limitation | Evidence |
|---|---|---|
| P1 history | Provincial history omits independently documented national appearances | Production searches for Braden Calvert, Corey Chambers and Kyle Kurz omit their 2026 Brier appearance |
| P2 history | UI recent-history window excludes verified older appearances | Production: 19 exact-profile cases omit 24 independently checked 2023/24 or 2022/23 appearances |
| P2 identity/coverage | A name search can choose a different source profile | Six production cases require source/profile disambiguation; no wrong-person conclusion follows from shared names |
| P1 search | Staging can fail to select a sourced profile for Kyle Kurz | Primary sample returned explicit incomplete-search/ambiguous-identities error and no history; original observation retained, follow-up in ambiguity-retest.json |
| P2 performance | Historical searches usually take about 14 seconds | Sequential mobile-emulated browser measurement; not a traffic-capacity benchmark |

These are empirical scope gaps. No complete-career or all-internet equivalence claim is supported. Current live-game behaviour was not established because the selected reference had no verified live fixtures. Production remains v26.15; the audit did not deploy changes.''')
append('UAT_ACCEPTANCE_MATRIX.md',f'''Source-reference acquisition and actual rendered searches finished at {summary['reported_at']}. Production v26.15 and staging v26.19 each ran all 71 names. Details, exact statuses, timestamps and source URLs are in release-evidence/2026-10-16/field-audit/.

| Requirement | Status | Actual result |
|---|---|---|
| Selected upcoming fixtures agree with published sources | PASS | Production {p['upcoming_fixture_cases_matched']}/{p['upcoming_fixture_cases']}; staging {s['upcoming_fixture_cases_matched']}/{s['upcoming_fixture_cases']} cases; exact assigned game IDs checked |
| History equals independently verified online records | FAIL | Production outcomes: {json.dumps(p['outcomes'])}; staging: {json.dumps(s['outcomes'])} |
| All sample searches complete without harness timeout | {'PASS' if p['harness_errors']==s['harness_errors']==0 else 'FAIL'} | Production {p['harness_errors']} final harness errors; staging {s['harness_errors']}; initial scroll/click retries retained separately |
| Rendered published titles, links, fixture labels and completed scores | {'PASS' if rendered['failing_assertions']==0 else 'FAIL'} | {rendered['passing_assertions']} assertions pass; {rendered['failing_assertions']} fail; {rendered['review_assertions']} label assertions remain REVIEW; reviewed labels are excluded from PASS |
| Positive live-game reference comparison | BLOCKED | No verified live fixture in the independently checked sample; not inferred from stale playing flags |
| Complete career / all-internet history | FAIL | Restricted source-profile and season windows cannot substantiate this claim |

An incomplete search can have matching historical records. Explicit incomplete statuses occurred in {p['search_explicitly_incomplete_cases']} production and {s['search_explicitly_incomplete_cases']} staging cases. This is not an all-sources success count.''')
append('PERFORMANCE_AND_LOAD_REPORT.md',f'''Actual sequential Edge 155 browser searches at a 390px mobile-emulated viewport used normal user form submission and reused browser/source caches. Timing ends when the app leaves its running state, before the separate history request.

| Target | Cases | Median | p95 nearest rank | Maximum |
|---|---:|---:|---:|---:|
| Production v26.15 | 71 | {p['search_ms']['median']} ms | {p['search_ms']['p95_nearest_rank']} ms | {p['search_ms']['maximum']} ms |
| Staging v26.19 | 71 | {s['search_ms']['median']} ms | {s['search_ms']['p95_nearest_rank']} ms | {s['search_ms']['maximum']} ms |

These are source-backed user-search observations, not cold page-load, concurrent-user, physical iPhone or national-advertising capacity measurements. No controlled high-volume traffic was sent to third-party curling sources. Search progress latency was not separately sampled in this field run.''')
append('PRODUCTION_RELEASE_REPORT.md',f'''The 71-curler independent field comparison finished on both production v26.15 and staging v26.19. Reference sources contain 319 independently fetched published events, including older spot checks and corroborating official Brier rosters. This audit changes no public application code or deployment.

Production outcomes: {json.dumps(p['outcomes'])}.

Staging outcomes: {json.dumps(s['outcomes'])}.

The selected upcoming fixtures matched, but verified historical omissions and profile separation prevent a complete-history acceptance. Launch and advertising remain BLOCKED. Use CURLER_FIELD_AUDIT_REPORT.md, curler-comparison.csv and the raw saved observations to reproduce each discrepancy.''')
evidence_path=ROOT/'RELEASE_EVIDENCE.json'
evidence=json.loads(evidence_path.read_text(encoding='utf-8-sig'))
evidence.update(updated_at=dt.datetime.now(dt.timezone.utc).isoformat(),status='BLOCKED',public_launch_ready=False,television_advertising_ready=False)
evidence['independent_curler_field_audit']={'summary':summary,'rendered_validation':{k:v for k,v in rendered.items() if k!='checks'},'artifacts':'release-evidence/2026-10-16/field-audit','report':'CURLER_FIELD_AUDIT_REPORT.md','production_changed':False,'complete_career_equivalence':False}
retest_path=OUT/'ambiguity-retest.json'
if retest_path.exists():
 retest=json.loads(retest_path.read_text(encoding='utf-8'))
 evidence['independent_curler_field_audit']['fresh_browser_follow_up']=[{'name':r['name'],'finished_at':r['finished_at'],'view':r['observation'].get('snapshot',{}).get('view'),'status':r['observation']['status']} for r in retest['results']]
checkpoint={'updated_at':evidence['updated_at'],'status':'AUDIT_COMPLETE_RELEASE_BLOCKED','independent_events':summary['reference_event_count'],'curlers':71,'primary_browser_cases':142,'browser_case_harness_errors':p['harness_errors']+s['harness_errors'],'reports':['CURLER_FIELD_AUDIT_REPORT.md','release-evidence/2026-10-16/field-audit/curler-comparison.csv','RELEASE_EVIDENCE.json'],'commands_completed':['python tools/Curler-Field-Audit.py --prepare --event-limit 360','python tools/Curler-Field-Audit.py --run production','python tools/Curler-Field-Audit.py --run staging','python tools/Extend-Field-Audit-History.py','python tools/Validate-Field-Audit-Rendering.py','python tools/Retest-Field-Audit-Ambiguity.py','python tools/Report-Curler-Field-Audit.py','python tools/Finalize-Curler-Field-Audit.py'],'outstanding':['Cross-association history gaps','Older-season history coverage','Safe source-profile selection','Intermittent incomplete Kyle Kurz result','Existing release privacy/capacity/recovery gates'],'exact_next_action':'Reproduce Braden Calvert in staging and compare the missing Canada event 26635 against the cited provincial history; implement a safe source-profile chooser before merging identities. Preserve this audit directory unchanged for regression comparison.','process_status':'Audit browser workers finished. No independent AI engineering worker is running. Installed operational schedules are separate.'}
(OUT/'checkpoint.json').write_text(json.dumps(checkpoint,indent=2)+'\n',encoding='utf-8')
evidence_path.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'finalized_at':evidence['updated_at'],'cases_per_target':71,'status':'BLOCKED','target_summaries':summary['target_summaries'],'rendered_validation':evidence['independent_curler_field_audit']['rendered_validation']},indent=2))
