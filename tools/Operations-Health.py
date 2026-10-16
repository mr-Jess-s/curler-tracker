"""Deterministic operational health: success timestamps, not merely live processes."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'global_coverage'))
from atomic_state import atomic_json


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return {}


def age_hours(stamp, now):
    try:
        value = dt.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if value.tzinfo is None:
            return float('inf')
        return (now - value).total_seconds() / 3600
    except (AttributeError, TypeError, ValueError):
        return float('inf')


def assess(root, state_dir, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    checks = []
    def check(name, ok, detail):
        checks.append({'name': name, 'status': 'PASS' if ok else 'FAIL', 'detail': detail})
    runtime = read_json(root / 'data/global/collector-runtime.json')
    check('collector_heartbeat', age_hours(runtime.get('heartbeat_at'), now) < 0.1,
          {'last_heartbeat': runtime.get('heartbeat_at'), 'phase': runtime.get('phase')})
    state = read_json(root / 'data/global/maintenance-state.json')
    budgets = {'canada_current_season': 12, 'offline_curler_index': 12,
               'world_results': 12, 'coverage_update': 12, 'history_refresh': 192,
               'home_summary': 192, 'country_registry': 48, 'world_site_inventory': 96}
    for name, hours in budgets.items():
        entry = state.get('tasks', {}).get(name, {})
        success = entry.get('last_success_at')
        check('collection_' + name,
              age_hours(success, now) <= hours and entry.get('state') not in ('failed', 'timeout'),
              {'last_success': success, 'state': entry.get('state'), 'maximum_age_hours': hours,
               'error': entry.get('error')})
    backup = read_json(state_dir / 'backup-state.json')
    check('backup_local_freshness', age_hours(backup.get('copied_at'), now) <= 30
          and isinstance(backup.get('robocopy_exit'), int) and backup['robocopy_exit'] < 8,
          {'last_copy': backup.get('copied_at'), 'copy_exit': backup.get('robocopy_exit'),
           'cloud_sync_verified': backup.get('cloud_upload_verified', False)})
    free = shutil.disk_usage(root).free
    check('disk_space', free >= 10 * 1024**3, {'free_bytes': free, 'minimum_bytes': 10 * 1024**3})
    return {'schema_version': 1, 'checked_at': now.isoformat(), 'checks': checks,
            'healthy': all(c['status'] == 'PASS' for c in checks),
            'note': 'No emails sent. A fresh heartbeat cannot override stale collection results.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--state-dir', type=Path,
                        default=Path(os.environ.get('LOCALAPPDATA', str(ROOT / 'qa'))) / 'CurlerTracker')
    args = parser.parse_args()
    report = assess(args.root, args.state_dir)
    atomic_json(args.state_dir / 'operations-health.json', report)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report['healthy'] else 1)
