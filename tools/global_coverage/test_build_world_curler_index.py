import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_world_curler_index as builder


class BuildWorldCurlerIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.raw = self.root / "raw"
        self.raw.mkdir()
        self.download_manifest = self.root / "world-results-download-manifest.json"
        self.snapshot_manifest = self.root / "worldcurling-results.json"
        self.output = self.root / "world-curler-index.json"

    def test_parse_preserves_person_ids_metrics_and_exact_event_labels(self):
        page = """
        <table><thead><tr><th>Person</th><th>Appearances</th><th>Games</th><th>Golds</th><th>Tournaments</th></tr></thead>
        <tbody><tr><td><a href="/Person/Details/486">Torger Nerg&#229;rd</a>
        <img alt="Flag for Norway" src="/Content/images/wcf-flags/NOR.png"></td>
        <td>44</td><td><b>428</b></td><td>6</td>
        <td><b>Olympic Games</b><br><a href="/Championship/Details/702">2022-6</a>,
        <a href="/Championship/Details/560">2018-6</a><br><b>Worlds</b>
        <a href="/Championship/Details/555">2016-5</a></td></tr></tbody></table>
        """
        rows = builder.parse_record_page(
            page,
            {"association_id": 10, "labels": ["Norway"]},
            "IndividualGames",
            "https://results.worldcurling.org/Record/IndividualGames/0?associationId=10",
            {"sha256": "abc", "retrieved_at": "2026-10-24T00:00:00Z"},
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["world_person_id"], "486")
        self.assertEqual(row["published_name"], "Torger Nergård")
        self.assertEqual(row["flag_code"], "NOR")
        self.assertEqual(row["metrics"], {"Appearances": "44", "Games": "428", "Golds": "6"})
        self.assertEqual([event["championship_id"] for event in row["championships"]], ["702", "560", "555"])
        self.assertEqual(row["championships"][2]["championship_type"], "Worlds")
        self.assertEqual(row["championships"][0]["source_label"], "2022-6")

    def test_build_preserves_old_people_and_labels_coverage_incomplete(self):
        association_pages = self.raw / "10"
        association_pages.mkdir()
        html = b"""<table><thead><tr><th>Person</th><th>Appearances</th><th>Tournaments</th></tr></thead>
        <tbody><tr><td><a href="/Person/Details/4">A Curler</a></td><td>2</td>
        <td><b>Worlds</b><a href="/Championship/Details/7">1990-3</a></td></tr></tbody></table>"""
        with gzip.open(association_pages / "Appearances.html.gz", "wb") as handle:
            handle.write(html)
        self.download_manifest.write_text(json.dumps({
            "associations": [{"association_id": 10, "labels": ["Example"]}]
        }), encoding="utf-8")
        self.snapshot_manifest.write_text(json.dumps({"pages": {}}), encoding="utf-8")
        with patch.object(builder, "RAW", self.raw), \
             patch.object(builder, "DOWNLOAD_MANIFEST", self.download_manifest), \
             patch.object(builder, "SNAPSHOT_MANIFEST", self.snapshot_manifest), \
             patch.object(builder, "OUTPUT", self.output):
            first = builder.build_index()
            self.assertEqual(first["coverage"]["people_indexed"], 1)
            self.assertFalse(first["coverage"]["history_complete"])
            self.assertEqual(first["coverage"]["pages_parsed"], 1)

            self.download_manifest.write_text(json.dumps({"associations": []}), encoding="utf-8")
            second = builder.build_index()

        self.assertEqual(second["coverage"]["retained_previous_people"], 1)
        self.assertIn("4", second["people"])
        self.assertEqual(second["people"]["4"]["championships"][0]["source_label"], "1990-3")


if __name__ == "__main__":
    unittest.main(verbosity=2)
