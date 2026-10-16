"""Read-only staging transport/header and private-path checks; not a penetration test."""
import argparse
import datetime as dt
import json
from pathlib import Path
import urllib.error
import urllib.request

p = argparse.ArgumentParser()
p.add_argument('url')
p.add_argument('out')
a = p.parse_args()
base = a.url.rstrip('/')
checks = []
def check(name, passed, detail):
    checks.append({'name': name, 'status': 'PASS' if passed else 'FAIL', 'detail': detail})
with urllib.request.urlopen(base + '/', timeout=30) as r:
    headers = dict(r.headers.items())
    h = {k.lower(): v for k, v in headers.items()}
    check('https_transport', r.url.startswith('https://'), r.url)
    for key, expected in [('x-content-type-options', 'nosniff'), ('x-frame-options', 'DENY'),
                          ('referrer-policy', 'no-referrer')]:
        check(key, h.get(key) == expected, h.get(key))
    csp = h.get('content-security-policy', '')
    check('restrictive_csp', all(s in csp for s in ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "script-src 'self'"]) and 'unsafe-eval' not in csp, csp)
    check('permissions_policy', 'camera=()' in h.get('permissions-policy', '') and 'geolocation=()' in h.get('permissions-policy', ''), h.get('permissions-policy'))
for path in ['/.git/config', '/.env', '/tools/Backup-CurlerTracker.ps1', '/data/raw/', '/data/global/maintenance-state.json', '/vercel.json']:
    try:
        with urllib.request.urlopen(base + path, timeout=20) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
        e.close()
    check('not_public_' + path, status in (403, 404), status)
with urllib.request.urlopen(base + '/sw.js', timeout=20) as r:
    check('service_worker_no_cache', 'no-cache' in r.headers.get('Cache-Control', ''), r.headers.get('Cache-Control'))
with urllib.request.urlopen(base + '/data/home-summary.json', timeout=20) as r:
    check('data_browser_cache', 'max-age=300' in r.headers.get('Cache-Control', ''), r.headers.get('Cache-Control'))
report = {'timestamp': dt.datetime.now(dt.timezone.utc).isoformat(), 'url': base, 'checks': checks,
          'passed': sum(c['status'] == 'PASS' for c in checks), 'failed': sum(c['status'] == 'FAIL' for c in checks),
          'limitation': 'These checks do not establish absence of all exposed secrets or complete account permissions/legal compliance.'}
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
Path(a.out).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
raise SystemExit(1 if report['failed'] else 0)
