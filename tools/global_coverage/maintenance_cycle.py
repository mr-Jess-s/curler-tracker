#!/usr/bin/env python3
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "global_coverage"
STATE = ROOT / "data" / "global" / "maintenance-state.json"

TASKS = [
    {"name":"world_results","cmd":[sys.executable,str(TOOLS/"continuous_world_results.py")],"hours":6,"timeout":1800},
    {"name":"country_registry","cmd":[sys.executable,str(TOOLS/"build_country_registry.py")],"hours":24,"timeout":300},
    {"name":"world_site_inventory","cmd":[sys.executable,str(TOOLS/"inventory_world_sites.py"),"--max-pages","40","--delay","0.10","--workers","4"],"hours":72,"timeout":3600},
    {"name":"canada_site_inventory","cmd":[sys.executable,str(TOOLS/"inventory_canada_sites.py"),"--max-pages","120","--delay","0.10","--workers","3"],"hours":24,"timeout":2400},
    {"name":"canada_alberta_clubs","cmd":[sys.executable,str(TOOLS/"extract_canada_alberta_clubs.py")],"hours":168,"timeout":2400},
    {"name":"canada_yukon_clubs","cmd":[sys.executable,str(TOOLS/"extract_canada_yukon_clubs.py")],"hours":168,"timeout":900},
    {"name":"coverage_update","cmd":[sys.executable,str(TOOLS/"update_coverage_registry.py")],"hours":6,"timeout":300},
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
    STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

def due(entry, hours):
    stamp = entry.get("last_success_at")
    if not stamp:
        return True
    try:
        last = dt.datetime.fromisoformat(stamp.replace("Z","+00:00"))
        return now() - last >= dt.timedelta(hours=hours)
    except Exception:
        return True

def run_task(task, state):
    entry = state["tasks"].setdefault(task["name"], {})
    if not due(entry, task["hours"]):
        return
    entry["state"] = "running"
    entry["started_at"] = now().isoformat()
    save_state(state)
    try:
        result = subprocess.run(
            task["cmd"], cwd=ROOT, text=True, capture_output=True,
            timeout=task["timeout"], check=False
        )
        entry["exit_code"] = result.returncode
        entry["stdout_tail"] = result.stdout[-4000:]
        entry["stderr_tail"] = result.stderr[-4000:]
        if result.returncode == 0:
            entry["state"] = "complete"
            entry["last_success_at"] = now().isoformat()
        else:
            entry["state"] = "failed"
    except subprocess.TimeoutExpired as exc:
        entry["state"] = "timeout"
        entry["error"] = f"Timed out after {task['timeout']} seconds"
        entry["stdout_tail"] = (exc.stdout or "")[-4000:] if isinstance(exc.stdout, str) else ""
        entry["stderr_tail"] = (exc.stderr or "")[-4000:] if isinstance(exc.stderr, str) else ""
    except Exception as exc:
        entry["state"] = "failed"
        entry["error"] = str(exc)
    entry["finished_at"] = now().isoformat()
    save_state(state)

def main():
    state = load_state()
    state.setdefault("tasks", {})
    for task in TASKS:
        run_task(task, state)
    print("Maintenance cycle complete")

if __name__ == "__main__":
    main()
