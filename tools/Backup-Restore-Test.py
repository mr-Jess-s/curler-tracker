"""Non-destructive restore verification; never modifies the backup or live archive."""
import argparse,datetime,hashlib,json,shutil,subprocess,tempfile,gzip
from pathlib import Path

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def run(backup,out):
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    destination=Path(tempfile.mkdtemp(prefix='CurlerTracker-full-restore-'))
    backup=Path(backup); project=backup/'project'; restored=destination/'project'
    shutil.copytree(project,restored)
    files=list(project.rglob('*'));files=[p for p in files if p.is_file()]
    mismatches=[];invalid=[];total=0;raw_count=0;raw_bytes=0;json_count=0
    for p in files:
        relative=p.relative_to(project);target=restored/relative
        total+=p.stat().st_size
        if digest(p)!=digest(target):mismatches.append(str(relative))
        if relative.parts[:2]==('data','raw'):
            raw_count+=1;raw_bytes+=target.stat().st_size
            if target.suffix=='.gz':
                try:
                    with gzip.open(target,'rb') as stream:
                        while stream.read(1024*1024):pass
                except Exception as e:invalid.append({'file':str(relative),'error':str(e)})
        elif relative.parts and relative.parts[0]=='data' and target.suffix=='.json':
            try:json.loads(target.read_text(encoding='utf-8-sig'));json_count+=1
            except Exception as e:invalid.append({'file':str(relative),'error':str(e)})
    clone=subprocess.run(['git','clone',str(backup/'curler-tracker-repository.bundle'),str(destination/'git')],capture_output=True,text=True)
    fsck=subprocess.run(['git','-C',str(destination/'git'),'fsck','--full'],capture_output=True,text=True) if clone.returncode==0 else clone
    regress=subprocess.run(['node',str(destination/'git'/'tools'/'Release-Regression.mjs')],capture_output=True,text=True) if clone.returncode==0 else clone
    report={'started_at':started,'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'restore_directory':str(destination),'files_restored':len(files),'bytes_restored':total,'raw_files_restored':raw_count,'raw_bytes_restored':raw_bytes,'normalized_json_validated':json_count,'mismatches':mismatches,'invalid_files':invalid,'git_clone_exit':clone.returncode,'git_fsck_exit':fsck.returncode,'restored_regression_exit':regress.returncode,'restored_regression_log':regress.stdout,'cloud_sync_verified':False,'passed':not mismatches and not invalid and clone.returncode==fsck.returncode==regress.returncode==0}
    Path(out).parent.mkdir(parents=True,exist_ok=True);Path(out).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('backup');p.add_argument('out');a=p.parse_args();run(a.backup,a.out)
