import json,urllib.request,collections
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'data/history-manifest.json').read_text())
assert not manifest['errors']
total=0;samples=[]
for f in manifest['files']:
 p=ROOT/'data'/f['file']; payload=json.loads(p.read_text(encoding='utf-8'))
 assert p.stat().st_size==f['bytes']
 assert payload['source_subdomain']==f['subdomain'] and payload['schema_version']==1
 assert payload['generated_at']==manifest['generated_at']
 rows=[(cid,row) for cid,items in payload['curler_appearances'].items() for row in items]
 assert len(rows)==f['appearances']
 keys=[(cid,str(row['event_id']),str(row['team_id'])) for cid,row in rows]
 grouped=collections.defaultdict(list)
 for cid,row in rows: grouped[(cid,row['event_id'],row['team_id'])].append(row)
 # Prefer a repeated source roster identity to test conflict preservation.
 sample_key=next((key for key,items in grouped.items() if len(items)>1),next(iter(grouped)))
 for cid,row in rows:
  assert cid.isdigit() and row['published_name'] and row['event_id'] and row['team_id']
  assert row['source_url']==f"https://api-curlingio.global.ssl.fastly.net/en/clubs/{f['subdomain']}/events/{row['event_id']}"
 total+=len(rows)
 cid=sample_key[0]; row=grouped[sample_key][0]
 with urllib.request.urlopen(urllib.request.Request(row['source_url'],headers={'Accept':'application/json','User-Agent':'CurlerTracker/26.4 source-validation'}),timeout=25) as response: event=json.load(response)
 team=next(t for t in event['teams'] if t['id']==row['team_id'])
 people=[c for c in team['lineup'] if str(c.get('curler_id'))==cid]
 person=people[0]
 assert sorted((c['name'],c.get('position') or '') for c in people)==sorted((r['published_name'],r['position']) for r in grouped[sample_key]), 'Source roster observations differ'
 assert person['name']==row['published_name'] and event['name']==row['event_name'] and team['name']==row['team_name']
 samples.append({'subdomain':f['subdomain'],'curler_id':cid,'published_name':person['name'],'event_id':event['id'],'source_url':row['source_url'],'roster_entries_preserved':len(people)})
 print(f"PASS {f['subdomain']}: {len(rows)} rows + official source sample",flush=True)
out=ROOT/'qa';out.mkdir(exist_ok=True)
(out/'source-validation.json').write_text(json.dumps({'checked_at':datetime.now(timezone.utc).isoformat(),'roster_observations':total,'associations':len(samples),'samples':samples},indent=2))
print(f'SOURCE_QA_PASS {total} roster observations across {len(samples)} association files',flush=True)
