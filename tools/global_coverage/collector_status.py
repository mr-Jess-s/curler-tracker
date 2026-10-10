#!/usr/bin/env python3
"""Human-readable health summary for the background collector."""
import argparse
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return default


def age_hours(stamp):
    if not stamp:
        return None
    try:
        value = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        return max(0, (dt.datetime.now(dt.timezone.utc) - value).total_seconds() / 3600)
    except (ValueError, TypeError):
        return None


def build_report():
    runtime = read_json(DATA / "collector-runtime.json", {})
    cycle = read_json(DATA / "maintenance-state.json", {})
    tasks = cycle.get("tasks", {})
    season = read_json(DATA / "canada-current-season.json", {})
    manifest_dir = DATA / "acquisition-manifests"
    manifests = list(manifest_dir.glob("*.json")) if manifest_dir.exists() else []
    terms_pending = set()
    pages = 0
    for path in manifests:
        data = read_json(path, {})
        for row in data.get("pages", {}).values():
            pages += 1
            if row.get("terms_status", "unreviewed") == "unreviewed":
                from urllib.parse import urlsplit
                host = urlsplit(row.get("url", "")).hostname
                if host:
                    terms_pending.add(host)
    heartbeat_age = age_hours(runtime.get("heartbeat_at"))
    cycle_age = age_hours(cycle.get("updated_at"))
    alive = heartbeat_age is not None and heartbeat_age < 0.25
    task_rows = []
    for name, row in tasks.items():
        state = row.get("state", "unknown")
        if row.get("error") and state == "complete":
            state = "failed"
        task_rows.append({
            "name": name,
            "state": state,
            "last_success_at": row.get("last_success_at"),
            "last_attempt_at": row.get("last_attempt_at", row.get("started_at")),
            "next_retry_at": row.get("next_retry_at"),
            "error": row.get("error"),
        })
    issues = [row for row in task_rows if row["state"] in {"failed", "timeout"}]
    return {
        "collector": {
            "state": "running" if alive else "not recently verified",
            "process_id": runtime.get("process_id"),
            "phase": runtime.get("phase", "unknown"),
            "heartbeat_at": runtime.get("heartbeat_at"),
            "heartbeat_age_hours": round(heartbeat_age, 2) if heartbeat_age is not None else None,
            "startup_registered": runtime.get("startup_registered"),
        },
        "maintenance_state_updated_at": cycle.get("updated_at"),
        "maintenance_state_age_hours": round(cycle_age, 2) if cycle_age is not None else None,
        "task_count": len(task_rows),
        "failed_or_timed_out_tasks": len(issues),
        "raw_manifest_count": len(manifests),
        "manifest_page_count": pages,
        "terms_review_pending_hosts": sorted(terms_pending),
        "current_season_archive": {
            "generated_at": season.get("generated_at"),
            "source_count": season.get("source_count", 0),
            "event_count": season.get("event_count", 0),
            "failed_sources": [row.get("subdomain") for row in season.get("sources", []) if row.get("state") != "complete"],
        },
        "tasks": task_rows,
    }


def main():
    parser = argparse.ArgumentParser(description="Report collector process, source and job health.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()
    report = build_report()
    if args.json:
        print(json.dumps(report, indent=2))
        return
    collector = report["collector"]
    print(f"Collector: {collector['state']} (phase={collector['phase']}, PID={collector['process_id']})")
    print(f"Last maintenance state: {report['maintenance_state_updated_at'] or 'never'}")
    print(f"Source manifests: {report['raw_manifest_count']} | page records: {report['manifest_page_count']}")
    print(f"Jobs: {report['task_count']} | failed/timed out: {report['failed_or_timed_out_tasks']}")
    current = report["current_season_archive"]
    if current["generated_at"]:
        print(f"Canada current season: {current['event_count']} events from {current['source_count']} source(s); failed={current['failed_sources']}")
    if report["terms_review_pending_hosts"]:
        print("Terms review pending: " + ", ".join(report["terms_review_pending_hosts"]))
    for row in report["tasks"]:
        line = f"  {row['name']}: {row['state']}"
        if row["last_success_at"]:
            line += f"; last success {row['last_success_at']}"
        if row["next_retry_at"]:
            line += f"; retry after {row['next_retry_at']}"
        if row["error"]:
            line += f"; {row['error']}"
        print(line)


if __name__ == "__main__":
    main()
