#!/usr/bin/env python3
import datetime as dt
import hashlib
import json
import time
from pathlib import Path

import download_world_results as d

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
RAW = ROOT / "data" / "raw" / "worldcurling-results"
STATUS = DATA / "collector-status.json"
EXPECTED = ["details.html.gz"] + [f"{name}.html.gz" for name in d.RECORD_PATHS]

def write_status(payload):
    payload["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

def complete(aid):
    folder = RAW / "association" / str(aid)
    return all((folder / name).exists() for name in EXPECTED)

def fetch_targets(association, delay=0.15):
    aid = association["association_id"]
    outdir = RAW / "association" / str(aid)
    targets = [("details", association["details_url"], outdir / "details.html.gz")]
    for name in d.RECORD_PATHS:
        targets.append((name, f"{d.BASE}/Record/{name}/0?associationId={aid}", outdir / f"{name}.html.gz"))
    errors = []
    for label, url, path in targets:
        if path.exists():
            continue
        try:
            d.download(url, path, delay)
        except Exception as exc:
            errors.append({"kind": label, "url": url, "error": str(exc)})
    return errors

def main():
    _, _, _, body = d.fetch_bytes(d.BASE + "/Association")
    associations = d.parse_associations(body.decode("utf-8", errors="replace"))
    status = {
        "state": "running",
        "source": d.BASE,
        "association_total": len(associations),
        "association_complete": sum(1 for a in associations if complete(a["association_id"])),
        "current_association_id": None,
        "errors": [],
    }
    write_status(status)

    for association in associations:
        aid = association["association_id"]
        if complete(aid):
            continue
        status["current_association_id"] = aid
        write_status(status)
        errors = fetch_targets(association)
        if errors:
            status["errors"].append({"association_id": aid, "errors": errors})
            status["errors"] = status["errors"][-50:]
        status["association_complete"] = sum(1 for a in associations if complete(a["association_id"]))
        write_status(status)

    status["current_association_id"] = None
    status["association_complete"] = sum(1 for a in associations if complete(a["association_id"]))
    status["state"] = "complete" if status["association_complete"] == len(associations) else "partial"
    write_status(status)
    print(f"{status['state']}: {status['association_complete']}/{len(associations)} associations complete")

if __name__ == "__main__":
    main()
