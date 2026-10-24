import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('health', Path(__file__).with_name('Operations-Health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
    def write_fixture(self, root, stamp, errors=None):
        data = root / 'data'
        data.mkdir(parents=True)
        (root / 'data/history-manifest.json').write_text(json.dumps({
            'generated_at': stamp, 'errors': errors or [],
            'files': [{'appearances': 10}]}))
        (root / 'data/curler-name-catalog.json').write_text(json.dumps({
            'generated_at': stamp, 'name_count': 5}))
        (root / 'data/home-summary.json').write_text(json.dumps({'generated_at': stamp}))
        (data / 'source-cache').mkdir()
        (data / 'source-cache/manifest.json').write_text(json.dumps({
            'generated_at': stamp, 'competition_lists': 28, 'event_records': 100,
            'referenced_events': 200, 'referenced_events_cached': 100}))
        shards = data / 'name-catalog'
        shards.mkdir()
        for kind in ('first', 'last'):
            for letter in 'abcdefghijklmnopqrstuvwxyz':
                (shards / f'{kind}-{letter}.json').write_text(json.dumps({
                    'schema_version': 1, 'names': []}))
            (shards / f'{kind}-other.json').write_text(json.dumps({
                'schema_version': 1, 'names': []}))
        (data / 'global').mkdir()
        (data / 'global/collector-runtime.json').write_text(json.dumps({'heartbeat_at': stamp}))
        (data / 'global/maintenance-state.json').write_text(json.dumps({
            'updated_at': stamp, 'tasks': {'fixture': {'consecutive_failures': 0}}}))
        (root / 'backup-state.json').write_text(json.dumps({
            'copied_at': stamp, 'robocopy_exit': 1, 'bundle_bytes': 100,
            'project_files': 10, 'source': str(root.resolve()), 'tracked_clean': True,
            'cloud_upload_verified': False}))
        (root / 'collector-backup-state.json').write_text(json.dumps({
            'copied_at': stamp, 'archives': [
                {'robocopy_exit': 1, 'files': 1}, {'robocopy_exit': 1, 'files': 1}],
            'cloud_upload_verified': False}))
        (root / 'last-published.json').write_text(json.dumps({'commit': 'abc', 'version': 'vTest'}))

    def assess_fixture(self, root, now):
        tasks = {
            'CurlerTracker-ArthurAutomation': {'LastTaskResult': 0, 'State': 'Ready'},
            'CurlerTracker-VerifiedPublisher': {'LastTaskResult': 0, 'State': 'Ready'},
            'CurlerTracker-OperationsHealth': {'State': 'Ready', 'LastRunTime': now.isoformat()},
            'CurlerTracker-ArchiveBackup': {'LastTaskResult': 0, 'State': 'Ready'},
            'CurlerTracker-CollectorBackup': {'LastTaskResult': 0, 'State': 'Ready'},
        }
        def fetch(url):
            if url.endswith('/release.json'):
                return 200, {}, {'commit': 'abc', 'version': 'vTest'}
            return 200, {'Cache-Control': 'public, s-maxage=300'}, {}
        disk = SimpleNamespace(total=20 * 1024**3, used=1, free=19 * 1024**3)
        with patch.object(health, 'scheduled_tasks', return_value=tasks), \
             patch.object(health, 'fetch_json', side_effect=fetch), \
             patch.object(health.shutil, 'disk_usage', return_value=disk), \
             patch.dict('os.environ', {'CT_COLLECTOR_ROOT': str(root)}):
            return health.assess(root, root, now)

    def test_fresh_valid_outputs_are_healthy(self):
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.write_fixture(root, now.isoformat())
            self.assertTrue(self.assess_fixture(root, now)['healthy'])

    def test_archive_error_fails_closed(self):
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.write_fixture(root, now.isoformat(), ['failed source'])
            report = self.assess_fixture(root, now)
            self.assertFalse(report['healthy'])
            check = next(c for c in report['checks'] if c['name'] == 'archive_validation')
            self.assertEqual(check['status'], 'FAIL')

    def test_invalid_and_naive_timestamps_fail_closed(self):
        now = dt.datetime.now(dt.timezone.utc)
        for value in (None, 'invalid', '2026-10-16T01:00:00'):
            self.assertEqual(health.age_hours(value, now), float('inf'))


if __name__ == '__main__':
    unittest.main()
