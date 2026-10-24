import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import maintenance_cycle as cycle
from acquisition_support import SourceBlocked


class MaintenancePolicyTests(unittest.TestCase):
    def test_blocked_source_task_never_starts_network_worker(self):
        state = {"tasks": {"history_refresh": {}}}
        task = {
            "name": "history_refresh",
            "source_host": "api.curling.io",
            "hours": 168,
            "cmd": ["python", "tools/Build-History-Index.py"],
        }
        with patch.object(cycle, "source_policy", side_effect=SourceBlocked("permission required")), \
             patch.object(cycle, "save_state"), \
             patch.object(cycle.subprocess, "run") as run:
            result = cycle.run_task(task, state)

        self.assertEqual(result, "blocked_by_source_policy")
        self.assertEqual(state["tasks"]["history_refresh"]["state"], "blocked_by_source_policy")
        self.assertIn("permission required", state["tasks"]["history_refresh"]["error"])
        run.assert_not_called()

    def test_dry_run_reports_blocked_source_without_writing_state(self):
        state = {"tasks": {"history_refresh": {}}}
        task = {
            "name": "history_refresh",
            "source_host": "api.curling.io",
            "hours": 168,
            "cmd": ["python", "tools/Build-History-Index.py"],
        }
        with patch.object(cycle, "source_policy", side_effect=SourceBlocked("permission required")), \
             patch.object(cycle, "save_state") as save_state, \
             patch.object(cycle.subprocess, "run") as run:
            result = cycle.run_task(task, state, dry_run=True)

        self.assertEqual(result, "blocked_by_source_policy")
        self.assertEqual(state["tasks"]["history_refresh"], {})
        save_state.assert_not_called()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
