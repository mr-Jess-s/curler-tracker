import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
SCRIPT = Path(__file__).resolve().parents[1] / "Build-History-Index.py"
SPEC = importlib.util.spec_from_file_location("build_history_index", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuildHistoryIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.outdir = self.root / "history"
        self.outdir.mkdir()
        self.manifest = self.root / "history-manifest.json"

    def test_discover_seasons_returns_every_distinct_source_option(self):
        seasons = builder.discover_seasons({"seasons": [
            {"delta": 0, "display": "2026 / 2027"},
            {"delta": -1, "display": "2025 / 2026"},
            {"delta": -1, "display": "duplicate"},
            {"delta": "bad", "display": "ignored"},
            {"delta": -2, "display": "2024 / 2025"},
        ]})
        self.assertEqual(seasons, [(0, "2026 / 2027"), (-1, "2025 / 2026"), (-2, "2024 / 2025")])

    def test_build_indexes_all_advertised_seasons_and_retains_old_rows(self):
        old_payload = {
            "schema_version": 1,
            "source_subdomain": "ab",
            "curler_appearances": {
                "17": [{"published_name": "Old Name", "event_id": 1, "event_name": "Old Bonspiel",
                        "season": "2010 / 2011", "team_id": 5, "team_name": "Old Team",
                        "position": "skip", "source_url": "https://api.curling.io/en/clubs/ab/events/1"}]
            },
        }
        (self.outdir / "ab.json").write_text(json.dumps(old_payload), encoding="utf-8")
        release_dir = self.root / "release-history"
        release_dir.mkdir()
        release_payload = {
            "curler_appearances": {
                "19": [{"published_name": "Release Curler", "event_id": 99, "event_name": "Release Archive",
                        "season": "2015 / 2016", "team_id": 12, "team_name": "Release Team",
                        "position": "lead", "source_url": "https://api.curling.io/en/clubs/ab/events/99"}]
            }
        }
        (release_dir / "ab.json").write_text(json.dumps(release_payload), encoding="utf-8")
        record = {"sha256": "snapshot-hash", "retrieved_at": "2026-10-24T00:00:00+00:00"}
        responses = {
            0: ({"seasons": [{"delta": 0, "display": "2026 / 2027"},
                              {"delta": -1, "display": "2025 / 2026"},
                              {"delta": -2, "display": "2024 / 2025"}],
                 "items": [{"id": 3, "name": "New Event", "publish_results": True}]}, record),
            -1: ({"items": [{"id": 2, "name": "Last Season", "publish_results": True}]}, record),
            -2: ({"items": []}, record),
        }

        def fake_fetch_json(url, _subdomain):
            delta = int(url.split("occurred=")[1].split("&")[0])
            return responses[delta]

        def fake_fetch_event(job):
            sub, item, season = job
            return {
                "error": None, "subdomain": sub, "event_id": item["id"],
                "url": f"https://api.curling.io/en/clubs/{sub}/events/{item['id']}",
                "rows": [{"source_subdomain": sub, "source_curler_id": 17,
                          "published_name": f"Name {item['id']}", "event_id": item["id"],
                          "event_name": item["name"], "starts_on": "2026-01-01", "ends_on": "2026-01-02",
                          "season": season, "team_id": item["id"], "team_name": "Team",
                          "position": "skip", "source_url": "https://api.curling.io/event",
                          "source_sha256": "event-hash", "source_retrieved_at": "2026-10-24T00:00:00+00:00"}],
            }

        with patch.object(builder, "SUBDOMAINS", ["ab"]), \
             patch.object(builder, "OUTDIR", self.outdir), \
             patch.object(builder, "MANIFEST", self.manifest), \
             patch.object(builder, "STATUS", self.root / "status.json"), \
             patch.object(builder, "fetch_json", side_effect=fake_fetch_json) as fetch, \
             patch.object(builder, "fetch_event", side_effect=fake_fetch_event):
            builder.build(max_workers=1, retain_from=[release_dir])

        self.assertEqual(fetch.call_count, 3)
        indexed = json.loads((self.outdir / "ab.json").read_text(encoding="utf-8"))
        rows = indexed["curler_appearances"]["17"]
        self.assertEqual({row["event_id"] for row in rows}, {1, 2, 3})
        self.assertEqual(indexed["curler_appearances"]["19"][0]["event_id"], 99)
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.assertEqual([row["season"] for row in manifest["season_lists"]],
                         ["2026 / 2027", "2025 / 2026", "2024 / 2025"])
        self.assertFalse(manifest["coverage"]["history_complete"])
        self.assertEqual(manifest["retained_previous_observations"], 2)

    def test_season_discovery_failure_preserves_existing_index_and_manifest(self):
        existing = self.outdir / "ab.json"
        existing.write_text('{"keep": true}\n', encoding="utf-8")
        self.manifest.write_text('{"previous": true}\n', encoding="utf-8")
        before_index = existing.read_bytes()
        before_manifest = self.manifest.read_bytes()

        with patch.object(builder, "SUBDOMAINS", ["ab"]), \
             patch.object(builder, "OUTDIR", self.outdir), \
             patch.object(builder, "MANIFEST", self.manifest), \
             patch.object(builder, "STATUS", self.root / "status.json"), \
             patch.object(builder, "fetch_json", return_value=({"seasons": []}, {})):
            with self.assertRaisesRegex(RuntimeError, "Existing published indexes were preserved"):
                builder.build(max_workers=1)

        self.assertEqual(existing.read_bytes(), before_index)
        self.assertEqual(self.manifest.read_bytes(), before_manifest)

    def test_merge_only_unions_archives_without_network_and_keeps_coverage(self):
        release_dir = self.root / "release-history"
        release_dir.mkdir()
        shared = {"published_name": "Shared", "event_id": 1, "team_id": 10, "season": "2025 / 2026"}
        newer = {"published_name": "New from release", "event_id": 2, "team_id": 20, "season": "2015 / 2016"}
        (self.outdir / "ab.json").write_text(json.dumps({"curler_appearances": {"17": [shared]}}), encoding="utf-8")
        (release_dir / "ab.json").write_text(json.dumps({"curler_appearances": {"17": [shared, newer]}}), encoding="utf-8")
        (self.root / "history-manifest.json").write_text(json.dumps({
            "generated_at": "2026-10-24T00:00:00+00:00",
            "coverage": {"history_complete": False, "association_total": 14},
            "season_lists": [{"season": "2014 / 2015"}],
        }), encoding="utf-8")

        with patch.object(builder, "SUBDOMAINS", ["ab"]), \
             patch.object(builder, "OUTDIR", self.outdir), \
             patch.object(builder, "MANIFEST", self.manifest):
            manifest = builder.merge_existing_archives(retain_from=[release_dir])

        merged = json.loads((self.outdir / "ab.json").read_text(encoding="utf-8"))
        self.assertEqual({row["event_id"] for row in merged["curler_appearances"]["17"]}, {1, 2})
        self.assertFalse(manifest["coverage"]["history_complete"])
        self.assertEqual(manifest["coverage"]["association_total"], 14)
        self.assertEqual(manifest["season_lists"], [{"season": "2014 / 2015"}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
