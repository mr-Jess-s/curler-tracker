#!/usr/bin/env python3
import argparse
import datetime as dt
from email.message import Message
import gzip
import hashlib
import html
import json
import os
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import urljoin
from acquisition_support import fetch_snapshot

ROOT = Path(os.environ.get("CURLER_TRACKER_ROOT", Path(__file__).resolve().parents[2])).resolve()
ARCHIVE_ROOT = Path(os.environ.get("CURLER_TRACKER_ARCHIVE_ROOT", ROOT)).resolve()
DATA = ARCHIVE_ROOT / "data" / "global"
RAW = ARCHIVE_ROOT / "data" / "raw" / "worldcurling-results"
BASE = "https://results.worldcurling.org"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"

RECORD_PATHS = [
    "Appearances",
    "IndividualChampionships",
    "IndividualFinals",
    "IndividualMedals",
    "IndividualGames",
    "IndividualWins",
]

def fetch_bytes(url):
    record, body = fetch_snapshot(url, "worldcurling-results", "worldcurling-results", timeout=35)
    if body is None:
        with gzip.open(ARCHIVE_ROOT / record["raw_path"], "rb") as handle:
            body = handle.read()
    headers = Message()
    headers["Content-Type"] = record.get("content_type", "application/octet-stream")
    for key, name in (("ETag", "etag"), ("Last-Modified", "last_modified")):
        if record.get(name):
            headers[key] = record[name]
    return record.get("final_url", url), record["status"], headers, body
def save_gzip(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(body)

def parse_associations(page):
    rows = {}
    for match in re.finditer(
        r'href="/Association/Details/(\d+)"[^>]*>(.*?)</a>',
        page,
        re.I | re.S,
    ):
        association_id = int(match.group(1))
        label = re.sub(r"<[^>]+>", " ", match.group(2))
        label = re.sub(r"\s+", " ", html.unescape(label)).strip()
        if not label:
            continue
        rows.setdefault(association_id, set()).add(label)
    return [
        {
            "association_id": key,
            "labels": sorted(values),
            "details_url": f"{BASE}/Association/Details/{key}",
        }
        for key, values in sorted(rows.items())
    ]

def write_manifest(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
def download(url, path, delay):
    final_url, status, headers, body = fetch_bytes(url)
    save_gzip(path, body)
    record = {
        "url": url,
        "final_url": final_url,
        "status": status,
        "content_type": headers.get_content_type(),
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "path": str(path.relative_to(ARCHIVE_ROOT)),
    }
    if delay:
        time.sleep(delay)
    return record

def main():
    parser = argparse.ArgumentParser(
        description="Download public World Curling association result pages."
    )
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    index_url = BASE + "/Association"
    _, _, _, body = fetch_bytes(index_url)
    page = body.decode("utf-8", errors="replace")
    associations = parse_associations(page)
    if args.limit:
        associations = associations[:args.limit]
    manifest = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": index_url,
        "association_count": len(associations),
        "associations": associations,
        "downloads": [],
        "errors": [],
    }
    index_path = RAW / "association-index.html.gz"
    manifest["downloads"].append(
        {
            "url": index_url,
            "status": 200,
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "path": str(index_path.relative_to(ARCHIVE_ROOT)),
        }
    )
    save_gzip(index_path, body)

    for number, association in enumerate(associations, start=1):
        aid = association["association_id"]
        outdir = RAW / "association" / str(aid)
        targets = [
            ("details", association["details_url"], outdir / "details.html.gz"),
        ]
        for record_name in RECORD_PATHS:
            url = f"{BASE}/Record/{record_name}/0?associationId={aid}"
            targets.append(
                (
                    record_name,
                    url,
                    outdir / f"{record_name}.html.gz",
                )
            )
        for label, url, path in targets:
            if args.resume and path.exists():
                continue
            try:
                record = download(url, path, args.delay)
                record["association_id"] = aid
                record["kind"] = label
                manifest["downloads"].append(record)
            except Exception as exc:
                manifest["errors"].append({
                    "association_id": aid,
                    "kind": label,
                    "url": url,
                    "error": str(exc),
                })
        print(
            f"{number}/{len(associations)} association {aid} "
            f"errors={len(manifest['errors'])}",
            flush=True,
        )
        write_manifest(DATA / "world-results-download-manifest.json", manifest)

    write_manifest(DATA / "world-results-download-manifest.json", manifest)
    print(
        f"Downloaded {len(manifest['downloads'])} pages "
        f"with {len(manifest['errors'])} errors."
    )

if __name__ == "__main__":
    main()
