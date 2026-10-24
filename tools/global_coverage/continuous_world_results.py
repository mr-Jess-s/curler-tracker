#!/usr/bin/env python3
import argparse
import datetime as dt
import gzip
import hashlib
import json
import re
import time
from pathlib import Path

import download_world_results as d
from atomic_state import atomic_json

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_ROOT = d.ARCHIVE_ROOT
DATA = ARCHIVE_ROOT / "data" / "global"
RAW = ARCHIVE_ROOT / "data" / "raw" / "worldcurling-results"
STATUS = DATA / "collector-status.json"
DOWNLOAD_MANIFEST = DATA / "world-results-download-manifest.json"
CHAMPIONSHIP_MANIFEST = DATA / "world-championship-details-manifest.json"
CHAMPIONSHIP_RAW = RAW / "championship"
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

def discover_championships():
    """Read championship IDs and year labels already linked by saved result pages."""
    found = {}
    for path in (RAW / "association").glob("*/*.html.gz"):
        try:
            with gzip.open(path, "rb") as handle:
                page = handle.read().decode("utf-8", errors="replace")
        except OSError:
            continue
        for match in re.finditer(r'href="/Championship/Details/(\d+)"[^>]*>(.*?)</a>', page, re.I | re.S):
            championship_id = match.group(1)
            label = re.sub(r"<[^>]+>", " ", match.group(2))
            label = re.sub(r"\s+", " ", label).strip()
            year_match = re.match(r"(\d{4})", label)
            year = int(year_match.group(1)) if year_match else 0
            found[championship_id] = max(found.get(championship_id, 0), year)
    return found

def refresh_championship_details(limit=120, delay=0.15):
    ids = discover_championships()
    try:
        manifest = json.loads(CHAMPIONSHIP_MANIFEST.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        manifest = {"schema_version": 1, "pages": {}, "errors": []}
    pages = manifest.setdefault("pages", {})
    now = dt.datetime.now(dt.timezone.utc)
    stale_before = now - dt.timedelta(days=30)

    def needs_fetch(championship_id):
        saved = pages.get(championship_id) or {}
        if not saved.get("status") or saved.get("error"):
            return True
        try:
            stamp = dt.datetime.fromisoformat(saved.get("retrieved_at", "").replace("Z", "+00:00"))
            return stamp < stale_before
        except (TypeError, ValueError):
            return True

    candidates = [championship_id for championship_id in ids if needs_fetch(championship_id)]
    candidates.sort(key=lambda championship_id: (0 if not pages.get(championship_id) else 1,
                                                  -ids[championship_id], -int(championship_id)))
    selected = candidates[:max(0, limit)]
    status = {"total": len(ids), "cached": sum(1 for key in ids if (pages.get(key) or {}).get("status")),
              "checked": 0, "changed": 0, "unchanged": 0, "errors": []}
    for championship_id in selected:
        url = f"{d.BASE}/Championship/Details/{championship_id}"
        path = CHAMPIONSHIP_RAW / f"{championship_id}.html.gz"
        try:
            record = d.download(url, path, delay)
            record.update({"championship_id": championship_id, "year": ids[championship_id]})
            pages[championship_id] = record
            status["checked"] += 1
            if record.get("status") == 304:
                status["unchanged"] += 1
            else:
                status["changed"] += 1
        except Exception as exc:
            error = {"championship_id": championship_id, "url": url, "error": str(exc)}
            status["errors"].append(error)
            pages[championship_id] = {"championship_id": championship_id, "year": ids[championship_id],
                                      "error": str(exc), "last_attempt_at": now.isoformat()}
        manifest.update({"schema_version": 1, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                         "source": d.BASE, "total": len(ids), "pages": pages,
                         "errors": status["errors"][-50:]})
        atomic_json(CHAMPIONSHIP_MANIFEST, manifest)
    status["cached"] = sum(1 for key in ids if (pages.get(key) or {}).get("status"))
    status["remaining"] = max(0, len(ids) - status["cached"])
    return status

def main(argv=None):
    parser = argparse.ArgumentParser(description="Refresh World Curling source indexes and championship details.")
    parser.add_argument("--max-championship-details", type=int, default=120)
    parser.add_argument("--delay", type=float, default=0.15)
    parser.add_argument("--details-only", action="store_true", help="Refresh championship pages from the saved association results without refetching those indexes.")
    args = parser.parse_args(argv)
    if args.details_only:
        details = refresh_championship_details(limit=args.max_championship_details, delay=args.delay)
        print(f"Championship details: cached={details['cached']}/{details['total']} checked={details['checked']} remaining={details['remaining']} errors={len(details['errors'])}")
        return
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
        "championship_details_total": 0,
        "championship_details_cached": 0,
        "championship_details_checked": 0,
        "championship_details_remaining": 0,
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
        refreshed = fetch_targets(association, delay=args.delay)
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
    detail_status = refresh_championship_details(limit=args.max_championship_details, delay=args.delay)
    status["championship_details_total"] = detail_status["total"]
    status["championship_details_cached"] = detail_status["cached"]
    status["championship_details_checked"] = detail_status["checked"]
    status["championship_details_remaining"] = detail_status["remaining"]
    status["championship_details_errors"] = detail_status["errors"][-20:]
    status["state"] = (
        "complete"
        if status["association_cached"] == len(associations)
        and status["association_checked"] == len(associations)
        and detail_status["remaining"] == 0
        and not status["errors"] and not detail_status["errors"]
        else "partial"
    )
    write_status(status)
    print(
        f"{status['state']}: refreshed {status['association_checked']}/{len(associations)} associations "
        f"(cached={status['association_cached']}); "
        f"pages checked={status['pages_checked']} changed={status['pages_changed']} "
        f"unchanged={status['pages_unchanged']} errors={sum(len(row['errors']) for row in status['errors'])}; "
        f"championship details={detail_status['cached']}/{detail_status['total']} "
        f"checked={detail_status['checked']} remaining={detail_status['remaining']} errors={len(detail_status['errors'])}"
    )

if __name__ == "__main__":
    main()
