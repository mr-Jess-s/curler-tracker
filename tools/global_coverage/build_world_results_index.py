#!/usr/bin/env python3
import datetime as dt
import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
URL = "https://results.worldcurling.org/Association"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=35) as response:
        return response.read().decode("utf-8", errors="replace")

def clean(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()

def parse(page):
    rows = {}
    for flag in re.finditer(
        r'/Content/images/wcf-flags/([A-Z0-9]+)\.png',
        page,
        re.I,
    ):
        code = flag.group(1).upper()
        start = max(0, flag.start() - 1800)
        block = page[start:flag.end()]
        links = list(re.finditer(
            r'href="/Association/Details/(\d+)"[^>]*>(.*?)</a>',
            block,
            re.I | re.S,
        ))
        if not links:
            continue
        association_id = int(links[-1].group(1))
        labels = sorted({
            clean(match.group(2))
            for match in links
            if int(match.group(1)) == association_id and clean(match.group(2))
        })
        rows[code] = {
            "world_code": code,
            "association_id": association_id,
            "labels": labels,
            "details_url": f"https://results.worldcurling.org/Association/Details/{association_id}",
        }
    return [rows[key] for key in sorted(rows)]

def main():
    page = fetch(URL)
    rows = parse(page)
    payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": URL,
        "association_count": len(rows),
        "associations": rows,
    }
    out = DATA / "world-results-association-index.json"
    out.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} association-code mappings to {out}")

if __name__ == "__main__":
    main()
