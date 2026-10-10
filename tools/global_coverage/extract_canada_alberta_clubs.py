#!/usr/bin/env python3
import datetime as dt
import gzip
import hashlib
import html
import json
import re
import time
import urllib.request
from pathlib import Path
from acquisition_support import fetch_snapshot

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "canada-clubs"
RAW = ROOT / "data" / "raw" / "canada-clubs" / "ab"
INDEX_URL = "https://curlingalberta.ca/clubs/"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"
LAST_RECORDS = {}

def fetch(url):
    record, body = fetch_snapshot(url, "canada-clubs-ab", "canada-clubs", timeout=35)
    LAST_RECORDS[url] = record
    if body is None:
        with gzip.open(ROOT / record["raw_path"], "rb") as handle:
            body = handle.read()
    return record.get("final_url", url), record["status"], record, body

def clean(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()

def save_raw(url, body):
    record = LAST_RECORDS.get(url)
    if record and record.get("raw_path"):
        return record["raw_path"]
    raise RuntimeError(f"No archived snapshot provenance available for {url}")
def parse_index(page):
    found = {}
    pattern = re.compile(
        r'\{\s*lat:([\-\d.]+),\s*lng:([\-\d.]+),\s*title:"(.*?)",link:"(.*?)",',
        re.I | re.S,
    )
    for match in pattern.finditer(page):
        lat, lng, title, link = match.groups()
        link = html.unescape(link.replace("\\/", "/"))
        title = clean(title)
        found[link] = {
            "name": title,
            "directory_url": link,
            "latitude": float(lat),
            "longitude": float(lng),
        }
    return sorted(found.values(), key=lambda row: row["name"].lower())

def heading_values(fragment):
    return [
        clean(value)
        for value in re.findall(
            r'class="elementor-heading-title[^"]*"[^>]*>(.*?)</(?:div|h2|span)>',
            fragment,
            re.I | re.S,
        )
        if clean(value)
    ]

def parse_club_page(page, seed):
    address_idx = page.find("Address:")
    phone_idx = page.find("Phone:")
    address_values = []
    if address_idx >= 0:
        end = phone_idx if phone_idx > address_idx else min(len(page), address_idx + 12000)
        address_values = heading_values(page[address_idx:end])
    address_values = [value for value in address_values if value.lower() != "address:"]
    phone = ""
    website = ""
    if phone_idx >= 0:
        fragment = page[phone_idx:phone_idx + 15000]
        values = heading_values(fragment)
        values = [value for value in values if value.lower() != "phone:"]
        if values:
            phone = values[0]
        links = re.findall(r'<a[^>]+href="([^"]+)"', fragment, re.I)
        for link in links:
            link = html.unescape(link)
            if link.startswith("http") and "curlingalberta.ca" not in link:
                website = link
                break

    name = address_values[0] if address_values else seed["name"]
    street = address_values[1] if len(address_values) > 1 else ""
    city = address_values[2] if len(address_values) > 2 else ""
    postal = address_values[3] if len(address_values) > 3 else ""
    return {
        **seed,
        "name": name or seed["name"],
        "street_address": street,
        "city": city,
        "province": "AB",
        "postal_code": postal,
        "public_phone": phone,
        "club_website": website,
    }

def main():
    final_url, status, headers, body = fetch(INDEX_URL)
    page = body.decode("utf-8", errors="replace")
    seeds = parse_index(page)
    if len(seeds) < 50:
        raise SystemExit(f"Refusing to continue: only {len(seeds)} Alberta clubs parsed.")
    index_raw = save_raw(INDEX_URL, body)
    clubs = []
    errors = []
    for number, seed in enumerate(seeds, start=1):
        try:
            final_url, status, headers, body = fetch(seed["directory_url"])
            raw_path = save_raw(seed["directory_url"], body)
            club = parse_club_page(
                body.decode("utf-8", errors="replace"),
                seed,
            )
            club["source_url"] = seed["directory_url"]
            club["source_retrieved_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
            club["source_sha256"] = hashlib.sha256(body).hexdigest()
            club["raw_path"] = raw_path
            clubs.append(club)
        except Exception as exc:
            errors.append({
                "name": seed["name"],
                "source_url": seed["directory_url"],
                "error": str(exc),
            })
        if number % 10 == 0 or number == len(seeds):
            print(
                f"{number}/{len(seeds)} clubs "
                f"ok={len(clubs)} errors={len(errors)}",
                flush=True,
            )
        time.sleep(0.08)

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "province": "Alberta",
        "province_code": "AB",
        "directory_source": INDEX_URL,
        "directory_raw_path": index_raw,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "club_count": len(clubs),
        "error_count": len(errors),
        "clubs": sorted(clubs, key=lambda row: row["name"].lower()),
        "errors": errors,
    }
    out = OUT / "ab.json"
    out.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote Alberta club registry: {len(clubs)} clubs, "
        f"{len(errors)} errors -> {out}"
    )

if __name__ == "__main__":
    main()
