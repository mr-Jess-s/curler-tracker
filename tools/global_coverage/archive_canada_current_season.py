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


def run(max_sources=14, max_events_per_source=10, delay=0.5):
    season_start = current_season_start()
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
                source["events"].append({
                    "event_id": event_id,
                    "name": event.get("name") or event.get("title") or "",
                    "starts_on": start.isoformat(),
                    "source_url": event_url,
                    "sha256": record.get("sha256"),
                    "raw_path": record.get("raw_path"),
                    "team_count": len(payload.get("teams", [])),
                    "retrieved_at": record.get("retrieved_at") or record.get("not_modified_at"),
                })
                if delay:
                    time.sleep(delay)
            source["state"] = "complete"
            source["published_events_in_season"] = len(candidates)
        except Exception as exc:
            source["state"] = "failed"
            source["error"] = str(exc)
        rows.append(source)
        print(f"{subdomain}: {source['state']} archived={len(source['events'])}", flush=True)
        if delay:
            time.sleep(delay)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps({
        "schema_version": 1,
        "generated_at": utc_now(),
        "season_start": season_start.isoformat(),
        "scope": "Published Curling I/O event pages from Canadian association subdomains; bounded per source per run.",
        "source_count": len(rows),
        "event_count": sum(len(row["events"]) for row in rows),
        "sources": rows,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(OUT)
    failed = sum(1 for row in rows if row["state"] != "complete")
    print(f"Current-season archive: {len(rows)-failed}/{len(rows)} sources ok; {sum(len(r['events']) for r in rows)} events -> {OUT}")
    return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser(description="Archive current-season published Canadian Curling I/O results.")
    parser.add_argument("--max-sources", type=int, default=14)
    parser.add_argument("--max-events-per-source", type=int, default=10)
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()
    raise SystemExit(run(max(1, min(args.max_sources, len(SUBDOMAINS))), max(1, min(args.max_events_per_source, 50)), max(0, args.delay)))


if __name__ == "__main__":
    main()
