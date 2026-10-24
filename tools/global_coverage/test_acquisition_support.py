import http.server
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquisition_support as archive


class Handler(http.server.BaseHTTPRequestHandler):
    body = b"first snapshot"
    etag = '"v1"'
    robots = ""
    failures_remaining = 0

    def do_GET(self):
        if self.path == "/robots.txt":
            if type(self).robots == "404":
                self.send_error(404)
                return
            if type(self).robots == "503":
                self.send_error(503)
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(type(self).robots.encode())
            return
        if type(self).failures_remaining:
            type(self).failures_remaining -= 1
            self.send_error(503)
            return
        if self.headers.get("If-None-Match") == type(self).etag:
            self.send_response(304)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("ETag", type(self).etag)
        self.send_header("Last-Modified", "Thu, 01 Oct 2026 00:00:00 GMT")
        self.end_headers()
        self.wfile.write(type(self).body)

    def log_message(self, *_args):
        pass


class AcquisitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.stack = patch.multiple(
            archive,
            ROOT=root,
            DATA=root / "data" / "global",
            MANIFESTS=root / "data" / "global" / "acquisition-manifests",
            POLICY_PATH=root / "data" / "global" / "source-policy.json",
            _ROBOTS_CACHE={},
            _ROBOTS_FAILURES={},
            _LAST_REQUEST_AT={},
        )
        self.stack.start()
        Handler.body = b"first snapshot"
        Handler.etag = '"v1"'
        Handler.robots = "404"
        Handler.failures_remaining = 0

    def tearDown(self):
        self.stack.stop()
        self.temp.cleanup()

    def test_etag_deduplicates_unchanged_content_and_preserves_changes(self):
        url = self.base + "/page"
        first, _ = archive.fetch_snapshot(url, "test-source", "test-bucket")
        second, body = archive.fetch_snapshot(url, "test-source", "test-bucket")
        self.assertEqual(first["raw_path"], second["raw_path"])
        self.assertEqual(second["status"], 304)
        self.assertIsNone(body)
        Handler.body = b"second snapshot"
        Handler.etag = '"v2"'
        third, _ = archive.fetch_snapshot(url, "test-source", "test-bucket")
        self.assertNotEqual(first["raw_path"], third["raw_path"])
        self.assertTrue((archive.ROOT / first["raw_path"]).exists())
        self.assertTrue((archive.ROOT / third["raw_path"]).exists())

    def test_retries_transient_server_errors(self):
        Handler.failures_remaining = 1
        with patch.object(archive.time, "sleep", return_value=None):
            row, body = archive.fetch_snapshot(self.base + "/retry", "retry-source", "test-bucket")
        self.assertEqual(row["attempts"], 2)
        self.assertEqual(body, b"first snapshot")

    def test_robots_disallow_is_never_bypassed(self):
        Handler.robots = "User-agent: *\nDisallow: /private\n"
        with self.assertRaises(archive.SourceBlocked):
            archive.fetch_snapshot(self.base + "/private/page", "blocked-source", "test-bucket")

    def test_explicit_source_terms_policy_block_is_enforced(self):
        archive.POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
        archive.POLICY_PATH.write_text(
            '{"default_collection":"public_only","hosts":{"127.0.0.1":{"collection":"blocked","reason":"terms prohibit automated collection"}}}',
            encoding="utf-8",
        )
        with self.assertRaisesRegex(archive.SourceBlocked, "terms prohibit"):
            archive.fetch_snapshot(self.base + "/page", "terms-blocked", "test-bucket")

    def test_parent_domain_policy_blocks_registered_subdomains(self):
        archive.POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
        archive.POLICY_PATH.write_text(
            '{"default_collection":"public_only","hosts":{"curling.io":{"collection":"blocked","reason":"prior written permission required"}}}',
            encoding="utf-8",
        )
        with self.assertRaisesRegex(archive.SourceBlocked, "prior written permission"):
            archive.fetch_snapshot(
                "https://api.curling.io/en/clubs/ab/competitions",
                "curling-io-blocked",
                "test-bucket",
            )

    def test_explicit_subdomain_policy_can_override_parent_rule(self):
        archive.POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
        archive.POLICY_PATH.write_text(
            '{"default_collection":"public_only","hosts":{"curling.io":{"collection":"blocked","reason":"permission required"},"api.curling.io":{"collection":"public_only","terms_status":"written permission confirmed"}}}',
            encoding="utf-8",
        )
        result = archive.source_policy("api.curling.io")
        self.assertEqual(result["terms_status"], "written permission confirmed")

    def test_unavailable_robots_rules_fail_closed(self):
        Handler.robots = "503"
        with patch.object(archive.time, "sleep", return_value=None):
            with self.assertRaisesRegex(archive.SourceBlocked, "HTTP 503"):
                archive.fetch_snapshot(self.base + "/page", "robots-error", "test-bucket")


if __name__ == "__main__":
    unittest.main(verbosity=2)
