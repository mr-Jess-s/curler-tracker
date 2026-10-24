#!/usr/bin/env python3
"""Refresh every Curling I/O season exposed for Canadian associations.

The platform's season menu is the collection boundary. This does not imply that
the platform contains all Canadian curling history.
"""
import argparse
import concurrent.futures
import gzip
import json
import os
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("CURLER_TRACKER_ROOT", Path(__file__).resolve().parents[1]))
ARCHIVE_ROOT = Path(os.environ.get("CURLER_TRACKER_ARCHIVE_ROOT", ROOT))
sys.path.insert(0, str(ROOT / "tools" / "global_coverage"))
from acquisition_support import fetch_snapshot
from atomic_state import atomic_json

OUTDIR = ROOT / "data" / "history"
MANIFEST = ROOT / "data" / "history-manifest.json"
LOCK = ROOT / "data" / "global" / "history-index.lock"
STATUS = ROOT / "data" / "global" / "history-build-status.json"
SUBDOMAINS = ["ab", "canada", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt"]
BASE = "https://api.curling.io/en/clubs/{sub}"
SOURCE_ID_PREFIX = "curling-io-history"
ROW_FIELDS = [
    "published_name", "event_id", "event_name", "starts_on", "ends_on", "season",
    "team_id", "team_name", "position", "coach", "affiliation", "source_url",
    "source_sha256", "source_retrieved_at",
]
_SOURCE_LOCKS = {sub: threading.Lock() for sub in SUBDOMAINS}


def write_progress(payload):
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    atomic_json(STATUS, payload)


def fetch_json(url, subdomain):
    """Read a source snapshot, using conditional requests and robots/terms policy."""
    with _SOURCE_LOCKS[subdomain]:
        record, body = fetch_snapshot(
            url,
            f"{SOURCE_ID_PREFIX}-{subdomain}",
            "curling-io-history",
            timeout=25,
        )
    if body is None:
        with gzip.open(ARCHIVE_ROOT / record["raw_path"], "rb") as handle:
            body = handle.read()
    return json.loads(body.decode("utf-8-sig")), record


def discover_seasons(payload):
    """Return distinct season options advertised by an association response."""
    seasons = {}
    for row in payload.get("seasons") or []:
        try:
            delta = int(row["delta"])
        except (KeyError, TypeError, ValueError):
            continue
        display = str(row.get("display") or "").strip()
        if display:
            seasons.setdefault(delta, display)
    return sorted(seasons.items(), reverse=True)


def observation_key(curler_id, row):
    return (
        str(curler_id), str(row.get("event_id") or ""), str(row.get("team_id") or ""),
        str(row.get("published_name") or ""), str(row.get("season") or ""),
        str(row.get("position") or ""),
    )


def fetch_event(job):
    sub, item, season = job
    url = f"{BASE.format(sub=sub)}/events/{item['id']}"
    try:
        event, record = fetch_json(url, sub)
    except Exception as exc:
        return {"error": str(exc), "subdomain": sub, "event_id": item.get("id"), "url": url, "rows": []}
    rows = []
    for team in event.get("teams") or []:
        for curler in team.get("lineup") or []:
            cid = curler.get("curler_id")
            name = (curler.get("name") or "").strip()
            if not cid or not name:
                continue
            rows.append({
                "source_provider": "Curling I/O",
                "source_subdomain": sub,
                "source_curler_id": cid,
                "published_name": name,
                "event_id": event.get("id") or item.get("id"),
                "event_name": event.get("name") or item.get("name") or "",
                "starts_on": event.get("starts_on") or "",
                "ends_on": event.get("ends_on") or "",
                "season": season,
                "team_id": team.get("id"),
                "team_name": team.get("name") or "",
                "position": curler.get("position") or "",
                "coach": team.get("coach") or "",
                "affiliation": team.get("affiliation") or "",
                "source_url": url,
                "source_sha256": record.get("sha256"),
                "source_retrieved_at": record.get("retrieved_at") or record.get("not_modified_at"),
            })
    return {"error": None, "subdomain": sub, "event_id": item.get("id"), "url": url, "rows": rows}


def merge_with_existing(sub, current_rows, retain_from=()):
    """Union the new source observations with saved rows; never drop known rows."""
    grouped = {}
    seen = set()
    for row in current_rows:
        cid = str(row["source_curler_id"])
        slim = {key: row.get(key) for key in ROW_FIELDS}
        key = observation_key(cid, slim)
        if key in seen:
            continue
        seen.add(key)
        grouped.setdefault(cid, []).append(slim)

    retained = 0
    previous_paths = [OUTDIR / f"{sub}.json"]
    previous_paths.extend(Path(directory) / f"{sub}.json" for directory in retain_from)
    visited = set()
    for previous_path in previous_paths:
        normalized = previous_path.resolve()
        if normalized in visited:
            continue
        visited.add(normalized)
        if not previous_path.exists():
            continue
        previous = json.loads(previous_path.read_text(encoding="utf-8-sig"))
        for cid, observations in (previous.get("curler_appearances") or {}).items():
            for row in observations:
                slim = {key: row.get(key) for key in ROW_FIELDS}
                key = observation_key(cid, slim)
                if key in seen:
                    continue
                seen.add(key)
                grouped.setdefault(str(cid), []).append(slim)
                retained += 1
    return grouped, retained


def merge_existing_archives(retain_from=()):
    """Offline union of this archive and supplied archives, keeping all observations."""
    OUTDIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    candidate_manifests = [MANIFEST]
    candidate_manifests.extend(Path(directory).parent / "history-manifest.json" for directory in retain_from)
    base_manifest = {}
    for manifest_path in candidate_manifests:
        if not manifest_path.exists():
            continue
        try:
            candidate = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        if candidate.get("generated_at", "") >= base_manifest.get("generated_at", ""):
            base_manifest = candidate

    files = []
    retained_total = 0
    for sub in SUBDOMAINS:
        grouped, retained = merge_with_existing(sub, [], retain_from=retain_from)
        retained_total += retained
        for observations in grouped.values():
            observations.sort(key=lambda row: (row.get("starts_on") or "", str(row.get("event_id") or ""), str(row.get("team_id") or "")))
        out = OUTDIR / f"{sub}.json"
        existing = {}
        if out.exists():
            existing = json.loads(out.read_text(encoding="utf-8-sig"))
        payload = {
            "schema_version": max(1, int(existing.get("schema_version", 1))),
            "generated_at": generated_at,
            "source_provider": "Curling I/O",
            "source_subdomain": sub,
            "source_policy": existing.get("source_policy") or "Owner-confirmed written permission; source observations retain provenance.",
            "coverage": existing.get("coverage") or {},
            "curler_appearances": grouped,
        }
        atomic_json(out, payload)
        count = sum(len(rows) for rows in grouped.values())
        files.append({"subdomain": sub, "file": f"history/{sub}.json", "appearances": count,
                      "bytes": out.stat().st_size, "retained_previous_observations": retained})

    manifest = dict(base_manifest)
    manifest.update({
        "schema_version": max(2, int(base_manifest.get("schema_version", 1))),
        "generated_at": generated_at,
        "source_provider": "Curling I/O",
        "source_policy": "Owner-confirmed written permission; no inferred appearances or cross-source identity merges.",
        "files": files,
        "retained_previous_observations": retained_total,
        "archive_union": {"mode": "offline_union", "history_complete": False,
                          "source_directories": [str(Path(directory)) for directory in retain_from]},
    })
    atomic_json(MANIFEST, manifest)
    return manifest


def build(max_workers=3, retain_from=()):
    OUTDIR.mkdir(parents=True, exist_ok=True)
    jobs = []
    lists = []
    errors = []
    coverage = {}
    progress = {
        "state": "running", "phase": "season_discovery", "association_total": len(SUBDOMAINS),
        "associations_checked": 0, "season_lists_checked": 0, "event_total": 0,
        "events_completed": 0, "appearances_observed": 0, "errors": 0,
    }
    write_progress(progress)

    for sub in SUBDOMAINS:
        progress["current_association"] = sub
        write_progress(progress)
        base_url = f"{BASE.format(sub=sub)}/competitions?occurred=0&registrations=f"
        try:
            current_payload, current_record = fetch_json(base_url, sub)
            seasons = discover_seasons(current_payload)
            if not seasons:
                raise ValueError("Source returned no advertised season options; refusing to narrow the archive silently.")
        except Exception as exc:
            errors.append({"stage": "season_discovery", "subdomain": sub, "url": base_url, "error": str(exc)})
            progress["associations_checked"] += 1
            progress["errors"] = len(errors)
            write_progress(progress)
            print(f"SEASONS_FAIL {sub}: {exc}", flush=True)
            continue

        coverage[sub] = {
            "available_season_count": len(seasons),
            "oldest_available_season": min((name for _, name in seasons), default=""),
            "newest_available_season": max((name for _, name in seasons), default=""),
            "advertised_seasons": [name for _, name in seasons],
        }
        for delta, season in seasons:
            url = f"{BASE.format(sub=sub)}/competitions?occurred={delta}&registrations=f"
            try:
                if delta == 0:
                    payload, record = current_payload, current_record
                else:
                    payload, record = fetch_json(url, sub)
                items = [item for item in (payload.get("items") or []) if item.get("publish_results") is True]
                lists.append({
                    "subdomain": sub,
                    "delta": delta,
                    "season": season,
                    "items": len(items),
                    "source_url": url,
                    "source_sha256": record.get("sha256"),
                    "source_retrieved_at": record.get("retrieved_at") or record.get("not_modified_at"),
                })
                jobs.extend((sub, item, season) for item in items)
                progress["season_lists_checked"] += 1
                write_progress(progress)
                print(f"LIST {sub} {season}: {len(items)} result-published events", flush=True)
            except Exception as exc:
                errors.append({"stage": "list", "subdomain": sub, "delta": delta, "url": url, "error": str(exc)})
                progress["errors"] = len(errors)
                write_progress(progress)
                print(f"LIST_FAIL {sub} {season}: {exc}", flush=True)
        progress["associations_checked"] += 1
        write_progress(progress)

    # The same event can appear in multiple season lists. Fetch its source page once.
    unique_jobs = {}
    for job in jobs:
        unique_jobs.setdefault((job[0], str(job[1].get("id"))), job)
    jobs = list(unique_jobs.values())
    progress.update({"phase": "event_fetch", "event_total": len(jobs), "current_association": None})
    write_progress(progress)
    print(f"FETCHING {len(jobs)} unique events across {len(lists)} advertised season lists", flush=True)

    rows = []
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(fetch_event, job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            done += 1
            if result["error"]:
                errors.append({
                    "stage": "event", "subdomain": result["subdomain"], "event_id": result["event_id"],
                    "url": result["url"], "error": result["error"],
                })
            rows.extend(result["rows"])
            progress["events_completed"] = done
            progress["appearances_observed"] = len(rows)
            progress["errors"] = len(errors)
            if done % 50 == 0 or done == len(futures):
                write_progress(progress)
                print(f"EVENTS {done}/{len(futures)} | appearances {len(rows)} | errors {len(errors)}", flush=True)

    if errors:
        raise RuntimeError(f"History refresh incomplete: {len(errors)} source failures. Existing published indexes were preserved.")

    rows.sort(key=lambda row: (row["source_subdomain"], str(row["source_curler_id"]), row["starts_on"], str(row["event_id"])))
    generated_at = datetime.now(timezone.utc).isoformat()
    permission = "Project owner confirmed written permission for automated collection and republication; no inferred appearances or cross-source identity merges."
    files = []
    retained_total = 0

    for sub in SUBDOMAINS:
        sub_rows = [row for row in rows if row["source_subdomain"] == sub]
        grouped, retained = merge_with_existing(sub, sub_rows, retain_from=retain_from)
        retained_total += retained
        for observations in grouped.values():
            observations.sort(key=lambda row: (row.get("starts_on") or "", str(row.get("event_id") or ""), str(row.get("team_id") or "")))
        payload = {
            "schema_version": 1,
            "generated_at": generated_at,
            "source_provider": "Curling I/O",
            "source_subdomain": sub,
            "source_policy": permission,
            "coverage": coverage.get(sub, {"available_season_count": 0, "status": "season_discovery_failed"}),
            "curler_appearances": grouped,
        }
        out = OUTDIR / f"{sub}.json"
        atomic_json(out, payload)
        count = sum(len(observations) for observations in grouped.values())
        files.append({"subdomain": sub, "file": f"history/{sub}.json", "appearances": count, "bytes": out.stat().st_size,
                      "current_source_observations": len(sub_rows), "retained_previous_observations": retained})

    manifest = {
        "schema_version": 2,
        "generated_at": generated_at,
        "source_provider": "Curling I/O",
        "source_policy": permission,
        "season_lists": lists,
        "coverage": {
            "scope": "All seasons advertised by each association's Curling I/O season menu at retrieval time.",
            "history_complete": False,
            "limitation": "This source does not establish all-time completeness for Canadian curling; older and non-digitized records may be absent.",
            "associations": coverage,
            "association_season_lists_succeeded": len(coverage),
            "association_total": len(SUBDOMAINS),
        },
        "current_source_events": len(jobs),
        "current_source_appearances": len(rows),
        "retained_previous_observations": retained_total,
        "files": files,
        "errors": [],
    }
    atomic_json(MANIFEST, manifest)
    progress.update({"state": "complete", "phase": "finished", "errors": 0,
                     "associations_checked": len(coverage), "season_lists_checked": len(lists),
                     "events_completed": len(jobs), "appearances_observed": len(rows),
                     "retained_previous_observations": retained_total})
    write_progress(progress)
    print(
        f"DONE source_appearances={len(rows)} retained_previous={retained_total} "
        f"events={len(jobs)} season_lists={len(lists)} associations={len(coverage)}/{len(SUBDOMAINS)} "
        f"files={len(files)} bytes={sum(row['bytes'] for row in files)}",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Refresh all Curling I/O seasons advertised for Canadian associations.")
    parser.add_argument("--max-workers", type=int, default=3, choices=range(1, 5))
    parser.add_argument("--retain-from", action="append", default=[], metavar="HISTORY_DIR",
                        help="Also retain observations from another history directory.")
    parser.add_argument("--merge-only", action="store_true",
                        help="Union existing local and --retain-from archives without network access.")
    args = parser.parse_args()
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, f"{os.getpid()} {datetime.now(timezone.utc).isoformat()}\n".encode())
        os.close(fd)
    except FileExistsError:
        raise SystemExit(f"History build already running or needs reviewed stale-lock removal: {LOCK}")
    try:
        try:
            if args.merge_only:
                manifest = merge_existing_archives(retain_from=args.retain_from)
                print(f"MERGED archive observations={sum(row['appearances'] for row in manifest['files'])} files={len(manifest['files'])}", flush=True)
            else:
                build(args.max_workers, retain_from=args.retain_from)
        except Exception as exc:
            write_progress({"state": "failed", "phase": "error", "error": str(exc)})
            raise
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
