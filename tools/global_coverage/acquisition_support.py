#!/usr/bin/env python3
"""Durable, conditional snapshot storage for public source pages."""
import datetime as dt
import gzip
import hashlib
import json
import time
import threading
import urllib.error
import urllib.request
import urllib.parse
import urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
MANIFESTS = DATA / "acquisition-manifests"
POLICY_PATH = DATA / "source-policy.json"
USER_AGENT = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"
_ROBOTS_CACHE = {}
_ROBOTS_FAILURES = {}
_LAST_REQUEST_AT = {}
_RATE_LOCK = threading.Lock()


class SourceBlocked(RuntimeError):
    pass


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _atomic_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


def source_policy(host):
    if not POLICY_PATH.exists():
        return {"collection": "public_only", "terms_status": "unreviewed"}
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    row = policy.get("hosts", {}).get(host.lower(), {})
    if row.get("collection") == "blocked":
        raise SourceBlocked(row.get("reason") or f"Collection blocked by source policy for {host}")
    return {
        "collection": row.get("collection", policy.get("default_collection", "public_only")),
        "terms_status": row.get("terms_status", "unreviewed"),
        "terms_url": row.get("terms_url"),
        "reviewed_at": row.get("reviewed_at"),
    }


def manifest_path(source_id):
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in source_id.lower())
    return MANIFESTS / f"{safe}.json"


def load_manifest(source_id):
    path = manifest_path(source_id)
    if not path.exists():
        return {"schema_version": 1, "source_id": source_id, "pages": {}, "pending_urls": [], "seen_urls": []}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("source_id") != source_id or not isinstance(value.get("pages"), dict):
            raise ValueError("manifest identity/schema mismatch")
        return value
    except Exception:
        backup = path.with_suffix(path.suffix + ".invalid")
        if not backup.exists():
            path.replace(backup)
        return {"schema_version": 1, "source_id": source_id, "pages": {}, "pending_urls": [], "seen_urls": []}


def save_manifest(source_id, manifest):
    manifest["source_id"] = source_id
    manifest["updated_at"] = utc_now()
    _atomic_json(manifest_path(source_id), manifest)


def robots_allowed(url, timeout=12, attempts=3):
    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin in _ROBOTS_FAILURES:
        raise SourceBlocked(_ROBOTS_FAILURES[origin])
    if origin not in _ROBOTS_CACHE:
        robots = urllib.robotparser.RobotFileParser()
        robots.set_url(origin + "/robots.txt")
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(urllib.request.Request(robots.url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as response:
                    robots.parse(response.read().decode("utf-8", errors="replace").splitlines())
                _ROBOTS_CACHE[origin] = robots
                break
            except urllib.error.HTTPError as exc:
                if exc.code in {404, 410}:
                    robots.parse([])
                    _ROBOTS_CACHE[origin] = robots
                    break
                retryable = exc.code == 429 or 500 <= exc.code < 600
                if retryable and attempt + 1 < attempts:
                    time.sleep(min(8, 2 ** attempt))
                    continue
                message = f"Cannot verify robots.txt for {origin}: HTTP {exc.code}"
                _ROBOTS_FAILURES[origin] = message
                raise SourceBlocked(message) from exc
            except Exception as exc:
                if attempt + 1 < attempts:
                    time.sleep(min(8, 2 ** attempt))
                    continue
                message = f"Cannot verify robots.txt for {origin}: {exc}"
                _ROBOTS_FAILURES[origin] = message
                raise SourceBlocked(message) from exc
    robots = _ROBOTS_CACHE[origin]
    if not robots.can_fetch(USER_AGENT, url):
        raise SourceBlocked(f"robots.txt disallows {url}")
    return True


def wait_for_robots_rate(url):
    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    robots = _ROBOTS_CACHE.get(origin)
    if not robots:
        return
    delay = robots.crawl_delay(USER_AGENT) or 0
    rate = robots.request_rate(USER_AGENT)
    if rate and rate.requests:
        delay = max(delay, rate.seconds / rate.requests)
    with _RATE_LOCK:
        previous = _LAST_REQUEST_AT.get(origin)
        if previous is not None:
            remaining = delay - (time.monotonic() - previous)
            if remaining > 0:
                time.sleep(remaining)
        _LAST_REQUEST_AT[origin] = time.monotonic()


def _snapshot_path(source_id, raw_bucket, url, digest, content_type):
    url_key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    ext = "html" if content_type == "text/html" else "bin"
    return ROOT / "data" / "raw" / raw_bucket / source_id / url_key / f"{digest}.{ext}.gz"


def fetch_snapshot(url, source_id, raw_bucket, timeout=25, attempts=3):
    """Fetch with retries, conditional headers, content-addressed snapshots and provenance."""
    from urllib.parse import urlsplit
    host = (urlsplit(url).hostname or "").lower()
    policy = source_policy(host)
    robots_allowed(url)
    manifest = load_manifest(source_id)
    previous = manifest["pages"].get(url, {})
    headers = {"User-Agent": USER_AGENT}
    if previous.get("etag"):
        headers["If-None-Match"] = previous["etag"]
    if previous.get("last_modified"):
        headers["If-Modified-Since"] = previous["last_modified"]

    def record_failure(exc, attempt_number):
        manifest["pages"][url] = {
            **previous,
            "url": url,
            "status": "error",
            "last_error": str(exc),
            "last_error_at": utc_now(),
            "attempts": attempt_number,
            "terms_status": policy["terms_status"],
            "terms_url": policy.get("terms_url"),
        }
        save_manifest(source_id, manifest)

    for attempt in range(attempts):
        wait_for_robots_rate(url)
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                digest = hashlib.sha256(body).hexdigest()
                raw_path = _snapshot_path(source_id, raw_bucket, url, digest, response.headers.get_content_type())
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                if not raw_path.exists():
                    with raw_path.open("wb") as output:
                        with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=9, mtime=0) as zipped:
                            zipped.write(body)
                row = {
                    "url": url, "status": response.status, "final_url": response.geturl(),
                    "content_type": response.headers.get_content_type(), "bytes": len(body),
                    "sha256": digest, "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"),
                    "retrieved_at": utc_now(), "raw_path": str(raw_path.relative_to(ROOT)),
                    "terms_status": policy["terms_status"], "terms_url": policy.get("terms_url"),
                    "attempts": attempt + 1,
                }
                manifest["pages"][url] = row
                save_manifest(source_id, manifest)
                return row, body
        except urllib.error.HTTPError as exc:
            if exc.code == 304 and previous:
                row = dict(previous)
                row.update({"status": 304, "not_modified_at": utc_now(), "attempts": attempt + 1})
                manifest["pages"][url] = row
                save_manifest(source_id, manifest)
                return row, None
            if (exc.code != 429 and not 500 <= exc.code < 600) or attempt + 1 >= attempts:
                record_failure(exc, attempt + 1)
                raise
            retry_after = exc.headers.get("Retry-After")
            try:
                wait = min(30, max(1, int(retry_after))) if retry_after else min(8, 2 ** attempt)
            except ValueError:
                wait = min(8, 2 ** attempt)
        except (TimeoutError, urllib.error.URLError, OSError) as exc:
            if attempt + 1 >= attempts:
                record_failure(exc, attempt + 1)
                raise
            wait = min(8, 2 ** attempt)
        time.sleep(wait)
    raise RuntimeError("fetch failed")


def save_checkpoint(source_id, manifest, pending, seen):
    manifest["pending_urls"] = list(pending)
    manifest["seen_urls"] = sorted(seen)
    save_manifest(source_id, manifest)
