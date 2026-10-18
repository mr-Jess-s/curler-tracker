"""Read-only byte verification of a staged or public deployment against its build."""
import argparse,concurrent.futures,datetime,hashlib,json,sys,urllib.error,urllib.request
from pathlib import Path

def verify(base,build):
    manifest=json.loads((Path(build)/'release.json').read_text(encoding='utf-8-sig'))
    def one(item):
        path,record=item
        try:
            with urllib.request.urlopen(base.rstrip('/')+'/'+path,timeout=30) as response:
                body=response.read();digest=hashlib.sha256(body).hexdigest()
                return {'path':path,'pass':digest==record['sha256'],'status':response.status,'bytes':len(body),'sha256':digest}
        except Exception as error:return {'path':path,'pass':False,'error':str(error)}
    # Deployment configuration, dependency metadata, and function source are
    # intentionally not exposed as static assets. Verify the function by its
    # public contract below instead of expecting its source bytes.
    private_paths={'vercel.json','package.json','api/curling-io.js'}
    items=[item for item in manifest['files'].items() if item[0] not in private_paths]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(one,items))
    with urllib.request.urlopen(base.rstrip('/')+'/release.json',timeout=30) as response:remote=json.load(response)
    try:
        api_url=base.rstrip('/')+'/api/curling-io?kind=competitions&subdomain=ab&occurred=0'
        with urllib.request.urlopen(api_url,timeout=30) as response:
            payload=json.load(response);cache_control=response.headers.get('cache-control','')
            service_check={'path':'api/curling-io','mode':'proxy-cache','pass':response.status==200 and isinstance(payload,dict) and ('s-maxage=' in cache_control or 's-maxage=' in response.headers.get('vercel-cdn-cache-control','')),'status':response.status,'cache_control':cache_control}
    except urllib.error.HTTPError as error:
        try: payload=json.loads(error.read().decode('utf-8'))
        except Exception: payload={}
        cache_control=error.headers.get('cache-control','')
        service_check={'path':'api/curling-io','mode':'source-service-unavailable','pass':False,'status':error.code,'cache_control':cache_control,'error':payload.get('error')}
    except Exception as error:
        service_check={'path':'api/curling-io','pass':False,'error':str(error)}
    result={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':base,'commit':manifest['commit'],'version':manifest['version'],'manifest_matches':remote==manifest,'checks':results,'service_check':service_check,'passed':all(r['pass'] for r in results) and service_check['pass'] and remote==manifest}
    return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('build');p.add_argument('--out',required=True);a=p.parse_args()
    r=verify(a.url,a.build);Path(a.out).parent.mkdir(parents=True,exist_ok=True);Path(a.out).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'passed':r['passed'],'files':len(r['checks']),'commit':r['commit']}));sys.exit(0 if r['passed'] else 1)
