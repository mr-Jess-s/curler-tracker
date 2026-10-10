#!/usr/bin/env python3
import datetime as dt
import gzip
import hashlib
import html
import json
import re
import urllib.request
from pathlib import Path
from acquisition_support import fetch_snapshot

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "canada-clubs"
RAW = ROOT / "data" / "raw" / "canada-clubs" / "yt"
URL = "https://www.yukoncurling.ca/Membership/Yukon-Curling-Clubs"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"
LAST_RECORD = None

def fetch(url):
    global LAST_RECORD
    LAST_RECORD, body = fetch_snapshot(url, "canada-clubs-yt", "canada-clubs", timeout=35)
    if body is None:
        with gzip.open(ROOT / LAST_RECORD["raw_path"], "rb") as handle:
            body = handle.read()
    return body

def clean(value):
    value = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    lines = [re.sub(r"\s+", " ", line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line)

def save_raw(body):
    if LAST_RECORD and LAST_RECORD.get("raw_path"):
        return LAST_RECORD["raw_path"]
    raise RuntimeError("No archived Yukon source snapshot provenance available")
def parse_cell(cell):
    text = clean(cell)
    lines = text.splitlines()
    if not lines:
        return None

    name = lines[0]
    phone = ""
    email = ""
    role = ""
    address_parts = []
    website = ""
    link_match = re.search(r'href="(https?://[^"]+)"', cell, re.I)
    if link_match:
        website = html.unescape(link_match.group(1))

    for line in lines[1:]:
        lower = line.lower()
        if lower.startswith("phone:"):
            phone = line.split(":", 1)[1].strip()
        elif lower.startswith("email:"):
            email = line.split(":", 1)[1].strip()
        elif lower.startswith(("president:", "organizer:", "club manager:")):
            role = line
        elif lower.startswith("fax:"):
            continue
        else:
            address_parts.append(line)

    address = ", ".join(address_parts)
    postal_match = re.search(r"\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b", address, re.I)
    return {
        "name": name,
        "address": address,
        "public_phone": phone,
        "public_email": email,
        "public_role": role,
        "club_website": website,
        "postal_code": postal_match.group(0).upper() if postal_match else "",
        "source_url": URL,
    }
def main():
    body = fetch(URL)
    page = body.decode("utf-8", errors="replace")
    table_match = re.search(
        r'<table[^>]*class="table table-striped"[^>]*>(.*?)</table>',
        page,
        re.I | re.S,
    )
    if not table_match:
        raise SystemExit("Yukon club table not found.")

    cells = re.findall(r"<td[^>]*>(.*?)</td>", table_match.group(1), re.I | re.S)
    clubs = []
    for cell in cells:
        club = parse_cell(cell)
        if not club:
            continue
        if "curling club" not in club["name"].lower():
            continue
        clubs.append(club)

    seen = {}
    for club in clubs:
        seen[club["name"]] = club
    clubs = list(seen.values())

    payload = {
        "schema_version": 1,
        "province": "Yukon",
        "province_code": "YT",
        "directory_source": URL,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_sha256": hashlib.sha256(body).hexdigest(),
        "raw_path": save_raw(body),
        "club_count": len(clubs),
        "clubs": sorted(clubs, key=lambda row: row["name"].lower()),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "yt.json"
    out.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote Yukon club registry: {len(clubs)} clubs -> {out}")

if __name__ == "__main__":
    main()
