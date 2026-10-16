"""Preserve public full/short team names from already-read reference payloads."""
import gzip
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-evidence/2026-10-16/field-audit'
with gzip.open(OUT/'reference.json.gz','rt',encoding='utf-8') as stream:reference=json.load(stream)
rows=[]
for event in reference['events']:
 url=f"https://api.curling.io/en/clubs/{event['association']}/events/{event['event_id']}"
 path=ROOT/'qa/field-audit-source-cache'/(hashlib.sha256(url.encode()).hexdigest()+'.json')
 if not path.exists():continue
 cached=json.loads(path.read_text(encoding='utf-8-sig'))
 if cached.get('status')!=200:continue
 teams=cached.get('payload',{}).get('teams',[])
 rows.append({'association':event['association'],'event_id':str(event['event_id']),
              'source_url':url,'retrieved_at':cached.get('retrieved_at'),
              'teams':[{k:t.get(k) for k in ('id','name','short_name')} for t in teams]})
(OUT/'source-team-names.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
print(json.dumps({'cached_source_events_exported':len(rows),'network_requests':0}))
