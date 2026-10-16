"""Paced, resumable independent source-to-rendered-UI comparison; no fabricated records."""
import argparse
from collections import Counter, defaultdict
import datetime as dt
import hashlib
import gzip
import json
import os
from pathlib import Path
import random
import re
import sys
import time
import unicodedata

sys.path.insert(0, os.environ.get('CT_SELENIUM_PATH', r'C:\Temp\curler-qa-20261016'))
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release-evidence/2026-10-16/field-audit'
CACHE = ROOT / 'qa/field-audit-source-cache'
API = 'https://api.curling.io/en/clubs'
STAGING = 'https://curler-tracker-uat-20261016.vercel.app'
TARGETS = {'production': 'https://curler-tracker.vercel.app', 'staging': STAGING}
SOURCES = ['ab', 'mb', 'canada']

def stamp(): return dt.datetime.now(dt.timezone.utc).isoformat()
def norm(value): return ''.join(c for c in unicodedata.normalize('NFKD', str(value)).lower() if not unicodedata.combining(c) and c.isalnum())
def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)

def read(path):
    if not path.exists() and path.with_suffix(path.suffix+'.gz').exists():
        with gzip.open(path.with_suffix(path.suffix+'.gz'),'rt',encoding='utf-8') as stream:return json.load(stream)
    return json.loads(path.read_text(encoding='utf-8-sig'))
def browser():
    options = Options()
    options.add_argument('--headless=new')
    options.binary_location = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    d = webdriver.Edge(options=options)
    d.set_script_timeout(40)
    d.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
    return d

def date(value):
    if not value: return None
    text = str(value)
    try: return dt.datetime.fromisoformat(text.replace('Z','+00:00')).date()
    except ValueError: pass
    for pattern in ('%b %d, %Y','%B %d, %Y'):
        try: return dt.datetime.strptime(text,pattern).date()
        except ValueError: pass
    return None

class Reference:
    def __init__(self, driver):
        self.driver = driver
        self.requests = 0
        self.errors = []
        self.last_request = 0
        self.blocked = False

    def fetch(self, url):
        key = hashlib.sha256(url.encode()).hexdigest()
        path = CACHE / (key+'.json')
        if path.exists(): return read(path)
        if self.blocked: return {'url':url,'status':0,'error':'Source reads stopped after access/rate-limit failure','retrieved_at':stamp()}
        time.sleep(max(0, 1.0-(time.monotonic()-self.last_request)))
        self.last_request = time.monotonic()
        result = self.driver.execute_async_script("""
          const url=arguments[0],done=arguments[1],c=new AbortController(),t=setTimeout(()=>c.abort(),18000);
          fetch(url,{headers:{Accept:'application/json'},signal:c.signal}).then(async r=>{
            const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}
            done({status:r.status,payload:body,retry_after:r.headers.get('Retry-After'),error:r.ok?null:text.slice(0,200)})
          }).catch(e=>done({status:0,error:e.message})).finally(()=>clearTimeout(t));
        """,url)
        self.requests += 1
        result.update({'url':url,'retrieved_at':stamp()})
        if result.get('status') in (401,403,429):
            self.blocked = True
            result['stopped_source_reads'] = True
        if result.get('status') != 200: self.errors.append({k:v for k,v in result.items() if k!='payload'})
        save(path,result)
        return result

def compact_event(sub, item, response):
    p = response['payload']
    event_id = p.get('id') or item['id']
    teams = []
    for team in p.get('teams',[]):
        teams.append({'id':team.get('id'),'name':team.get('name',''),
                      'lineup':[{'id':row.get('curler_id'),'name':row.get('name','')} for row in team.get('lineup',[]) if row.get('curler_id') and row.get('name')]})
    games = []
    def walk(value):
        if isinstance(value,list):
            for row in value: walk(row)
        elif isinstance(value,dict):
            positions = value.get('game_positions') or value.get('positions') or value.get('sides') or value.get('entries')
            if value.get('id') and isinstance(positions,list):
                games.append({'id':str(value['id']),'state':value.get('state'),'positions':positions})
            for key,child in value.items():
                if key not in ('game_positions','positions','sides','entries'): walk(child)
    walk(p.get('stages',[]))
    for game in games:
        times=[]
        for draw in p.get('draws',[]):
            ids=[str(x.get('game_id') or x.get('id')) if isinstance(x,dict) else str(x) for x in draw.get('draw_sheets',[])]
            if game['id'] in ids and draw.get('epoch'):times.append(draw['epoch'])
        game['draw_epochs']=times
    return {'association':sub,'event_id':event_id,'name':p.get('name') or item.get('name',''),
            'starts_on':p.get('starts_on'),'ends_on':p.get('ends_on'),
            'season':item.get('_season'),'delta':item.get('_delta'),
            'source_url':f'https://{sub}.curling.io/en/events/{event_id}',
            'api_url':response['url'],'retrieved_at':response['retrieved_at'],
            'payload_sha256':hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest(),
            'teams':teams,'games':games,'draws':p.get('draws',[])}

