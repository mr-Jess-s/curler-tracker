"""Render actual saved field-audit observations as reproducible JSON/CSV/Markdown."""
from collections import Counter
import csv
import datetime as dt
import json
import gzip
import importlib.util
from urllib.parse import quote_plus
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/2026-10-16/field-audit'
if (OUT/'reference.json').exists():oracle=json.loads((OUT/'reference.json').read_text(encoding='utf-8-sig'))
else:
 with gzip.open(OUT/'reference.json.gz','rt',encoding='utf-8') as stream:oracle=json.load(stream)
reports={}
for target in ['production','staging']:
 path=OUT/(target+'-results.json')
 if path.exists():reports[target]=json.loads(path.read_text(encoding='utf-8-sig'))
spec=importlib.util.spec_from_file_location('field_audit',ROOT/'tools/Curler-Field-Audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
people={(p['association'],str(p.get('source_curler_id')),p['name']):p for p in oracle['sample']}
for target,report in reports.items():
 if not report.get('complete'):continue
 for result in report['results']:
  person=people[(result['association'],str(result.get('source_curler_id')),result['name'])]
  if result.get('error') or not result.get('observation'):continue
  updated=audit.compare(person,result['observation'],oracle)
  if result['comparison']!=updated:
   result.setdefault('comparison_before_details_review',result['comparison']);result['comparison']=updated
 report['scoring_revision']='v2:normalized title/date/team fields and independent Brier source-ID corroboration;no new browser/source observations'
 report['summary']=dict(Counter(r['comparison']['outcome'] for r in report['results']))
 audit.save(OUT/(target+'-results.json'),report)
data={'reported_at':dt.datetime.now(dt.timezone.utc).isoformat(),'sample_size':len(oracle['sample']),
      'per_association':dict(Counter(p['association'] for p in oracle['sample'])),
      'reference_event_count':len(oracle['events']),'source_errors':oracle['errors'],
      'older_history_spot_checks':oracle.get('older_history_extension'),
      'source_catalog':oracle['catalog'],
      'target_summaries':{k:{'completed':len(v['results']),'complete':v.get('complete',False),'outcomes':dict(Counter(r['comparison']['outcome'] for r in v['results'])),'versions':sorted(set(r.get('observation',{}).get('version','unknown') for r in v['results']))} for k,v in reports.items()}}
(OUT/'summary.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
def key(person):return (person['association'],str(person.get('source_curler_id')),person['name'])
indexes={target:{key(row):row for row in report['results']} for target,report in reports.items()}
rows=[]
for person in oracle['sample']:
 row={'name':person['name'],'association':person['association'],'source_curler_id':person.get('source_curler_id'),
      'external_case':bool(person.get('external_reference')),'reference_events':len(set(str(h['event_id']) for h in person['reference_history'])),
      'source_url':person.get('external_reference',{}).get('source_url') or person['reference_history'][0]['source_url']}
 for target in ['production','staging']:
  result=indexes.get(target,{}).get(key(person),{});c=result.get('comparison',{})
  row[target+'_outcome']=c.get('outcome','NOT_RUN')
  row[target+'_matched_history']=len(c.get('matched_history_events',[]))
  row[target+'_missing_history']=len(c.get('missing_history_events',[]))
  row[target+'_live_reference_games']=c.get('verified_live_games')
  row[target+'_upcoming_reference_games']=c.get('verified_upcoming_games')
  row[target+'_current_event']=c.get('current_event_check','NOT_RUN')
  row[target+'_search_ms']=result.get('search_ms')
 rows.append(row)
with (OUT/'curler-comparison.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
lines=['# Independent curler field audit', '', f"Reported {data['reported_at']}. Sample: {len(rows)} curlers. Official reference event payloads: {len(oracle['events'])}.",
       '', 'The first60names come from freshly read published Alberta,Manitoba andCurling Canada Curling I/O rosters (20each), not the app archive. Additional Brier names come from Curling Canada’s official2026team page. Selection favours multi-season records and any verified current/future rosters; it does not estimate population-wide success rates.',
       '', 'Both sites use actual rendered Edge390px searches, normal form submission and the visible history control. Neither application matching nor discovery functions supply the expected records. Source requests are paced at most1per second and cached; a401/403/429stops independent source acquisition. Every completed search writes a checkpoint.',
       '', '## Results','', '| Target | Cases completed | Build versions | Outcomes |','|---|---:|---|---|']
for target,s in data['target_summaries'].items():lines.append(f"| {target} | {s['completed']}/{len(rows)} | {', '.join(s['versions'])} | {json.dumps(s['outcomes'])} |")
lines+=['','## Per-curler comparison','','History entries below count distinct source events. Missing entries do not imply invented data. A different source-native ID requires identity review; matching names alone do not establish an error or an identity merge.','', '| Curler | Association | Reference events | Production | Staging | Source |','|---|---|---:|---|---|---|']
for r in rows:
 def label(target):
  outcome=r[target+'_outcome']
  labels={'REFERENCE_HISTORY_MATCH':'History matched','HISTORY_MATCH_LIVE_SEARCH_INCOMPLETE':'History matched;livecheck incomplete','CROSS_SOURCE_OR_ID_REVIEW':'Review source/identity','PARTIAL_HISTORY':'Partial history','EXTERNAL_BRIER_ROSTER_MATCH':'Brier appearance matched','VERIFIED_EXTERNAL_HISTORY_NOT_SHOWN':'Brier appearance missing','CURRENT_OR_UPCOMING_MISSING':'Current/upcoming missing','REFERENCE_EVENT_DETAILS_DIFFER':'Event details differ'}
  text=labels.get(outcome,outcome)
  if r['reference_events']:text+=f" ({r[target+'_matched_history']}/{r['reference_events']})"
  return f"[{text}]({audit.TARGETS[target]}/?player={quote_plus(r['name'])})"
 lines.append(f"| {r['name']} | {r['association']} | {r['reference_events'] if not r['external_case'] else 'Brier roster'} | {label('production')} | {label('staging')} | [record]({r['source_url']}) |")
if oracle.get('older_history_extension'):
 ext=oracle['older_history_extension']
 lines+=['','## Older history spot checks','',f"Independently checked {ext['verified_events']}older published events across2023/24and2022/23, selecting nine evenly spaced events per association/season. These verified {ext['selected_curler_appearances']}additional appearances for {ext['selected_curlers_with_older_records']}of the fixed71people, linked only through the same association+source-nativeID. This is not exhaustive older coverage. Final comparisons include these verified records; the original browser observations remain saved."]
lines+=['','## Interpretation and limits','', 'REFERENCE_HISTORY_MATCH means all events in this independently checked reference subset appear; it does not mean a complete career. HISTORY_MATCH_LIVE_SEARCH_INCOMPLETE retains a live-source availability failure. PARTIAL_HISTORY identifies precise missing verified eventIDs in the JSON. VERIFIED_EXTERNAL_HISTORY_NOT_SHOWN identifies an independently documented Brier appearance that the UI did not show. EXTERNAL_BRIER_ROSTER_MATCH requires the independently read officialBrier roster plus a freshI/Oevent roster and exact returned source-nativeID/eventID, not a matching title alone. CROSS_SOURCE_OR_ID_REVIEW needs manual identity/provenance review. Only a confirmed source roster/score conflict should become a wrong-person or wrong-score defect.',
       '', 'Current/upcoming checks apply only to independently observed source fixtures and dated rosters. If the selected sources supply no live/upcoming assignment, the corresponding behaviour remains untested, notpassed. The base/current-two-prior-season collection plus older spotchecks do not encompass all internet records. Unpublished rosters were not fetched. Any source errors and collection limits remain in reference.json.gz. Sources may change between retrieval and UIsearch; live-score differences require a fresh recheck.',
       '', 'This audit changes no production code/data and sends no feedback or other messages. Detailed observations, URLs, retrieval timestamps, payload hashes, missing eventIDs, scores and checkpoints accompany this report.']
(ROOT/'CURLER_FIELD_AUDIT_REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(data,indent=2))
