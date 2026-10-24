import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parent / "build_offline_curler_index.py"
SPEC = importlib.util.spec_from_file_location("build_offline_curler_index", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuildOfflineCurlerIndexTests(unittest.TestCase):
    def test_retains_twenty_recent_appearances_per_association_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            history = root / "history"
            history.mkdir()
            out_dir = root / "offline-curler-index"
            name_dir = root / "name-catalog"
            rows = [{
                "published_name": "Mike McEwen", "event_id": str(index),
                "event_name": f"Event {index}", "starts_on": f"2025-{(index - 1) // 28 + 1:02d}-{(index - 1) % 28 + 1:02d}",
                "team_id": str(index), "team_name": "Team McEwen",
            } for index in range(1, 26)]
            (history / "canada.json").write_text(json.dumps({
                "source_subdomain": "canada", "generated_at": "2026-10-24T00:00:00Z",
                "curler_appearances": {"1935": rows},
            }), encoding="utf-8")
            current = root / "current.json"
            current.write_text("{}", encoding="utf-8")
            catalog = root / "catalog.json"
            with patch.object(builder, "HISTORY", history), \
                    patch.object(builder, "CURRENT", current), \
                    patch.object(builder, "OUT_DIR", out_dir), \
                    patch.object(builder, "CATALOG", catalog), \
                    patch.object(builder, "NAME_CATALOG_DIR", name_dir):
                builder.build()

            payload = json.loads((out_dir / "m.json").read_text(encoding="utf-8"))
            candidate = payload["names"]["mike mcewen"][0]
            self.assertEqual(candidate["source_curler_id"], "1935")
            self.assertEqual(len(candidate["records"]), 20)
            self.assertEqual(candidate["records"][0]["event_id"], "25")
            self.assertTrue(all(row["source_subdomain"] == "canada" for row in candidate["records"]))


if __name__ == "__main__":
    unittest.main()
