"""Repeat the fixed 71-person browser field audit with deterministic typos."""
import argparse
from collections import Counter
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import time
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('field',ROOT/'tools/Curler-Field-Audit.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
BASE=a.OUT
OUT=ROOT/'release-evidence/2026-10-16/typo-audit'
TRANSLATE=str.maketrans({'i':'o','I':'O','r':'t','R':'T'})
def typo(name):return name.translate(TRANSLATE)
def profile(obs):
 s=(obs or {}).get('snapshot') or {}
 return (s.get('sourceSubdomain'),str(s.get('sourceCurlerId'))) if s.get('sourceSubdomain') and s.get('sourceCurlerId') else None
def assess(person,obs,baseline,oracle):
 actual=profile(obs);expected=profile(baseline.get('observation'));s=obs.get('snapshot') or {}
 verified_names=[]
 for e in oracle['events']:
  if e['association']==s.get('sourceSubdomain') and str(e['event_id'])==str(s.get('eventId')):
   verified_names=[p['name'] for t in e['teams'] for p in t['lineup'] if str(p['id'])==str(s.get('sourceCurlerId'))]
 if not actual:outcome='NO_SOURCED_PROFILE'
 elif actual==expected:outcome='SAME_PROFILE_AS_EXACT_SEARCH'
 elif a.norm(person['name']) in {a.norm(n) for n in verified_names}:outcome='DIFFERENT_VERIFIED_PROFILE_REVIEW'
 else:outcome='DIFFERENT_OR_UNVERIFIED_PERSON_REVIEW'
 history=a.compare(person,obs,oracle)
 return {'profile_recovery':outcome,'baseline_profile':expected,'returned_profile':actual,
         'returned_roster_names':verified_names,'source_comparison':history,
         'changed_query':typo(person['name'])!=person['name'],
         'baseline_had_profile':bool(expected),'baseline_source_comparison':baseline['comparison']}
def run(target):
 oracle=a.read(BASE/'reference.json');baseline=a.read(BASE/(target+'-results.json'))
 path=OUT/(target+'-results.json');report=a.read(path) if path.exists() else {'target':target,'url':a.TARGETS[target],'started_at':a.stamp(),'rule':'Apply i→o and r→t simultaneously, case-insensitively, preserving case; no other spelling changes.','results':[]}
 originals={r['name']:r for r in baseline['results']};done={r['name'] for r in report['results']}
 d=a.browser()
 try:
  d.get(a.TARGETS[target]);a.WebDriverWait(d,30).until(lambda _:d.execute_script("return typeof startTracking==='function'"));time.sleep(3)
  report['browser_version']=d.capabilities.get('browserVersion')
  for person in oracle['sample']:
   if person['name'] in done:continue
   query=typo(person['name']);t=time.monotonic()
   result={'name':person['name'],'query':query,'association':person['association'],'started_at':a.stamp()}
   try:
    field=d.find_element(a.By.ID,'playerInput');d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",field)
    field.clear();field.send_keys(query)
    button=d.find_element(a.By.ID,'searchSubmitBtn');d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",button);time.sleep(.2);button.click()
    a.WebDriverWait(d,5).until(lambda _:d.execute_script('return state.playerName===arguments[0]',query))
    a.WebDriverWait(d,95).until(lambda _:d.execute_script('return !state.isRunning'))
    result['search_ms']=round((time.monotonic()-t)*1000)
    button=d.find_element(a.By.ID,'careerLoadBtn')
    if button.is_displayed() and button.is_enabled():
     d.execute_script("arguments[0].scrollIntoView({behavior:'instant',block:'center'})",button);time.sleep(.2);button.click()
     a.WebDriverWait(d,65).until(lambda _:d.execute_script('return !state.careerLoading'))
    obs=a.observation(d);result['observation']=obs;result['comparison']=assess(person,obs,originals[person['name']],oracle)
    if len(report['results'])%10==0:d.save_screenshot(str(OUT/f'{target}-{len(report["results"])+1:02d}.png'))
   except Exception as exc:
    result['error']=str(exc);result['comparison']={'profile_recovery':'HARNESS_ERROR'}
    try:result['observation']=a.observation(d)
    except Exception:pass
   result['finished_at']=a.stamp();report['results'].append(result);report['updated_at']=a.stamp()
   report['summary']=dict(Counter(r['comparison']['profile_recovery'] for r in report['results']))
   a.save(path,report)
   a.save(OUT/'checkpoint.json',{'updated_at':a.stamp(),'target':target,'completed':len(report['results']),'total':len(oracle['sample']),'last_name':person['name'],'last_query':query,'exact_resume_command':f'python tools/Curler-Typo-Audit.py --run {target}','process_note':'Continuation requires an actual running process.'})
   print(json.dumps({'target':target,'completed':len(report['results']),'name':person['name'],'query':query,'outcome':result['comparison']['profile_recovery'],'search_ms':result.get('search_ms')}),flush=True)
   time.sleep(2)
  report['complete']=len(report['results'])==len(oracle['sample']);report['finished_at']=a.stamp();a.save(path,report)
 finally:d.quit()

def render():
 oracle=a.read(BASE/'reference.json');reports={t:a.read(OUT/(t+'-results.json')) for t in a.TARGETS if (OUT/(t+'-results.json')).exists()}
 manifest={'reference_file_sha256':hashlib.sha256((BASE/'reference.json.gz').read_bytes()).hexdigest(),'baseline_file_sha256':{t:hashlib.sha256((BASE/(t+'-results.json')).read_bytes()).hexdigest() for t in a.TARGETS},'queries':[{'name':p['name'],'query':typo(p['name']),'changed':typo(p['name'])!=p['name'],'association':p['association'],'reference_source_curler_id':p.get('source_curler_id')} for p in oracle['sample']]}
 manifest_path=OUT/'query-manifest.json'
 if manifest_path.exists():assert a.read(manifest_path)==manifest,'Original baseline/reference files changed during the typo run'
 else:a.save(manifest_path,manifest)
 summary={'reported_at':a.stamp(),'sample_size':len(oracle['sample']),'changed_names':sum(typo(p['name'])!=p['name'] for p in oracle['sample']),'rule':'i→o; r→t; simultaneous and case-insensitive, preserving case','targets':{}}
 lines=['# Typo search comparison','',f"Reported {summary['reported_at']}. Fixed sample: {summary['sample_size']} people; {summary['changed_names']} queries changed.",'','Rule: replace every i with o and every r with t simultaneously, regardless of case, preserving capitalization. Examples below show the exact submitted query. Original field-audit evidence remains unchanged.','', 'A recovery means the same source association and native curler ID as the exact-spelling search. This is a paired retrieval measure, not proof of identity: six exact-spelling production cases already required source/profile review. Different profiles and unverifiable identities are excluded from recovery. No sourced result is not proof of no history. Unchanged queries are reported separately.','', '| Target | Exact-spelling sourced profiles | Typo same-profile recovery | Recovery among changed queries with baseline profile | Other outcomes |','|---|---:|---:|---:|---|']
 allrows=[]
 for target,report in reports.items():
  baseline=a.read(BASE/(target+'-results.json'));baseline_count=sum(bool(profile(r.get('observation'))) for r in baseline['results'])
  results=report['results'];eligible=[r for r in results if r.get('comparison',{}).get('changed_query') and r['comparison'].get('baseline_had_profile')]
  recovered=sum(r['comparison']['profile_recovery']=='SAME_PROFILE_AS_EXACT_SEARCH' for r in results)
  eligible_recovered=sum(r['comparison']['profile_recovery']=='SAME_PROFILE_AS_EXACT_SEARCH' for r in eligible)
  summary['targets'][target]={'complete':report.get('complete',False),'completed':len(results),'baseline_profile_count':baseline_count,'same_profile_recovered':recovered,'changed_query_eligible':len(eligible),'changed_query_recovered':eligible_recovered,'outcomes':dict(Counter(r['comparison']['profile_recovery'] for r in results)),'versions':sorted({r.get('observation',{}).get('version','unknown') for r in results}),'history_outcomes':dict(Counter(r['comparison'].get('source_comparison',{}).get('outcome','HARNESS_ERROR') for r in results))}
  rate=f'{100*eligible_recovered/len(eligible):.1f}%' if eligible else 'N/A'
  lines.append(f"| {target} | {baseline_count}/71 | {recovered}/{len(results)} | {eligible_recovered}/{len(eligible)} ({rate}) | {json.dumps(summary['targets'][target]['outcomes'])} |")
  for r in results:
   c=r['comparison'];obs=r.get('observation',{});s=obs.get('snapshot') or {}
   allrows.append({'target':target,'original_name':r['name'],'submitted_query':r['query'],'changed_query':c.get('changed_query'),'association':r['association'],'profile_recovery':c['profile_recovery'],'returned_association':s.get('sourceSubdomain'),'returned_curler_id':s.get('sourceCurlerId'),'returned_event':s.get('eventName'),'original_history_outcome':c.get('baseline_source_comparison',{}).get('outcome'),'typo_history_outcome':c.get('source_comparison',{}).get('outcome'),'rendered_status':obs.get('status'),'search_ms':r.get('search_ms'),'tested_at':r['finished_at']})
 lines+=['','## Individual searches','','| Target | Correct name | Submitted typo | Result |','|---|---|---|---|']
 for r in allrows:lines.append(f"| {r['target']} | {r['original_name']} | {r['submitted_query']} | {r['profile_recovery']} |")
 lines+=['','## Limits','','Both builds use actual rendered Edge mobile-emulated searches and the history control, sequentially with two seconds between names. Tests reuse source caches like a returning visitor and do not impose artificial traffic load. Baseline observations were collected earlier the same day, so this is a sequential comparison rather than a simultaneous controlled experiment. Production/staging build versions, timestamps and complete DOM/snapshot observations are saved. No app code, source data or deployment was changed. No verified live fixtures existed in the reference sample. A typo returning the original profile can still have the same older or cross-association history gaps. An ambiguous/no-match response is safer than silently selecting another person.']
 a.save(OUT/'summary.json',summary)
 if allrows:
  with (OUT/'typo-comparison.csv').open('w',newline='',encoding='utf-8-sig') as f:
   w=csv.DictWriter(f,fieldnames=list(allrows[0]));w.writeheader();w.writerows(allrows)
 (ROOT/'TYPO_SEARCH_COMPARISON_REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
 print(json.dumps(summary,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--run',choices=list(a.TARGETS));p.add_argument('--report',action='store_true');args=p.parse_args();OUT.mkdir(parents=True,exist_ok=True)
 if args.run:run(args.run)
 if args.report:render()
