#!/usr/bin/env python3
"""Build a small, provenance-preserving name index from saved Curling I/O records."""
import argparse
import datetime as dt
import json
import re
import unicodedata
from urllib.parse import quote
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / "data" / "history"
CURRENT = ROOT / "data" / "global" / "canada-current-season.json"
OUT_DIR = ROOT / "data" / "offline-curler-index"
CATALOG = ROOT / "data" / "curler-name-catalog.json"
NAME_CATALOG_DIR = ROOT / "data" / "name-catalog"


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return default


def normalize(value):
    value = unicodedata.normalize("NFKD", str(value or "").casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9#]+", " ", value).strip()


def date_key(value):
    text = str(value or "")
    for pattern in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y"):
        try:
            candidate = text[:10] if pattern == "%Y-%m-%d" else text
            return dt.datetime.strptime(candidate, pattern).date().isoformat()
        except ValueError:
            continue
    return text


def record_key(row):
    return (row["source_subdomain"], str(row.get("source_curler_id") or ""), str(row.get("event_id") or ""), str(row.get("team_id") or ""))


def add_record(records, row):
    name = str(row.get("published_name") or row.get("name") or "").strip()
    team = str(row.get("team_name") or "").strip()
    if not name or not team:
        return
    normalized = normalize(name)
    if not normalized:
        return
    clean = {
        "name": name,
        "normalized_name": normalized,
        "source_provider": "Curling I/O",
        "source_subdomain": row["source_subdomain"],
        "source_curler_id": str(row.get("source_curler_id") or ""),
        "event_id": str(row.get("event_id") or ""),
        "event_name": row.get("event_name") or row.get("name_of_event") or "Recorded competition",
        "starts_on": row.get("starts_on") or "",
        "season": row.get("season") or "",
        "team_id": str(row.get("team_id") or ""),
        "team_name": team,
        "position": row.get("position") or "",
        "source_url": (f"https://{row['source_subdomain']}.curling.io/en/events/{quote(str(row.get('event_id') or ''))}" if row.get("event_id") else row.get("source_url") or ""),
        "retrieved_at": row.get("retrieved_at") or row.get("snapshot_at") or "",
        "sha256": row.get("sha256") or "",
    }
    records[record_key(clean)] = clean


def build():
    records = {}
    snapshot_times = []
    for path in sorted(HISTORY.glob("*.json")):
        payload = read_json(path, {})
        generated = payload.get("generated_at")
        if generated:
            snapshot_times.append(generated)
        subdomain = payload.get("source_subdomain")
        if not subdomain:
            continue
        for curler_id, appearances in (payload.get("curler_appearances") or {}).items():
            for row in appearances if isinstance(appearances, list) else []:
                item = dict(row)
                item.update({"source_subdomain": subdomain, "source_curler_id": curler_id, "retrieved_at": item.get("retrieved_at") or generated})
                add_record(records, item)

    current = read_json(CURRENT, {})
    for source in current.get("sources", []):
        subdomain = source.get("subdomain")
        if not subdomain:
            continue
        for event in source.get("events", []):
            for team in event.get("teams", []):
                for curler in team.get("lineup", []):
                    add_record(records, {
                        "source_subdomain": subdomain,
                        "source_curler_id": curler.get("curler_id"),
                        "published_name": curler.get("name"),
                        "position": curler.get("position"),
                        "event_id": event.get("event_id"),
                        "event_name": event.get("name"),
                        "starts_on": event.get("starts_on"),
                        "season": (lambda year: f"{year} / {year + 1}")(int(current.get("season_start", "0000")[:4])) if str(current.get("season_start", ""))[:4].isdigit() else "",
                        "team_id": team.get("team_id"),
                        "team_name": team.get("team_name"),
                        "source_url": event.get("source_url"),
                        "retrieved_at": event.get("retrieved_at") or source.get("last_success_at"),
                        "sha256": event.get("sha256"),
                    })

    # Keep recent event records per source-native athlete ID for useful offline
    # fallback. Full source history remains in the history files.
    identities = {}
    for row in records.values():
        identity = (row["source_subdomain"], row["source_curler_id"]) if row["source_curler_id"] else (
            row["source_subdomain"], "unresolved", row["normalized_name"], row["event_id"], row["team_id"]
        )
        identities.setdefault(identity, []).append(row)
    names = {}
    for (subdomain, source_id), rows in identities.items():
        rows.sort(key=lambda row: (date_key(row.get("starts_on")), int(row.get("event_id") or 0)), reverse=True)
        kept = rows[:20]
        latest = kept[0]
        names.setdefault(latest["normalized_name"], []).append({
            "name": latest["name"],
            "source_subdomain": subdomain,
            "source_curler_id": source_id,
            "records": kept,
        })
    for candidates in names.values():
        candidates.sort(key=lambda candidate: (
            date_key(candidate["records"][0].get("starts_on")),
            int(candidate["records"][0].get("event_id") or 0),
        ), reverse=True)

    source_snapshot_at = max(snapshot_times, default="")
    shard_names = {}
    for normalized, candidates in names.items():
        first = normalized[0] if normalized and normalized[0].isalpha() else "other"
        shard_names.setdefault(first, {})[normalized] = candidates

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_shards = []
    for shard, shard_map in sorted(shard_names.items()):
        shard_payload = {
            "schema_version": 1,
            "generated_at": source_snapshot_at,
            "source_provider": "Curling I/O",
            "source_policy": "Exact published names and source-native IDs only; repeated profiles group only for matching names and IDs, and event links preserve their source association.",
            "name_count": len(shard_map),
            "names": shard_map,
        }
        encoded = json.dumps(shard_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        path = OUT_DIR / f"{shard}.json"
        if not path.exists() or path.read_text(encoding="utf-8") != encoded:
            temp = path.with_suffix(".json.tmp")
            temp.write_bytes(encoded.encode("utf-8"))
            temp.replace(path)
        manifest_shards.append({"key": shard, "file": path.name, "name_count": len(shard_map), "bytes": path.stat().st_size})

    payload = {
        "schema_version": 1,
        "generated_at": source_snapshot_at,
        "source_snapshot_at": source_snapshot_at,
        "source_provider": "Curling I/O",
        "source_policy": "Exact published names and source-native IDs only; repeated profiles merge only when the exact name and source-native ID match. Event records retain their source association.",
        "identity_count": len(identities),
        "name_count": len(names),
        "records": sum(len(candidate["records"]) for candidates in names.values() for candidate in candidates),
        "shard_count": len(manifest_shards),
        "shards": manifest_shards,
    }
    manifest_path = OUT_DIR / "manifest.json"
    encoded_manifest = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if not manifest_path.exists() or manifest_path.read_text(encoding="utf-8") != encoded_manifest:
        temp = manifest_path.with_suffix(".json.tmp")
        temp.write_bytes(encoded_manifest.encode("utf-8"))
        temp.replace(manifest_path)

    # A compact, same-origin catalog lets the public application resolve exact
    # names, offer typo suggestions, and present same-name source profiles
    # before it makes any network requests. Profiles remain source-native and
    # are deliberately not merged across associations.
    catalog_names = []
    for normalized, candidates in sorted(names.items()):
        catalog_names.append({
            "normalized": normalized,
            "name": candidates[0]["name"],
            "profiles": [{
                "source_subdomain": candidate["source_subdomain"],
                "source_curler_id": str(candidate.get("source_curler_id") or ""),
                "team_name": candidate["records"][0].get("team_name") or "",
                "event_id": str(candidate["records"][0].get("event_id") or ""),
                "season": candidate["records"][0].get("season") or "",
            } for candidate in candidates],
        })
    catalog_payload = {
        "schema_version": 1,
        "generated_at": source_snapshot_at,
        "source_provider": "Curling I/O",
        "source_policy": "Names and profiles preserve source-native identities; exact-name profiles sharing a source-native ID are grouped, while different IDs remain separate.",
        "name_count": len(catalog_names),
        "names": catalog_names,
    }
    encoded_catalog = json.dumps(catalog_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not CATALOG.exists() or CATALOG.read_text(encoding="utf-8") != encoded_catalog:
        temp = CATALOG.with_suffix(".json.tmp")
        temp.write_bytes(encoded_catalog.encode("utf-8"))
        temp.replace(CATALOG)

    # Browser search loads only compact first-name or surname shards. The full
    # catalog remains a deterministic QA artifact but is not needed by visitors.
    search_shards = {}
    for row in catalog_names:
        normalized = row["normalized"]
        first_key = normalized[0] if normalized and normalized[0].isalnum() else "other"
        surname = normalized.split(" ")[-1]
        surname_key = surname[0] if surname and surname[0].isalnum() else "other"
        search_shards.setdefault(f"first-{first_key}", []).append(row)
        search_shards.setdefault(f"last-{surname_key}", []).append(row)
    NAME_CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    expected_files = set()
    for key, shard_rows in sorted(search_shards.items()):
        shard_payload = {
            "schema_version": 1,
            "generated_at": source_snapshot_at,
            "source_provider": "Curling I/O",
            "name_count": len(shard_rows),
            "names": shard_rows,
        }
        encoded = json.dumps(shard_payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        path = NAME_CATALOG_DIR / f"{key}.json"
        expected_files.add(path.name)
        if not path.exists() or path.read_text(encoding="utf-8") != encoded:
            temp = path.with_suffix(".json.tmp")
            temp.write_bytes(encoded.encode("utf-8"))
            temp.replace(path)
    for stale in NAME_CATALOG_DIR.glob("*.json"):
        if stale.name not in expected_files:
            stale.unlink()
    print(f"Offline curler index: {payload['name_count']} names, {payload['identity_count']} source IDs across {payload['shard_count']} archive shards and {len(search_shards)} search shards -> {OUT_DIR}")
    return payload


def main():
    parser = argparse.ArgumentParser(description="Build a static last-reported team lookup from saved source snapshots.")
    parser.parse_args()
    build()


if __name__ == "__main__":
    main()
