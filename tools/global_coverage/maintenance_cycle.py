#!/usr/bin/env python3
import datetime as dt
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "global_coverage"
STATE = ROOT / "data" / "global" / "maintenance-state.json"

TASKS = [
    {"name":"canada_current_season","cmd":[sys.executable,str(TOOLS/"archive_canada_current_season.py"),"--max-sources","14","--max-events-per-source","10","--delay","0.5"],"hours":6,"timeout":2400},
    {"name":"offline_curler_index","cmd":[sys.executable,str(TOOLS/"build_offline_curler_index.py")],"hours":6,"timeout":300},
    {"name":"canada_site_inventory","cmd":[sys.executable,str(TOOLS/"inventory_canada_sites.py"),"--max-pages","120","--delay","0.10","--workers","3"],"hours":24,"timeout":2400},
    {"name":"canada_alberta_clubs","cmd":[sys.executable,str(TOOLS/"extract_canada_alberta_clubs.py")],"hours":168,"timeout":2400},
    {"name":"canada_yukon_clubs","cmd":[sys.executable,str(TOOLS/"extract_canada_yukon_clubs.py")],"hours":168,"timeout":900},
    {"name":"world_results","cmd":[sys.executable,str(TOOLS/"continuous_world_results.py")],"hours":6,"timeout":1800},
    {"name":"coverage_update","cmd":[sys.executable,str(TOOLS/"update_coverage_registry.py")],"hours":6,"timeout":300},
    {"name":"country_registry","cmd":[sys.executable,str(TOOLS/"build_country_registry.py")],"hours":24,"timeout":300},
    {"name":"world_site_inventory","cmd":[sys.executable,str(TOOLS/"inventory_world_sites.py"),"--max-pages","40","--delay","0.10","--workers","4"],"hours":72,"timeout":1200},
]

def now():
    return dt.datetime.now(dt.timezone.utc)

def load_state():
    if not STATE.exists():
        return {"tasks":{}}
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {"tasks":{}}

def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = now().isoformat()
    temp = STATE.with_suffix(".json.tmp")
    temp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    temp.replace(STATE)

def due(entry, hours):
    retry_at = entry.get("next_retry_at")
    if retry_at:
        try:
            return now() >= dt.datetime.fromisoformat(retry_at.replace("Z", "+00:00"))
        except Exception:
            return True
    if entry.get("error") or entry.get("state") in {"failed", "timeout"}:
        return True
    stamp = entry.get("last_success_at")
    if not stamp:
        return True
    try:
        last = dt.datetime.fromisoformat(stamp.replace("Z","+00:00"))
        return now() - last >= dt.timedelta(hours=hours)
    except Exception:
        return True

def run_task(task, state, dry_run=False):
    entry = state["tasks"].setdefault(task["name"], {})
    if not due(entry, task["hours"]):
        return "not_due"
    if dry_run:
        print(f"DUE {task['name']} timeout={task['timeout']}s")
        return "due"
    entry["state"] = "running"
    entry["started_at"] = now().isoformat()
    entry["attempts_this_cycle"] = 0
    save_state(state)
    outcome = "failed"
    for attempt in range(1, 4):
        entry["attempts_this_cycle"] = attempt
        entry["last_attempt_at"] = now().isoformat()
        try:
            result = subprocess.run(task["cmd"], cwd=ROOT, text=True, capture_output=True,
                                    timeout=task["timeout"], check=False)
            entry["exit_code"] = result.returncode
            entry["stdout_tail"] = result.stdout[-4000:]
            entry["stderr_tail"] = result.stderr[-4000:]
            if result.returncode == 0:
                outcome = "complete"
                entry["last_success_at"] = now().isoformat()
                entry.pop("error", None)
                break
            entry["error"] = f"Exit code {result.returncode}"
        except subprocess.TimeoutExpired as exc:
            outcome = "timeout"
            entry["error"] = f"Timed out after {task['timeout']} seconds"
            entry["stdout_tail"] = (exc.stdout or "")[-4000:] if isinstance(exc.stdout, str) else ""
            entry["stderr_tail"] = (exc.stderr or "")[-4000:] if isinstance(exc.stderr, str) else ""
            break
        except Exception as exc:
            outcome = "failed"
            entry["error"] = str(exc)
        if attempt < 3:
            time.sleep(5 * attempt)
    entry["state"] = outcome
    entry["finished_at"] = now().isoformat()
    if outcome == "complete":
        entry.pop("next_retry_at", None)
        entry["consecutive_failures"] = 0
    else:
        failures = int(entry.get("consecutive_failures", 0)) + 1
        entry["consecutive_failures"] = failures
        delay_minutes = min(24 * 60, 15 * (2 ** min(failures - 1, 6)))
        entry["next_retry_at"] = (now() + dt.timedelta(minutes=delay_minutes)).isoformat()
    save_state(state)
    return outcome

def main():
    parser = argparse.ArgumentParser(description="Run bounded, resumable acquisition jobs.")
    parser.add_argument("--only", choices=[task["name"] for task in TASKS])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    state = load_state()
    state.setdefault("tasks", {})
    tasks = [task for task in TASKS if not args.only or task["name"] == args.only]
    for task in tasks:
        run_task(task, state, dry_run=args.dry_run)
    print("Maintenance cycle complete")

if __name__ == "__main__":
    main()
