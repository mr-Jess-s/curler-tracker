"""Deterministic release health based on durable successful outputs."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

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


def scheduled_tasks():
    if os.name != 'nt':
        return {}
    names = [
        'CurlerTracker-ArthurAutomation',
        'CurlerTracker-VerifiedPublisher',
        'CurlerTracker-OperationsHealth',
        'CurlerTracker-ArchiveBackup',
        'CurlerTracker-CollectorBackup',
    ]
    script = (
        "$rows=@();"
        + "".join(
            "$i=Get-ScheduledTaskInfo -TaskName '%s' -ErrorAction SilentlyContinue;"
            "$t=Get-ScheduledTask -TaskName '%s' -ErrorAction SilentlyContinue;"
            "if($i -and $t){$rows+=[pscustomobject]@{Name='%s';LastTaskResult=$i.LastTaskResult;"
            "LastRunTime=$i.LastRunTime.ToUniversalTime().ToString('o');"
            "NextRunTime=$i.NextRunTime.ToUniversalTime().ToString('o');State=[string]$t.State}};"
            % (name, name, name) for name in names
        )
        + "$rows|ConvertTo-Json -Compress"
    )
    result = subprocess.run(
        ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        capture_output=True, text=True, timeout=20,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return {}
    payload = json.loads(result.stdout)
    if isinstance(payload, dict):
        payload = [payload]
    return {row['Name']: row for row in payload}


def fetch_json(url):
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'CurlerTracker-health/1'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, dict(response.headers), json.load(response)


def assess(root, state_dir, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    checks = []

    def check(name, ok, detail):
        checks.append({'name': name, 'status': 'PASS' if ok else 'FAIL', 'detail': detail})

    artifacts = (
        ('history_archive', root / 'data/history-manifest.json', 192),
        ('name_index', root / 'data/curler-name-catalog.json', 30),
        ('source_cache', root / 'data/source-cache/manifest.json', 30),
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
    shard_paths = sorted((root / 'data/name-catalog').glob('*.json'))
    valid_shards = 0
    for shard_path in shard_paths:
        shard = read_json(shard_path)
        if shard.get('schema_version') == 1 and isinstance(shard.get('names'), list):
            valid_shards += 1
    check('name_shards_validation', len(shard_paths) >= 52 and valid_shards == len(shard_paths),
          {'shards': len(shard_paths), 'valid_shards': valid_shards})

    source_cache = read_json(root / 'data/source-cache/manifest.json')
    source_list_count = source_cache.get('competition_lists', 0)
    source_event_count = source_cache.get('event_records', 0)
    source_referenced = source_cache.get('referenced_events', 0)
    source_cached = source_cache.get('referenced_events_cached', 0)
    check('source_cache_validation', source_list_count >= 28 and source_event_count >= 100
          and source_referenced > 0 and source_cached > 0,
          {'competition_lists': source_list_count, 'event_records': source_event_count,
           'referenced_events': source_referenced, 'referenced_events_cached': source_cached})

    backup = read_json(state_dir / 'backup-state.json')
    expected_source = str(root.resolve()).casefold()
    actual_source = str(backup.get('source') or '').casefold()
    check('backup_local_freshness', age_hours(backup.get('copied_at'), now) <= 30
          and isinstance(backup.get('robocopy_exit'), int) and backup['robocopy_exit'] < 8
          and backup.get('bundle_bytes', 0) > 0
          and backup.get('project_files', 0) > 0
          and actual_source == expected_source
          and backup.get('tracked_clean') is True,
          {'last_copy': backup.get('copied_at'), 'copy_exit': backup.get('robocopy_exit'),
           'bundle_bytes': backup.get('bundle_bytes'), 'project_files': backup.get('project_files'),
           'source': backup.get('source'), 'source_commit': backup.get('source_commit'),
           'tracked_clean': backup.get('tracked_clean'),
           'cloud_sync_verified': backup.get('cloud_upload_verified', False)})

    collector_backup = read_json(state_dir / 'collector-backup-state.json')
    collector_archives = collector_backup.get('archives', [])
    check('collector_backup_local_freshness',
          age_hours(collector_backup.get('copied_at'), now) <= 30
          and len(collector_archives) == 2
          and all(row.get('robocopy_exit', 8) < 8 and row.get('files', 0) > 0
                  for row in collector_archives),
          {'last_copy': collector_backup.get('copied_at'),
           'source': collector_backup.get('source'),
           'archives': collector_archives,
           'cloud_sync_verified': collector_backup.get('cloud_upload_verified', False)})

    collector_root = Path(os.environ.get('CT_COLLECTOR_ROOT', r'C:\Jess\curler-tracker'))
    collector_runtime = read_json(collector_root / 'data/global/collector-runtime.json')
    maintenance = read_json(collector_root / 'data/global/maintenance-state.json')
    task_rows = maintenance.get('tasks', {})
    collector_ok = (
        age_hours(collector_runtime.get('heartbeat_at'), now) <= 1
        and age_hours(maintenance.get('updated_at'), now) <= 8
        and bool(task_rows)
        and all(row.get('consecutive_failures', 0) == 0 for row in task_rows.values())
    )
    check('collector_runtime', collector_ok,
          {'root': str(collector_root), 'phase': collector_runtime.get('phase'),
           'heartbeat_at': collector_runtime.get('heartbeat_at'),
           'maintenance_updated_at': maintenance.get('updated_at'),
           'tasks': len(task_rows),
           'failed_tasks': [name for name, row in task_rows.items()
                            if row.get('consecutive_failures', 0) != 0]})

    tasks = scheduled_tasks()
    for task_name in (
        'CurlerTracker-ArthurAutomation',
        'CurlerTracker-VerifiedPublisher',
        'CurlerTracker-OperationsHealth',
        'CurlerTracker-ArchiveBackup',
        'CurlerTracker-CollectorBackup',
    ):
        task = tasks.get(task_name, {})
        if task_name == 'CurlerTracker-OperationsHealth':
            task_ok = (bool(task) and task.get('State') in ('Ready', 'Running')
                       and age_hours(task.get('LastRunTime'), now) <= 1)
        else:
            task_ok = (bool(task) and task.get('LastTaskResult') == 0
                       and task.get('State') in ('Ready', 'Running'))
        check('scheduled_task_' + task_name.removeprefix('CurlerTracker-').lower(),
              task_ok, task or {'error': 'task missing or unreadable'})

    production_url = os.environ.get('CT_PRODUCTION_URL', 'https://curler-tracker.vercel.app')
    published = read_json(state_dir / 'last-published.json')
    try:
        release_status, _, release = fetch_json(production_url.rstrip('/') + '/release.json')
        release_ok = (
            release_status == 200
            and bool(published.get('commit'))
            and release.get('commit') == published.get('commit')
            and release.get('version') == published.get('version')
        )
        check('production_release_identity', release_ok,
              {'url': production_url, 'live_commit': release.get('commit'),
               'published_commit': published.get('commit'), 'version': release.get('version')})
    except Exception as error:
        check('production_release_identity', False, {'url': production_url, 'error': str(error)})
    try:
        status, headers, payload = fetch_json(
            production_url.rstrip('/') + '/api/curling-io?kind=competitions&subdomain=ab&occurred=0'
        )
        cache_control = headers.get('Cache-Control', '') + headers.get('Vercel-CDN-Cache-Control', '')
        check('production_source_service', status == 200 and isinstance(payload, dict)
              and 's-maxage=' in cache_control,
              {'status': status, 'cache_control': cache_control})
    except Exception as error:
        check('production_source_service', False, {'error': str(error)})

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
