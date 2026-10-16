"""Read-only byte verification of a staged or public deployment against its build."""
import argparse,concurrent.futures,datetime,hashlib,json,sys,urllib.request
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
    # vercel.json config is intentionally not served as a public asset.
    items=[item for item in manifest['files'].items() if item[0]!='vercel.json']
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(one,items))
    with urllib.request.urlopen(base.rstrip('/')+'/release.json',timeout=30) as response:remote=json.load(response)
    result={'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':base,'commit':manifest['commit'],'version':manifest['version'],'manifest_matches':remote==manifest,'checks':results,'passed':all(r['pass'] for r in results) and remote==manifest}
    return result
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('build');p.add_argument('--out',required=True);a=p.parse_args()
    r=verify(a.url,a.build);Path(a.out).parent.mkdir(parents=True,exist_ok=True);Path(a.out).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'passed':r['passed'],'files':len(r['checks']),'commit':r['commit']}));sys.exit(0 if r['passed'] else 1)
