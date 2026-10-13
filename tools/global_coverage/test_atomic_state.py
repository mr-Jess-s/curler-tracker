import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import os
import atomic_state

class AtomicStateTests(unittest.TestCase):
    def test_sharing_violation_retries_then_replaces(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder)/'state.json'
            p.write_text('{"old":true}')
            real = os.replace
            calls = []
            def replace(src,dst):
                calls.append(1)
                if len(calls) < 3: raise PermissionError('sharing violation')
                return real(src,dst)
            with patch.object(atomic_state.os,'replace',side_effect=replace), patch.object(atomic_state.time,'sleep'):
                atomic_state.atomic_json(p,{'new':True})
            self.assertEqual(json.loads(p.read_text()),{'new':True})
            self.assertEqual(len(calls),3)
    def test_persistent_denial_preserves_previous_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'state.json';p.write_text('{"old":true}')
            with patch.object(atomic_state.os,'replace',side_effect=PermissionError('denied')), patch.object(atomic_state.time,'sleep'):
                with self.assertRaises(PermissionError): atomic_state.atomic_json(p,{'new':True},attempts=2)
            self.assertEqual(json.loads(p.read_text()),{'old':True})
            self.assertEqual(list(Path(folder).glob('*.tmp')),[])
