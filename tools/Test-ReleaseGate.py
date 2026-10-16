import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('Check-ReleaseGate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class GateTests(unittest.TestCase):
    def test_missing_evidence_fails(self):
        self.assertFalse(gate.validate({}, 'abc')[0])

    def test_blocked_gate_fails(self):
        evidence = {'tested_commit': 'abc', 'rollback_deployment': 'dpl_test',
                    'gates': {name: {'status': 'PASS', 'timestamp': 'fixture', 'artifact': 'fixture'} for name in gate.MANDATORY}}
        self.assertTrue(gate.validate(evidence, 'abc')[0])
        evidence['gates']['backup_restore']['status'] = 'BLOCKED'
        self.assertFalse(gate.validate(evidence, 'abc')[0])

    def test_stale_commit_fails(self):
        self.assertFalse(gate.validate({'tested_commit': 'old'}, 'new')[0])

if __name__ == '__main__':
    unittest.main()
