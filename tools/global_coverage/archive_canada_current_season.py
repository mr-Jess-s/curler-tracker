#!/usr/bin/env python3
"""Archive a bounded set of published Curling I/O event pages for the current Canadian season."""
import argparse
import datetime as dt
import json
import time
from pathlib import Path
from urllib.parse import quote

from acquisition_support import fetch_snapshot, utc_now

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "canada-current-season.json"
SUBDOMAINS = ["ab", "bc", "mb", "nb", "nl", "nt", "ns", "nu", "on", "pe", "qc", "sk", "yt", "canada"]
API = "https://api-curlingio.global.ssl.fastly.net/en/clubs"


def current_season_start(today=None):
    today = today or dt.date.today()
    year = today.year if today.month >= 8 else today.year - 1
    return dt.date(year, 8, 1)


def event_date(row):
    value = row.get("starts_on") or row.get("start_date") or row.get("starts_at")
    if not value:
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        for pattern in ("%b %d, %Y", "%B %d, %Y"):
            try:
                return dt.datetime.strptime(str(value), pattern).date()
            except ValueError:
                pass
        return None


def request_json(url, source_id):
    record, body = fetch_snapshot(url, source_id, "canada-current-season", timeout=20)
    if body is None:
        import gzip
        body = gzip.open(ROOT / record["raw_path"], "rb").read()
    return json.loads(body.decode("utf-8")), record


def load_previous():
    try:
        value = json.loads(OUT.read_text(encoding="utf-8-sig"))
        if value.get("schema_version") == 1 and isinstance(value.get("sources"), list):
            return value
    except (OSError, json.JSONDecodeError):
        pass
    return {"sources": []}


def event_snapshot(event, payload, record, start, subdomain):
    teams = []
    for team in payload.get("teams", []):
        lineup = []
        for curler in team.get("lineup", []):
            if curler.get("curler_id") is None and not curler.get("name"):
                continue
            lineup.append({
                "curler_id": curler.get("curler_id"),
                "name": curler.get("name") or "",
                "position": curler.get("position") or "",
            })
        teams.append({
            "team_id": team.get("id"),
            "team_name": team.get("name") or "",
            "affiliation": team.get("affiliation") or "",
            "lineup": lineup,
        })
    return {
        "event_id": int(event["id"]),
        "name": event.get("name") or event.get("title") or payload.get("name") or "",
        "starts_on": start.isoformat(),
        "source_url": f"https://{subdomain}.curling.io/en/events/{event['id']}",
        "api_url": record.get("url"),
        "sha256": record.get("sha256"),
        "raw_path": record.get("raw_path"),
        "team_count": len(teams),
        "teams": teams,
        "retrieved_at": record.get("retrieved_at") or record.get("not_modified_at"),
    }


def run(max_sources=14, max_events_per_source=10, delay=0.5):
    season_start = current_season_start()
    previous = load_previous()
    previous_sources = {row.get("subdomain"): row for row in previous.get("sources", []) if row.get("subdomain")}
    rows = []
    for subdomain in SUBDOMAINS[:max_sources]:
        source_id = f"canada-season-{subdomain}"
        list_url = f"{API}/{quote(subdomain)}/competitions?occurred=-1&registrations=f"
        source = {"subdomain": subdomain, "list_url": list_url, "events": []}
        try:
            listing, _ = request_json(list_url, source_id)
            candidates = []
            for event in listing.get("items", []):
                start = event_date(event)
                if event.get("publish_results") is True and event.get("id") is not None and start and start >= season_start:
                    candidates.append((start, event))
            candidates.sort(key=lambda item: (item[0], int(item[1]["id"])), reverse=True)
            for start, event in candidates[:max_events_per_source]:
                event_id = int(event["id"])
                event_url = f"{API}/{quote(subdomain)}/events/{event_id}"
                payload, record = request_json(event_url, source_id)
                record["url"] = event_url
                source["events"].append(event_snapshot(event, payload, record, start, subdomain))
                if delay:
                    time.sleep(delay)
            source["state"] = "complete"
            source["published_events_in_season"] = len(candidates)
        except Exception as exc:
            source["state"] = "stale" if previous_sources.get(subdomain, {}).get("events") else "failed"
            source["error"] = str(exc)
        old_source = previous_sources.get(subdomain, {})
        if old_source.get("events"):
            merged = {int(row["event_id"]): row for row in old_source["events"] if row.get("event_id") is not None}
            merged.update({int(row["event_id"]): row for row in source["events"] if row.get("event_id") is not None})
            source["events"] = sorted(merged.values(), key=lambda row: (row.get("starts_on", ""), int(row.get("event_id") or 0)), reverse=True)
            if source["state"] == "failed":
                source["state"] = "stale"
            if source["state"] == "stale":
                source["last_success_at"] = old_source.get("last_success_at") or max((row.get("retrieved_at", "") for row in source["events"]), default="")
        elif source["state"] == "complete":
            source["last_success_at"] = max((row.get("retrieved_at", "") for row in source["events"]), default="")
        rows.append(source)
        print(f"{subdomain}: {source['state']} archived={len(source['events'])}", flush=True)
        if delay:
            time.sleep(delay)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".json.tmp")
    payload = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "season_start": season_start.isoformat(),
        "scope": "Published Curling I/O event pages from Canadian association subdomains; bounded per source per run.",
        "source_count": len(rows),
        "event_count": sum(len(row["events"]) for row in rows),
        "sources": rows,
    }
    temp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(OUT)
    failed = sum(1 for row in rows if row["state"] in {"failed", "stale"})
    stale = sum(1 for row in rows if row["state"] == "stale")
    print(f"Current-season archive: {len(rows)-failed}/{len(rows)} sources refreshed; {stale} using last-known snapshots; {sum(len(r['events']) for r in rows)} events -> {OUT}")
    return 1 if any(row["state"] == "failed" for row in rows) else 0


def main():
    parser = argparse.ArgumentParser(description="Archive current-season published Canadian Curling I/O results.")
    parser.add_argument("--max-sources", type=int, default=14)
    parser.add_argument("--max-events-per-source", type=int, default=10)
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()
    raise SystemExit(run(max(1, min(args.max_sources, len(SUBDOMAINS))), max(1, min(args.max_events_per_source, 50)), max(0, args.delay)))


if __name__ == "__main__":
    main()
