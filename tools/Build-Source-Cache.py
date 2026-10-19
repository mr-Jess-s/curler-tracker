#!/usr/bin/env python3
"""Publish validated Curling I/O snapshots from Arthur's archive as a CDN-safe cache."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
SUBDOMAINS = ("ab", "canada", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt")
EVENT_RE = re.compile(r"^/en/clubs/([a-z]+)/events/(\d+)$")
LIST_RE = re.compile(r"^/en/clubs/([a-z]+)/competitions$")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def archived_bytes(collector: Path, page: dict) -> bytes:
    relative = str(page.get("raw_path") or "").replace("\\", "/")
    path = collector / relative
    if not path.is_file():
        raise FileNotFoundError(path)
    with gzip.open(path, "rb") as source:
        body = source.read()
    digest = hashlib.sha256(body).hexdigest()
    if digest != page.get("sha256"):
        raise ValueError(f"Archive hash mismatch: {path}")
    json.loads(body.decode("utf-8"))
    return body


def atomic_write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(body)
    os.replace(temporary, path)


def build(collector: Path, output: Path) -> dict:
    manifests = collector / "data" / "global" / "acquisition-manifests"
    if not manifests.is_dir():
        raise FileNotFoundError(f"Collector manifests not found: {manifests}")

    records = {}
    newest = ""
    for subdomain in SUBDOMAINS:
        manifest_path = manifests / f"canada-season-{subdomain}.json"
        manifest = read_json(manifest_path)
        for url, page in (manifest.get("pages") or {}).items():
            parsed = urlparse(url)
            list_match = LIST_RE.match(parsed.path)
            event_match = EVENT_RE.match(parsed.path)
            target = None
            kind = None
            if list_match and list_match.group(1) == subdomain:
                query = parse_qs(parsed.query)
                occurred = (query.get("occurred") or [None])[0]
                registrations = (query.get("registrations") or [None])[0]
                if occurred in {"0", "-1", "-2"} and registrations == "f":
                    target = output / subdomain / f"competitions-{occurred}.json"
                    kind = "competitions"
            elif event_match and event_match.group(1) == subdomain:
                target = output / subdomain / "events" / f"{event_match.group(2)}.json"
                kind = "event"
            if target is None:
                continue
            body = archived_bytes(collector, page)
            atomic_write(target, body)
            relative = target.relative_to(output).as_posix()
            timestamp = page.get("not_modified_at") or page.get("retrieved_at") or ""
            newest = max(newest, timestamp)
            records[relative] = {
                "kind": kind,
                "source_url": url,
                "retrieved_at": timestamp,
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
            }

    list_records = {path: row for path, row in records.items() if row["kind"] == "competitions"}
    event_records = {path: row for path, row in records.items() if row["kind"] == "event"}
    if len(list_records) < len(SUBDOMAINS) * 2:
        raise ValueError(f"Insufficient list coverage: {len(list_records)}")
    if len(event_records) < 100:
        raise ValueError(f"Insufficient event coverage: {len(event_records)}")

    referenced = 0
    cached = 0
    for relative in list_records:
        payload = read_json(output / relative)
        for item in payload.get("items", []):
            event_id = item.get("id")
            if event_id is None:
                continue
            referenced += 1
            subdomain = relative.split("/", 1)[0]
            if f"{subdomain}/events/{event_id}.json" in event_records:
                cached += 1

    manifest = {
        "schema_version": 1,
        "generated_at": newest or datetime.now(timezone.utc).isoformat(),
        "source": "Arthur content-addressed Curling I/O archive",
        "subdomains": list(SUBDOMAINS),
        "competition_lists": len(list_records),
        "event_records": len(event_records),
        "referenced_events": referenced,
        "referenced_events_cached": cached,
        "records": dict(sorted(records.items())),
    }
    atomic_write(output / "manifest.json", (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print(json.dumps({key: manifest[key] for key in ("generated_at", "competition_lists", "event_records", "referenced_events", "referenced_events_cached")}))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--collector-root", default=r"C:\Jess\curler-tracker")
    parser.add_argument("--output", default=str(ROOT / "data" / "source-cache"))
    args = parser.parse_args()
    build(Path(args.collector_root).resolve(), Path(args.output).resolve())


if __name__ == "__main__":
    main()
