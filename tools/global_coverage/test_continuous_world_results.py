import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import continuous_world_results as crawler


class ContinuousWorldResultsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.association = {
            "association_id": 731,
            "details_url": "https://results.example/Association/Details/731",
        }

    def test_existing_association_pages_are_revalidated(self):
        folder = self.root / "association" / "731"
        folder.mkdir(parents=True)
        for filename in crawler.EXPECTED:
            (folder / filename).write_bytes(b"cached snapshot")

        with patch.object(crawler, "RAW", self.root), patch.object(
            crawler.d, "download", return_value={"status": 304}
        ) as download:
            result = crawler.fetch_targets(self.association, delay=0)

        self.assertEqual(download.call_count, len(crawler.EXPECTED))
        self.assertEqual(result, {
            "checked": len(crawler.EXPECTED),
            "changed": 0,
            "unchanged": len(crawler.EXPECTED),
            "errors": [],
        })

    def test_refresh_error_keeps_last_snapshot_and_is_reported(self):
        folder = self.root / "association" / "731"
        folder.mkdir(parents=True)
        saved = folder / crawler.EXPECTED[0]
        saved.write_bytes(b"last verified snapshot")

        def download(_url, _path, _delay):
            raise RuntimeError("temporary source outage")

        with patch.object(crawler, "RAW", self.root), patch.object(crawler.d, "download", side_effect=download):
            result = crawler.fetch_targets(self.association, delay=0)

        self.assertEqual(saved.read_bytes(), b"last verified snapshot")
        self.assertEqual(result["checked"], 0)
        self.assertEqual(len(result["errors"]), len(crawler.EXPECTED))
        self.assertTrue(all(row["error"] == "temporary source outage" for row in result["errors"]))

    def test_run_reports_partial_when_any_revalidation_fails(self):
        writes = []
        refreshed = {
            "checked": len(crawler.EXPECTED) - 1,
            "changed": 1,
            "unchanged": len(crawler.EXPECTED) - 2,
            "errors": [{"kind": "IndividualGames", "url": "https://results.example/games", "error": "503"}],
        }
        with patch.object(crawler.d, "fetch_bytes", return_value=("url", 200, {}, b"index")), \
             patch.object(crawler.d, "parse_associations", return_value=[self.association]), \
             patch.object(crawler, "DOWNLOAD_MANIFEST", self.root / "download-manifest.json"), \
             patch.object(crawler, "complete", return_value=True), \
             patch.object(crawler, "fetch_targets", return_value=refreshed), \
             patch.object(crawler, "write_status", side_effect=lambda value: writes.append(dict(value))):
            crawler.main()

        self.assertEqual(writes[-1]["state"], "partial")
        self.assertEqual(writes[-1]["association_checked"], 1)
        self.assertEqual(writes[-1]["pages_changed"], 1)
        self.assertEqual(writes[-1]["pages_unchanged"], len(crawler.EXPECTED) - 2)
        self.assertEqual(writes[-1]["errors"][0]["association_id"], 731)

    def test_run_reports_complete_only_after_all_pages_refresh(self):
        writes = []
        refreshed = {
            "checked": len(crawler.EXPECTED),
            "changed": 2,
            "unchanged": len(crawler.EXPECTED) - 2,
            "errors": [],
        }
        with patch.object(crawler.d, "fetch_bytes", return_value=("url", 200, {}, b"index")), \
             patch.object(crawler.d, "parse_associations", return_value=[self.association]), \
             patch.object(crawler, "DOWNLOAD_MANIFEST", self.root / "download-manifest.json"), \
             patch.object(crawler, "complete", return_value=True), \
             patch.object(crawler, "fetch_targets", return_value=refreshed), \
             patch.object(crawler, "write_status", side_effect=lambda value: writes.append(dict(value))):
            crawler.main()

        self.assertEqual(writes[-1]["state"], "complete")
        self.assertEqual(writes[-1]["association_checked"], 1)
        self.assertEqual(writes[-1]["pages_checked"], len(crawler.EXPECTED))

    def test_association_index_failure_is_persisted_as_failed(self):
        writes = []
        with patch.object(crawler.d, "fetch_bytes", side_effect=RuntimeError("source unavailable")), \
             patch.object(crawler, "write_status", side_effect=lambda value: writes.append(dict(value))):
            with self.assertRaisesRegex(RuntimeError, "source unavailable"):
                crawler.main()

        self.assertEqual(writes[0]["state"], "starting")
        self.assertEqual(writes[-1]["state"], "failed")
        self.assertEqual(writes[-1]["errors"][0]["kind"], "association_index")


if __name__ == "__main__":
    unittest.main(verbosity=2)
