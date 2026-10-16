"""Small bounded static-only preview load probe; never requests curling sources."""
import argparse,concurrent.futures,datetime,json,statistics,time,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('out');a=p.parse_args()
if '-jess-and-roo.vercel.app' not in a.url or 'curler-tracker.vercel.app' in a.url:raise SystemExit('Only an isolated project preview is permitted.')
paths=['/','/app.js','/data/home-summary.json'];start=time.perf_counter()
def fetch(i):
 t=time.perf_counter();path=paths[i%3]
 try:
  with urllib.request.urlopen(a.url+path,timeout=15) as r:body=r.read();status=r.status;cache=r.headers.get('x-vercel-cache');size=len(body)
  return {'path':path,'ms':round((time.perf_counter()-t)*1000,2),'status':status,'bytes':size,'cache':cache}
 except Exception as e:return {'path':path,'ms':round((time.perf_counter()-t)*1000,2),'status':0,'error':str(e)}
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for batch in range(12):
  batchstart=time.perf_counter();results.extend(pool.map(fetch,range(batch*5,batch*5+5)));time.sleep(max(0,1-(time.perf_counter()-batchstart)))
lat=sorted(r['ms'] for r in results);report={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':a.url,'scope':'60 static requests; maximum concurrency 5; no more than 5 requests/second; no source API traffic','duration_seconds':round(time.perf_counter()-start,2),'requests':60,'errors':sum(r['status']!=200 for r in results),'p50_ms':statistics.median(lat),'p95_ms':lat[int(len(lat)*.95)-1],'max_ms':max(lat),'total_bytes':sum(r.get('bytes',0) for r in results),'thresholds':{'max_errors':0,'p95_ms':2000},'results':results,'capacity_claim':'This limited probe does not establish television surge capacity.'};report['passed']=report['errors']==0 and report['p95_ms']<=2000;Path(a.out).write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='results'}))
