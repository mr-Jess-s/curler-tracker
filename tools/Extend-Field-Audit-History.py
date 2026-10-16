"""Stratified older-season spot checks, keeping the original71people fixed."""
import importlib.util
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'tools/Curler-Field-Audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
oracle=audit.read(audit.OUT/'reference.json')
if oracle.get('older_history_extension_completed'):
    print('Older-season extension already complete; no new requests.')
    raise SystemExit(0)
driver=audit.browser()
try:
    driver.get(audit.STAGING);time.sleep(2)
    reference=audit.Reference(driver)
    new_events=[];catalog=[]
    for sub in audit.SOURCES:
        for delta in [-3,-4]:
            r=reference.fetch(f'{audit.API}/{sub}/competitions?occurred={delta}&registrations=f')
            if r.get('status')!=200:continue
            payload=r['payload'];season=next((s.get('display','') for s in payload.get('seasons',[]) if s.get('delta')==delta),'')
            rows=[dict(row,_season=season,_delta=delta) for row in payload.get('items',[]) if row.get('publish_results') is True and row.get('id')]
            # Nine evenly spaced published events per source/season. This is a spot check, not exhaustive older coverage.
            indexes=sorted(set(round(i*(len(rows)-1)/8) for i in range(9))) if rows else []
            selected=[rows[i] for i in indexes]
            catalog.append({'association':sub,'delta':delta,'season':season,'listed':len(payload.get('items',[])),'published':len(rows),'spot_check_event_count':len(selected),'url':r['url'],'retrieved_at':r['retrieved_at']})
            for item in selected:
                event_response=reference.fetch(f"{audit.API}/{sub}/events/{item['id']}")
                if event_response.get('status')==200:new_events.append(audit.compact_event(sub,item,event_response))
            print({'association':sub,'delta':delta,'verified_older_events':len(new_events)},flush=True)
    added=0;people=set()
    for event in new_events:
        for team in event['teams']:
            for curler in team['lineup']:
                for person in oracle['sample']:
                    if person['association']==event['association'] and person.get('source_curler_id')==str(curler['id']):
                        person['reference_history'].append({'team_id':team['id'],'team_name':team['name'],**{k:event[k] for k in ['event_id','name','starts_on','ends_on','season','delta','source_url','retrieved_at']},'published_name':curler['name']})
                        added+=1;people.add((person['association'],person['source_curler_id']))
    oracle['events'].extend(new_events);oracle['catalog'].extend(catalog)
    oracle['errors'].extend(reference.errors)
    oracle['older_history_extension_completed']=True
    oracle['older_history_extension']={'completed_at':audit.stamp(),'verified_events':len(new_events),'selected_curler_appearances':added,'selected_curlers_with_older_records':len(people),'method':'Nine evenly spaced published events per source in each of2023/24and2022/23. Same association+source-nativeID only;names not merged. No older-record absence claim.','errors':reference.errors}
    audit.save(audit.OUT/'reference.json',oracle)
    print(oracle['older_history_extension'],flush=True)
finally:driver.quit()
