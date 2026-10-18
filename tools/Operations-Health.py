"""Deterministic release health based on durable successful outputs."""
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

    artifacts = (
        ('history_archive', root / 'data/history-manifest.json', 192),
        ('name_index', root / 'data/curler-name-catalog.json', 30),
        ('home_summary', root / 'data/home-summary.json', 192),
    )
    for name, path, maximum_age in artifacts:
        payload = read_json(path)
        generated = payload.get('generated_at')
        check(name + '_freshness', age_hours(generated, now) <= maximum_age,
              {'path': str(path), 'generated_at': generated,
               'maximum_age_hours': maximum_age})

    manifest = read_json(root / 'data/history-manifest.json')
    error_count = len(manifest.get('errors', [])) if isinstance(manifest.get('errors'), list) else -1
    appearance_count = sum(item.get('appearances', 0) for item in manifest.get('files', [])
                           if isinstance(item, dict))
    check('archive_validation', error_count == 0 and appearance_count > 0,
          {'errors': error_count, 'appearances': appearance_count,
           'source_files': len(manifest.get('files', []))})

    catalog = read_json(root / 'data/curler-name-catalog.json')
    check('name_index_validation', isinstance(catalog.get('name_count'), int)
          and catalog.get('name_count', 0) > 0,
          {'name_count': catalog.get('name_count')})

    backup = read_json(state_dir / 'backup-state.json')
    check('backup_local_freshness', age_hours(backup.get('copied_at'), now) <= 30
          and isinstance(backup.get('robocopy_exit'), int) and backup['robocopy_exit'] < 8
          and backup.get('bundle_bytes', 0) > 0,
          {'last_copy': backup.get('copied_at'), 'copy_exit': backup.get('robocopy_exit'),
           'bundle_bytes': backup.get('bundle_bytes'),
           'cloud_sync_verified': backup.get('cloud_upload_verified', False)})
    free = shutil.disk_usage(root).free
    check('disk_space', free >= 10 * 1024**3,
          {'free_bytes': free, 'minimum_bytes': 10 * 1024**3})
    return {'schema_version': 2, 'checked_at': now.isoformat(), 'checks': checks,
            'healthy': all(c['status'] == 'PASS' for c in checks),
            'note': ('Local health evidence only. Task Scheduler records a non-zero result on failure; '
                     'external alert delivery is not configured.')}


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
