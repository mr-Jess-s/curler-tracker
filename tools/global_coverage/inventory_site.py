#!/usr/bin/env python3
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import html.parser
import json
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTDIR = ROOT / "data" / "global" / "inventories"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"

KEYWORDS = {
    "national_events_results": ("result", "championship", "score", "draw", "standings"),
    "clubs_facilities": ("club", "facility", "centre", "center", "rink"),
    "rankings": ("ranking", "points", "standings"),
    "athlete_team_profiles": ("athlete", "team", "roster", "player", "curler"),
    "calendar_draws": ("calendar", "schedule", "event", "draw"),
    "subnational_governance": ("province", "state", "region", "association", "district"),
    "historical_digital_archives": ("archive", "history", "yearbook", "factbook", "past champions"),
    "historical_external_archives": ("museum", "library", "collection", "newspaper"),
}

class LinkParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.title = ""
        self._in_title = False
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        elif tag == "title":
            self._in_title = True
    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
    def handle_data(self, data):
        if self._in_title:
            self.title += data
def classify(url, title):
    hay = (url + " " + title).lower()
    return sorted({family for family, words in KEYWORDS.items() if any(word in hay for word in words)})

def normalize_link(base, href):
    joined = urllib.parse.urljoin(base, href)
    parsed = urllib.parse.urlsplit(joined)
    if parsed.scheme not in {"http", "https"}:
        return ""
    clean = parsed._replace(fragment="").geturl()
    return clean.rstrip("/")

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as response:
        body = response.read()
        return response.status, response.headers, body

def crawl(seed, max_pages, delay, save_dir=None):
    parsed_seed = urllib.parse.urlsplit(seed)
    origin = f"{parsed_seed.scheme}://{parsed_seed.netloc}"
    robots_url = origin + "/robots.txt"
    robots = urllib.robotparser.RobotFileParser()
    robots.set_url(robots_url)
    try:
        _, _, robots_body = fetch(robots_url)
        robots.parse(robots_body.decode("utf-8", errors="replace").splitlines())
        robots_known = True
    except Exception:
        robots_known = False

    queue = collections.deque([seed.rstrip("/")])
    seen = set()
    rows = []
    while queue and len(rows) < max_pages:
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        if robots_known and not robots.can_fetch(UA, url):
            rows.append({"url": url, "status": "robots_disallowed"})
            continue
        try:
            status, headers, body = fetch(url)
            ctype = headers.get_content_type()
            digest = hashlib.sha256(body).hexdigest()
            raw_path = None
            if save_dir:
                raw_dir = Path(save_dir)
                raw_dir.mkdir(parents=True, exist_ok=True)
                suffix = "html" if ctype == "text/html" else "bin"
                raw_path = raw_dir / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:20]}.{suffix}.gz"
                with gzip.open(raw_path, "wb", compresslevel=9) as handle:
                    handle.write(body)
            row = {
                "url": url,
                "status": status,
                "content_type": ctype,
                "bytes": len(body),
                "sha256": digest,
                "source_families": [],
            }
            if raw_path:
                try:
                    row["raw_path"] = str(raw_path.relative_to(ROOT))
                except ValueError:
                    row["raw_path"] = str(raw_path)
            if ctype == "text/html":
                parser = LinkParser()
                parser.feed(body.decode("utf-8", errors="replace"))
                row["title"] = " ".join(parser.title.split())
                row["source_families"] = classify(url, row["title"])
                for href in parser.links:
                    child = normalize_link(url, href)
                    if not child:
                        continue
                    cp = urllib.parse.urlsplit(child)
                    if cp.netloc == parsed_seed.netloc and child not in seen:
                        queue.append(child)
            rows.append(row)
        except Exception as exc:
            rows.append({"url": url, "status": "error", "error": str(exc)})
        if delay:
            time.sleep(delay)
    return {"robots_url": robots_url, "robots_loaded": robots_known, "pages": rows}
def main():
    parser = argparse.ArgumentParser(description="Inventory a curling source site deterministically.")
    parser.add_argument("--url", required=True)
    parser.add_argument("--code", required=True, help="World Curling country/member code")
    parser.add_argument("--max-pages", type=int, default=200)
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()

    result = crawl(args.url, args.max_pages, args.delay)
    parsed = urllib.parse.urlsplit(args.url)
    host = parsed.netloc.replace(":", "_")
    payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "country_code": args.code.upper(),
        "seed_url": args.url,
        "host": parsed.netloc,
        "max_pages": args.max_pages,
        **result,
    }
    payload["pages_fetched"] = sum(1 for p in payload["pages"] if isinstance(p.get("status"), int))
    payload["pages_blocked"] = sum(1 for p in payload["pages"] if p.get("status") == "robots_disallowed")
    payload["pages_failed"] = sum(1 for p in payload["pages"] if p.get("status") == "error")
    payload["family_candidates"] = sorted({
        family for page in payload["pages"] for family in page.get("source_families", [])
    })

    OUTDIR.mkdir(parents=True, exist_ok=True)
    out = OUTDIR / f"{args.code.lower()}-{host}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote inventory: {out}")
    print(f"Fetched={payload['pages_fetched']} blocked={payload['pages_blocked']} failed={payload['pages_failed']}")
    print("Candidates=" + ",".join(payload["family_candidates"]))

if __name__ == "__main__":
    main()
