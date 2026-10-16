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
    def test_running_heartbeat_does_not_mask_failed_collection(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data/global').mkdir(parents=True)
            (root / 'data/global/collector-runtime.json').write_text(json.dumps({
                'heartbeat_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'phase': 'idle'}))
            report = health.assess(root, root)
            self.assertFalse(report['healthy'])
            self.assertEqual(report['checks'][0]['status'], 'PASS')
            self.assertEqual(report['checks'][1]['status'], 'FAIL')

    def test_invalid_and_naive_timestamps_fail_closed(self):
        now = dt.datetime.now(dt.timezone.utc)
        for value in (None, 'invalid', '2026-10-16T01:00:00'):
            self.assertEqual(health.age_hours(value, now), float('inf'))

if __name__ == '__main__':
    unittest.main()