def prepare(limit=360):
    d = browser()
    try:
        d.get(STAGING)
        WebDriverWait(d,30).until(lambda d:d.execute_script("return typeof APP_VERSION!=='undefined'"))
        time.sleep(2)
        reference = Reference(d)
        catalog = []
        events = []
        for sub in SOURCES:
            for delta in [0,-1,-2]:
                url=f'{API}/{sub}/competitions?occurred={delta}&registrations=f'
                r=reference.fetch(url)
                if r.get('status')!=200: continue
                payload=r['payload']
                season=next((s.get('display','') for s in payload.get('seasons',[]) if s.get('delta')==delta),'')
                items=payload.get('items',[])
                published=[dict(row,_season=season,_delta=delta) for row in items if row.get('publish_results') is True and row.get('id')]
                catalog.append({'association':sub,'delta':delta,'season':season,'listed':len(items),'published':len(published),'url':url,'retrieved_at':r['retrieved_at']})
                print(json.dumps(catalog[-1]),flush=True)
                # No unpublished roster requests; source policy is unchanged.
                for item in published:
                    if len(events)>=limit: break
                    er=reference.fetch(f"{API}/{sub}/events/{item['id']}")
                    if er.get('status')==200 and isinstance(er.get('payload'),dict): events.append(compact_event(sub,item,er))
                    if len(events)%20==0: print(json.dumps({'reference_events':len(events),'source_requests':reference.requests}),flush=True)
                    save(OUT/'reference-progress.json',{'updated_at':stamp(),'catalog':catalog,'verified_event_count':len(events),'errors':reference.errors,'source_requests_this_run':reference.requests,'next_action':'Resume --prepare; cached successful responses are reused.'})
        # Sample from independently fetched rosters, never from the app's index or matching functions.
        records = defaultdict(list)
        for event in events:
            for team in event['teams']:
                for person in team['lineup']:
                    key=(event['association'],str(person['id']))
                    records[key].append({'name':person['name'],'team_id':team['id'],'team_name':team['name'],**{k:event[k] for k in ['event_id','name','starts_on','ends_on','season','delta','source_url','retrieved_at']},'published_name':person['name']})
        sample=[];used=set();today=dt.datetime.now(dt.timezone.utc).date()
        for sub in SOURCES:
            pool=[]
            for (source,cid),rows in records.items():
                if source!=sub:continue
                names=Counter(row['published_name'] for row in rows)
                name=names.most_common(1)[0][0]
                if norm(name) in used or len(name.split())<2:continue
                ongoing=any(date(row['ends_on']) and date(row['ends_on'])>=today for row in rows)
                pool.append({'association':sub,'source_curler_id':cid,'name':name,'reference_history':rows,'current_or_future_roster':ongoing,'seasons':len(set(row['season'] for row in rows))})
            rng=random.Random(20261016+SOURCES.index(sub));rng.shuffle(pool)
            pool.sort(key=lambda row:(not row['current_or_future_roster'],-row['seasons']))
            chosen=[];teams=Counter()
            for row in pool:
                latest=sorted(row['reference_history'],key=lambda r:str(r['starts_on']),reverse=True)[0]
                team_key=(latest['event_id'],latest['team_id'])
                if teams[team_key]>=2:continue
                chosen.append(row);teams[team_key]+=1;used.add(norm(row['name']))
                if len(chosen)==20:break
            if len(chosen)<20: raise RuntimeError(f'Only{len(chosen)}verified curlers for{sub};sample cannot be called complete')
            sample.extend(chosen)
        oracle={'created_at':stamp(),'sampling':'Deterministic seed20261016;20per association;prioritize current/future verified rosters then multi-season;max2per latest event/team;unique normalized names. Not a random population prevalence estimate.',
                'catalog':catalog,'sample':sample,'events':events,'source_requests_this_run':reference.requests,'errors':reference.errors,
                'coverage_limit':'Current and two prior Curling I/O seasons;published rosters only. Not all internet history. Missing/blocked/unpublished records stay unknown.','event_limit':limit,'limit_reached':len(events)>=limit}
        save(OUT/'reference.json',oracle)
        print(json.dumps({'prepared':len(sample),'events':len(events),'source_errors':len(reference.errors),'current_future_sample':sum(r['current_or_future_roster'] for r in sample)}),flush=True)
    finally:d.quit()

