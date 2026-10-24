#!/usr/bin/env python3
import datetime as dt
import hashlib
import json
import time
from pathlib import Path

import download_world_results as d
from atomic_state import atomic_json

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
RAW = ROOT / "data" / "raw" / "worldcurling-results"
STATUS = DATA / "collector-status.json"
DOWNLOAD_MANIFEST = DATA / "world-results-download-manifest.json"
EXPECTED = ["details.html.gz"] + [f"{name}.html.gz" for name in d.RECORD_PATHS]

def write_status(payload):
    payload["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(STATUS, payload)

def complete(aid):
    """Return whether all expected raw pages have a saved snapshot for this association."""
    folder = RAW / "association" / str(aid)
    return all((folder / name).exists() for name in EXPECTED)

def fetch_targets(association, delay=0.15):
    aid = association["association_id"]
    outdir = RAW / "association" / str(aid)
    targets = [("details", association["details_url"], outdir / "details.html.gz")]
    for name in d.RECORD_PATHS:
        targets.append((name, f"{d.BASE}/Record/{name}/0?associationId={aid}", outdir / f"{name}.html.gz"))
    result = {"checked": 0, "changed": 0, "unchanged": 0, "errors": []}
    for label, url, path in targets:
        try:
            record = d.download(url, path, delay)
            result["checked"] += 1
            if record.get("status") == 304:
                result["unchanged"] += 1
            else:
                result["changed"] += 1
        except Exception as exc:
            result["errors"].append({"kind": label, "url": url, "error": str(exc)})
    return result

def main():
    index_url = d.BASE + "/Association"
    status = {
        "state": "starting",
        "source": d.BASE,
        "association_total": 0,
        "association_cached": 0,
        "association_checked": 0,
        "pages_checked": 0,
        "pages_changed": 0,
        "pages_unchanged": 0,
        "current_association_id": None,
        "errors": [],
    }
    write_status(status)
    try:
        _, _, _, body = d.fetch_bytes(index_url)
    except Exception as exc:
        status["state"] = "failed"
        status["errors"] = [{"kind": "association_index", "url": index_url, "error": str(exc)}]
        write_status(status)
        raise
    associations = d.parse_associations(body.decode("utf-8", errors="replace"))
    download_manifest = {}
    if DOWNLOAD_MANIFEST.exists():
        try:
            download_manifest = json.loads(DOWNLOAD_MANIFEST.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            download_manifest = {}
    download_manifest.update({
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": index_url,
        "association_count": len(associations),
        "associations": associations,
    })
    atomic_json(DOWNLOAD_MANIFEST, download_manifest)
    status["state"] = "running"
    status["association_total"] = len(associations)
    status["association_cached"] = sum(1 for a in associations if complete(a["association_id"]))
    write_status(status)

    for association in associations:
        aid = association["association_id"]
        status["current_association_id"] = aid
        write_status(status)
        refreshed = fetch_targets(association)
        status["association_checked"] += 1
        status["pages_checked"] += refreshed["checked"]
        status["pages_changed"] += refreshed["changed"]
        status["pages_unchanged"] += refreshed["unchanged"]
        if refreshed["errors"]:
            status["errors"].append({"association_id": aid, "errors": refreshed["errors"]})
            status["errors"] = status["errors"][-50:]
        status["association_cached"] = sum(1 for a in associations if complete(a["association_id"]))
        write_status(status)

    status["current_association_id"] = None
    status["association_cached"] = sum(1 for a in associations if complete(a["association_id"]))
    status["state"] = (
        "complete"
        if status["association_cached"] == len(associations)
        and status["association_checked"] == len(associations)
        and not status["errors"]
        else "partial"
    )
    write_status(status)
    print(
        f"{status['state']}: refreshed {status['association_checked']}/{len(associations)} associations "
        f"(cached={status['association_cached']}); "
        f"pages checked={status['pages_checked']} changed={status['pages_changed']} "
        f"unchanged={status['pages_unchanged']} errors={sum(len(row['errors']) for row in status['errors'])}"
    )

if __name__ == "__main__":
    main()
