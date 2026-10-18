import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('health', Path(__file__).with_name('Operations-Health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
    def write_fixture(self, root, stamp, errors=None):
        (root / 'data').mkdir(parents=True)
        (root / 'data/history-manifest.json').write_text(json.dumps({
            'generated_at': stamp, 'errors': errors or [],
            'files': [{'appearances': 10}]}))
        (root / 'data/curler-name-catalog.json').write_text(json.dumps({
            'generated_at': stamp, 'name_count': 5}))
        (root / 'data/home-summary.json').write_text(json.dumps({'generated_at': stamp}))
        (root / 'backup-state.json').write_text(json.dumps({
            'copied_at': stamp, 'robocopy_exit': 1, 'bundle_bytes': 100,
            'cloud_upload_verified': False}))

    def test_fresh_valid_outputs_are_healthy(self):
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.write_fixture(root, now.isoformat())
            self.assertTrue(health.assess(root, root, now)['healthy'])

    def test_archive_error_fails_closed(self):
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.write_fixture(root, now.isoformat(), ['failed source'])
            report = health.assess(root, root, now)
            self.assertFalse(report['healthy'])
            check = next(c for c in report['checks'] if c['name'] == 'archive_validation')
            self.assertEqual(check['status'], 'FAIL')

    def test_invalid_and_naive_timestamps_fail_closed(self):
        now = dt.datetime.now(dt.timezone.utc)
        for value in (None, 'invalid', '2026-10-16T01:00:00'):
            self.assertEqual(health.age_hours(value, now), float('inf'))


if __name__ == '__main__':
    unittest.main()