def observation(d):
    return d.execute_script("""return {version:APP_VERSION,name:state.playerName,snapshot:state.snapshot,status:document.querySelector('#statusLine').textContent,
      headline:document.querySelector('#headlineBlock').innerText,history_text:document.querySelector('#careerPath').innerText,
      history_links:[...document.querySelectorAll('#careerPath a')].map(a=>a.href),schedule_text:document.querySelector('#scheduleList').innerText,
      history_loading:state.careerLoading,history_message:state.careerMessage,displayed_history:document.querySelectorAll('#careerPath .career-item').length};""")

def compare(person,obs,oracle):
    s=obs.get('snapshot') or {};history=s.get('careerHistory') or []
    if person.get('external_reference'):
        expected=person['external_reference']
        texts=[str(r.get('title','')) for r in history]+[str(s.get('eventName',''))]
        title_candidate=any('2026' in t and 'brier' in t.lower() and not re.search(r'qualif|playdown|provincial',t,re.I) for t in texts)
        exact_link=expected['source_url'] in obs.get('history_links',[])
        corroborated=[]
        for event in oracle['events']:
            if event['association']!='canada' or '2026' not in event['name'] or 'brier' not in event['name'].lower() or re.search(r'qualif|provincial|playdown',event['name'],re.I):continue
            for team in event['teams']:
                for curler in team['lineup']:
                    if norm(curler['name'])==norm(person['name']):corroborated.append({'event_id':str(event['event_id']),'curler_id':str(curler['id']),'team_name':team['name'],'source_url':event['source_url']})
        shown={str(r.get('eventId')) for r in history if r.get('eventId')}
        for url in obs.get('history_links',[]):
            match=re.search(r'/events/(\d+)',url)
            if match:shown.add(match.group(1))
        verified=any(r['event_id'] in shown and s.get('sourceSubdomain')=='canada' and str(s.get('sourceCurlerId'))==r['curler_id'] for r in corroborated)
        return {'outcome':'EXTERNAL_BRIER_ROSTER_MATCH' if verified else ('EXTERNAL_EVENT_TITLE_REQUIRES_REVIEW' if title_candidate or exact_link else 'VERIFIED_EXTERNAL_HISTORY_NOT_SHOWN'),
                'external_reference':expected,'source_native_identity':'Not asserted across websites from a matching name alone',
                'independent_io_roster_corroboration':corroborated,
                'current_event_check':'Historical event only; current/upcoming status not inferred',
                'search_explicitly_incomplete':bool(re.search(r'incomplete|unavailable|could not',obs.get('status',''),re.I))}
    expected={(str(r['event_id']),str(r['team_id'])) for r in person['reference_history']}
    expected_ids={a for a,b in expected}
    shown_ids={str(r.get('eventId') or '') for r in history if r.get('eventId')}
    # URLs also count when the app's compact snapshot omitted an eventId field.
    for url in obs.get('history_links',[]):
        m=re.search(r'/events/(\d+)',url)
        if m:shown_ids.add(m.group(1))
    source=s.get('sourceSubdomain');cid=s.get('sourceCurlerId')
    returned_events=[e for e in oracle['events'] if e['association']==source and str(e['event_id'])==str(s.get('eventId'))]
    returned_rosters=[(event,team,p) for event in returned_events for team in event['teams'] for p in team['lineup'] if str(p['id'])==str(cid)]
    if not returned_events:returned_record='OUTSIDE_CHECKED_REFERENCE'
    elif not returned_rosters:returned_record='SOURCE_CURler_ID_NOT_ON_RETURNED_EVENT_ROSTER'
    elif not any(norm(team['name'])==norm(s.get('teamName','')) for event,team,p in returned_rosters):returned_record='RETURNED_TEAM_DIFFERS_FROM_SOURCE'
    else:returned_record='VERIFIED_RETURNED_SOURCE_RECORD'
    identity='MATCH' if source==person['association'] and str(cid)==person['source_curler_id'] else 'UNRESOLVED'
    if source and cid and identity!='MATCH':identity='DIFFERENT_SOURCE_ID_REQUIRES_REVIEW'
    unexpected=[]
    for hid in shown_ids:
        relevant=[e for e in oracle['events'] if e['association']==source and str(e['event_id'])==hid]
        if relevant and not any(any(str(p['id'])==str(cid) for p in t['lineup']) for e in relevant for t in e['teams']):unexpected.append(hid)
    known_current=[r for r in person['reference_history'] if date(r['ends_on']) and date(r['ends_on'])>=dt.datetime.now(dt.timezone.utc).date()]
    current_ids={str(r['event_id']) for r in known_current}
    current='NOT_ESTABLISHED_IN_REFERENCE' if not current_ids else ('MATCH' if str(s.get('eventId')) in current_ids and s.get('view') not in ('archived-team','error','idle') else 'VERIFIED_CURRENT_EVENT_NOT_SHOWN')
    reference_games=[]
    for event in oracle['events']:
        if event['association']!=person['association']:continue
        team_ids={str(t['id']) for t in event['teams'] if any(str(p['id'])==person['source_curler_id'] for p in t['lineup'])}
        for game in event['games']:
            if any(str(side.get('team_id')) in team_ids for side in game['positions']):
                reference_games.append({'event_id':str(event['event_id']),**game})
    upcoming=[g for g in reference_games if any(float(t)>time.time() for t in g.get('draw_epochs',[])) and str(g.get('state','')).lower() not in ('complete','completed','finished','final')]
    live=[g for g in reference_games if str(g.get('state','')).lower() in ('playing','live','active','started','in_progress') and g['event_id'] in current_ids]
    shown_games={str(r.get('gameId')) for r in (s.get('scheduleRows') or [])}
    upcoming_missing=[g['id'] for g in upcoming if g['id'] not in shown_games]
    live_missing=[g['id'] for g in live if g['id'] not in shown_games]
    conflicts=[]
    for row in (s.get('scheduleRows') or []):
        matches=[g for g in reference_games if g['event_id']==str(s.get('eventId')) and g['id']==str(row.get('gameId'))]
        if matches and row.get('game'):
            actual=row['game'].get('sides') or row['game'].get('game_positions') or row['game'].get('positions') or []
            def scores(positions):return {str(p.get('team_id')):p.get('score') for p in positions}
            if str(matches[0].get('state','')).lower() in ('complete','completed','final','finished') and scores(actual)!=scores(matches[0]['positions']):conflicts.append(str(row.get('gameId')))
    missing=sorted(expected_ids-shown_ids)
    matching=sorted(expected_ids&shown_ids)
    field_differences=[]
    if identity=='MATCH':
        for row in history:
            eid=str(row.get('eventId') or '')
            if not eid:
                match=re.search(r'/events/(\d+)',str(row.get('sourceUrl','')))
                if match:eid=match.group(1)
            expected_rows=[r for r in person['reference_history'] if str(r['event_id'])==eid]
            if not expected_rows:continue
            if norm(row.get('title','')) not in {norm(r['name']) for r in expected_rows}:field_differences.append({'event_id':eid,'field':'event_title','displayed':row.get('title'),'source':sorted(set(r['name'] for r in expected_rows))})
            if row.get('startsOn') and all(date(row['startsOn'])!=date(r['starts_on']) for r in expected_rows):field_differences.append({'event_id':eid,'field':'start_date','displayed':row.get('startsOn'),'source':sorted(set(str(r['starts_on']) for r in expected_rows))})
            if not any(norm(r['team_name']) in norm(row.get('detail','')) for r in expected_rows):field_differences.append({'event_id':eid,'field':'team_name','displayed':row.get('detail'),'source':sorted(set(r['team_name'] for r in expected_rows))})
    incomplete=bool(re.search(r'incomplete|unavailable|timed out|could not|couldn.t',obs.get('status',''),re.I))
    if unexpected or conflicts or returned_record in ('SOURCE_CURler_ID_NOT_ON_RETURNED_EVENT_ROSTER','RETURNED_TEAM_DIFFERS_FROM_SOURCE'):outcome='VERIFIED_PROVENANCE_OR_SCORE_CONFLICT'
    elif identity=='DIFFERENT_SOURCE_ID_REQUIRES_REVIEW':outcome='CROSS_SOURCE_OR_ID_REVIEW'
    elif current=='VERIFIED_CURRENT_EVENT_NOT_SHOWN' or upcoming_missing or live_missing:outcome='CURRENT_OR_UPCOMING_MISSING'
    elif not shown_ids:outcome='NO_HISTORY_SHOWN'
    elif missing:outcome='PARTIAL_HISTORY'
    elif field_differences:outcome='REFERENCE_EVENT_DETAILS_DIFFER'
    elif incomplete:outcome='HISTORY_MATCH_LIVE_SEARCH_INCOMPLETE'
    else:outcome='REFERENCE_HISTORY_MATCH'
    return {'outcome':outcome,'identity':identity,'reference_history_events':len(expected_ids),'matched_history_events':matching,'missing_history_events':missing,
            'unexpected_history_events_with_verified_conflict':unexpected,'current_event_check':current,'search_explicitly_incomplete':incomplete,
            'verified_live_games':len(live),'missing_live_game_ids':live_missing,'verified_upcoming_games':len(upcoming),'missing_upcoming_game_ids':upcoming_missing,
            'verified_source_game_count':len(reference_games),'source_score_conflict_game_ids':conflicts,
            'history_field_differences':field_differences,
            'returned_record_validation':returned_record,
            'returned_source_roster_names':sorted(set(p['name'] for event,team,p in returned_rosters)),
            'upcoming_check':'Matched source fixtures only; no whole-internet absence claim','ui_history_limit':20,'note':'Reference history matching does not establish complete internet/career coverage.'}

