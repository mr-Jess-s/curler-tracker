"""Build only reviewed public assets; exclude private/raw data and repository tools."""
import argparse,datetime,hashlib,json,shutil,subprocess,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FILES=['index.html','app.js','styles.css','sw.js','manifest.webmanifest','package.json','api/curling-io.js','noble-beaver.svg','noble-beaver-icon.svg','privacy.html','robots.txt','sitemap.xml','vercel.json','data/home-summary.json','data/history-manifest.json','data/curler-source-records.json']

def build(destination):
    destination=Path(destination).resolve()
    if destination.exists(): raise ValueError('Use a new build directory; existing builds are recoverable evidence.')
    if ROOT==destination or ROOT in destination.parents: raise ValueError('Build outside the source tree.')
    destination.mkdir(parents=True)
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True).strip()
    if dirty: raise ValueError('Commit reviewed changes before building.')
    paths=[ROOT/p for p in FILES]
    for folder in ['data/history','data/offline-curler-index','data/name-catalog','data/source-cache']:
        paths.extend(sorted((ROOT/folder).rglob('*.json')))
    manifest={}
    for source in paths:
        relative=source.relative_to(ROOT).as_posix(); body=source.read_bytes()
        if source.suffix=='.json': json.loads(body.decode('utf-8-sig'))
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(body)
        manifest[relative]={'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}
    version=re.search(r"APP_VERSION = '([^']+)'",(ROOT/'app.js').read_text()).group(1)
    result={'schema_version':1,'version':version,'commit':commit,'built_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':manifest}
    (destination/'release.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'directory':str(destination),'commit':commit,'version':version,'files':len(manifest)}))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination');build(parser.parse_args().destination)
