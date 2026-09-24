import concurrent.futures, json, time, urllib.request
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(r'C:\Jess\curler-tracker')
OUTDIR=ROOT/'data'/'history'
MANIFEST=ROOT/'data'/'history-manifest.json'
SUBDOMAINS=['ab','canada','bc','mb','nb','nl','ns','nt','nu','on','pe','qc','sk','yt']
DELTAS=[0,-1,-2]
BASE='https://api-curlingio.global.ssl.fastly.net/en/clubs/{sub}'

def fetch_json(url, attempts=2):
    last=None
    for attempt in range(attempts):
        try:
            req=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'CurlerTracker/26.4 public-history-index'})
            with urllib.request.urlopen(req,timeout=20) as r:
                return json.load(r)
        except Exception as e:
            last=e; time.sleep(0.35*(attempt+1))
    raise last

def fetch_event(job):
    sub,item,season=job
    url=f"{BASE.format(sub=sub)}/events/{item['id']}"
    try: event=fetch_json(url)
    except Exception as e: return {'error':str(e),'subdomain':sub,'event_id':item.get('id'),'url':url,'rows':[]}
    rows=[]
    for team in event.get('teams') or []:
        for curler in team.get('lineup') or []:
            cid=curler.get('curler_id'); name=(curler.get('name') or '').strip()
            if not cid or not name: continue
            rows.append({'source_provider':'Curling I/O','source_subdomain':sub,'source_curler_id':cid,'published_name':name,'event_id':event.get('id') or item.get('id'),'event_name':event.get('name') or item.get('name') or '','starts_on':event.get('starts_on') or '','ends_on':event.get('ends_on') or '','season':season,'team_id':team.get('id'),'team_name':team.get('name') or '','position':curler.get('position') or '','coach':team.get('coach') or '','affiliation':team.get('affiliation') or '','source_url':url})
    return {'error':None,'subdomain':sub,'event_id':item.get('id'),'url':url,'rows':rows}

def main():
    OUTDIR.mkdir(parents=True,exist_ok=True); jobs=[]; lists=[]; errors=[]
    for sub in SUBDOMAINS:
        for delta in DELTAS:
            url=f"{BASE.format(sub=sub)}/competitions?occurred={delta}&registrations=f"
            try:
                payload=fetch_json(url); season=next((s.get('display','') for s in payload.get('seasons',[]) if int(s.get('delta',999))==delta),''); items=[i for i in payload.get('items',[]) if i.get('publish_results') is True]
                lists.append({'subdomain':sub,'delta':delta,'season':season,'items':len(items),'source_url':url}); jobs += [(sub,item,season) for item in items]; print(f'LIST {sub} {delta}: {len(items)} events',flush=True)
            except Exception as e:
                errors.append({'stage':'list','subdomain':sub,'delta':delta,'url':url,'error':str(e)}); print(f'LIST_FAIL {sub} {delta}: {e}',flush=True)
    print(f'FETCHING {len(jobs)} event payloads',flush=True); rows=[]; done=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futures=[ex.submit(fetch_event,j) for j in jobs]
        for fut in concurrent.futures.as_completed(futures):
            result=fut.result(); done+=1
            if result['error']: errors.append({'stage':'event','subdomain':result['subdomain'],'event_id':result['event_id'],'url':result['url'],'error':result['error']})
            rows.extend(result['rows'])
            if done%50==0 or done==len(futures): print(f'EVENTS {done}/{len(futures)} | appearances {len(rows)} | errors {len(errors)}',flush=True)
    if errors:
        raise RuntimeError(f'History refresh incomplete: {len(errors)} source failures. Existing published index preserved.')
    rows.sort(key=lambda r:(r['source_subdomain'],str(r['source_curler_id']),r['starts_on'],str(r['event_id'])))
    generated_at=datetime.now(timezone.utc).isoformat()
    policy='Facts copied from public Curling I/O event payloads; no inferred appearances or identity merges.'
    files=[]
    for sub in SUBDOMAINS:
        grouped={}
        for r in rows:
            if r['source_subdomain']!=sub: continue
            cid=str(r['source_curler_id'])
            slim={k:r.get(k) for k in ['published_name','event_id','event_name','starts_on','ends_on','season','team_id','team_name','position','coach','affiliation','source_url']}
            grouped.setdefault(cid,[]).append(slim)
        if not grouped:
            stale=OUTDIR/f'{sub}.json'
            if stale.exists(): stale.unlink()
            continue
        payload={'schema_version':1,'generated_at':generated_at,'source_provider':'Curling I/O','source_subdomain':sub,'source_policy':policy,'curler_appearances':grouped}
        out=OUTDIR/f'{sub}.json'; tmp=out.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8'); tmp.replace(out)
        count=sum(len(v) for v in grouped.values())
        files.append({'subdomain':sub,'file':f'history/{sub}.json','appearances':count,'bytes':out.stat().st_size})
    manifest={'schema_version':1,'generated_at':generated_at,'source_provider':'Curling I/O','source_policy':policy,'season_lists':lists,'files':files,'errors':errors}
    manifest_tmp=MANIFEST.with_suffix('.json.tmp')
    manifest_tmp.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    manifest_tmp.replace(MANIFEST)
    legacy=ROOT/'data'/'history-index.json'
    if legacy.exists(): legacy.unlink()
    print(f'DONE appearances={len(rows)} events={len(jobs)} errors={len(errors)} files={len(files)} bytes={sum(f["bytes"] for f in files)}',flush=True)

if __name__=='__main__': main()