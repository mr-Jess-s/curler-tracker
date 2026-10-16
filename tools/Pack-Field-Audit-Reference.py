"""Persist full verified reference once, compressed; expose a readable selected-curler list."""
import gzip,hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'release-evidence/2026-10-16/field-audit'
body=(root/'reference.json').read_bytes()
(root/'reference.json.gz').write_bytes(gzip.compress(body,mtime=0))
data=json.loads(body.decode('utf-8'))
(root/'selected-curlers.json').write_text(json.dumps({'created_at':data['created_at'],'sample':data['sample'],'catalog':data['catalog'],'source_errors':data['errors'],'reference_json_sha256':hashlib.sha256(body).hexdigest(),'hash_note':'Event payload hashes cover normalized json.dumps(payload,sort_keys=True); not raw HTTP encoding.'},indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'reference_bytes':len(body),'compressed_bytes':(root/'reference.json.gz').stat().st_size,'sample':len(data['sample'])}))
