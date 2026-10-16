"""Add independently verified public Brier rosters; never invent a Curling I/O ID."""
import datetime as dt
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
path=root/'release-evidence/2026-10-16/field-audit/reference.json'
data=json.loads(path.read_text(encoding='utf-8-sig'))
groups={
 'ab':('Team Alberta',['Kevin Koe','Tyler Tardi','Aaron Sluchinski','Karrick Martin']),
 'mb':('Team Manitoba - Calvert',['Braden Calvert','Corey Chambers','Kyle Kurz','Brendan Bilawka']),
 'canada':('Team Canada - Jacobs',['Brad Jacobs','Marc Kennedy','Brett Gallant','Ben Hebert'])}
used={r['name'].casefold() for r in data['sample']}
for association,(team,names) in groups.items():
 for name in names:
  if name.casefold() in used:continue
  data['sample'].append({'name':name,'association':association,'source_curler_id':None,'reference_history':[],
    'external_reference':{'event':'2026 Montana\u2019s Brier','team':team,'starts_on':'2026-02-27','ends_on':'2026-03-08',
      'source_url':'https://www.curling.ca/2026brier/teams/','verification':'Official public team roster read via web retrieval on2026-10-16; not inferred from the app archive.'}})
  used.add(name.casefold())
data['external_reference_added_at']=dt.datetime.now(dt.timezone.utc).isoformat()
data['sample_size']=len(data['sample'])
temp=path.with_suffix('.json.tmp');temp.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8');temp.replace(path)
print(json.dumps({'total_sample':len(data['sample']),'independent_external_cases':sum(bool(r.get('external_reference')) for r in data['sample'])}))