def run(target):
    oracle=read(OUT/'reference.json');path=OUT/(target+'-results.json')
    report=read(path) if path.exists() else {'target':target,'url':TARGETS[target],'started_at':stamp(),'results':[]}
    retry=[r for r in report['results'] if 'element click intercepted' in r.get('error','')]
    if retry:
        report.setdefault('harness_retry_observations',[]).extend(retry)
        report['results']=[r for r in report['results'] if r not in retry]
        save(path,report)
    done={(r['association'],r['source_curler_id'],norm(r['name'])) for r in report['results']}
    d=browser()
    try:
        d.get(TARGETS[target]);WebDriverWait(d,30).until(lambda d:d.execute_script("return typeof startTracking==='function'"));time.sleep(2)
        report['browser']=d.capabilities.get('browserVersion')
        for person in oracle['sample']:
            key=(person['association'],person['source_curler_id'],norm(person['name']))
            if key in done:continue
            t=time.monotonic();result={'name':person['name'],'association':person['association'],'source_curler_id':person['source_curler_id'],'started_at':stamp(),'reference_urls':sorted(set(r['source_url'] for r in person['reference_history']))}
            try:
                field=d.find_element(By.ID,'playerInput')
                d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",field)
                field.clear();field.send_keys(person['name'])
                submit=d.find_element(By.ID,'searchSubmitBtn')
                d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",submit)
                time.sleep(.2);submit.click()
                WebDriverWait(d,5).until(lambda _:d.execute_script('return state.playerName===arguments[0]',person['name']))
                WebDriverWait(d,95).until(lambda _:d.execute_script('return !state.isRunning'))
                result['search_ms']=round((time.monotonic()-t)*1000)
                btn=d.find_element(By.ID,'careerLoadBtn')
                if btn.is_displayed() and btn.is_enabled():
                    d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",btn)
                    time.sleep(.2);btn.click();WebDriverWait(d,65).until(lambda _:d.execute_script('return !state.careerLoading'))
                obs=observation(d);result['observation']=obs;result['comparison']=compare(person,obs,oracle)
                idx=len(report['results'])
                if idx%10==0 or result['comparison']['outcome'] in ('VERIFIED_PROVENANCE_CONFLICT','CURRENT_EVENT_MISSING','NO_HISTORY_SHOWN'):
                    d.save_screenshot(str(OUT/f'{target}-{idx+1:02d}.png'))
            except Exception as exc:
                result.update({'error':str(exc),'comparison':{'outcome':'SEARCH_OR_BROWSER_TIMEOUT'}})
                try:result['observation']=observation(d)
                except Exception:pass
            result['finished_at']=stamp();report['results'].append(result);report['updated_at']=stamp();report['summary']=dict(Counter(r['comparison']['outcome'] for r in report['results']))
            save(path,report)
            save(OUT/'checkpoint.json',{'updated_at':stamp(),'target':target,'completed':len(report['results']),'total':len(oracle['sample']),'last_curler':person['name'],'exact_resume_command':f'python tools\\Curler-Field-Audit.py --run {target}','no_background_claim':'This checkpoint records actual completed searches; a process must be running to continue.'})
            print(json.dumps({'target':target,'completed':len(report['results']),'name':person['name'],'association':person['association'],'result':result['comparison'],'elapsed_ms':result.get('search_ms')}),flush=True)
            time.sleep(2)
        report['finished_at']=stamp();report['complete']=len(report['results'])==len(oracle['sample']);save(path,report)
    finally:d.quit()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--prepare',action='store_true');parser.add_argument('--run',choices=list(TARGETS));parser.add_argument('--event-limit',type=int,default=360);a=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);CACHE.mkdir(parents=True,exist_ok=True)
    if a.prepare:prepare(a.event_limit)
    if a.run:run(a.run)
