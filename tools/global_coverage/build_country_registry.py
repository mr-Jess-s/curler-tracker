#!/usr/bin/env python3
import argparse
import datetime as dt
import html
import json
import re
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
WORLD_MEMBERS_URL = "https://worldcurling.org/member-associations/"
WORLD_RESULTS_URL = "https://results.worldcurling.org/"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")

def text_only(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value))).strip()

def normalize_website(raw):
    value = text_only(raw)
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    return "https://" + value.lstrip("/")

def parse_world_members(page):
    cards = re.findall(
        r'<article\b[^>]*member-association-card[^>]*>(.*?)</article>',
        page,
        flags=re.I | re.S,
    )
    rows = []
    for card in cards:
        name_match = re.search(r'<h3[^>]*>\s*<em>(.*?)</em>\s*</h3>', card, re.I | re.S)
        profile_match = re.search(
            r'<a\s+href="([^"]+)"[^>]+aria-label="Read more about ([^"]+)"',
            card,
            re.I | re.S,
        )
        code_match = re.search(r'<span class="me-2">\s*([^<]+)\s*</span>', card, re.I)
        year_matches = re.findall(r'<span>\s*(\d{4})\s*</span>', card, re.I)
        website_match = re.search(r'<p class="ma-website">(.*?)</p>', card, re.I | re.S)
        if not (name_match and profile_match and code_match):
            continue
        rows.append({
            "country_or_member": html.unescape(profile_match.group(2)).strip(),
            "association_name": text_only(name_match.group(1)),
            "world_code": text_only(code_match.group(1)),
            "member_since": int(year_matches[-1]) if year_matches else None,
            "world_member_url": urljoin(WORLD_MEMBERS_URL, profile_match.group(1)),
            "association_website": normalize_website(website_match.group(1)) if website_match else "",
        })
    return rows
def source_slot(family, applicable, status="unknown", url="", note=""):
    return {
        "family": family,
        "applicable": applicable,
        "status": status,
        "source_url": url,
        "last_checked": None,
        "ingest_status": "not_started",
        "document_inventory_status": "not_started",
        "notes": note,
    }

def build_country(member, taxonomy):
    slots = []
    for family in taxonomy["source_families"]:
        required = bool(family.get("required_for_all_members"))
        slots.append(source_slot(
            family["id"],
            True if required else "unknown",
            "unknown",
        ))

    by_id = {slot["family"]: slot for slot in slots}
    by_id["world_member_record"].update({
        "status": "verified",
        "source_url": member["world_member_url"],
        "last_checked": dt.datetime.now(dt.timezone.utc).isoformat(),
        "ingest_status": "ingested",
        "document_inventory_status": "partial",
    })
    by_id["international_results"].update({
        "status": "discovered",
        "source_url": WORLD_RESULTS_URL,
        "notes": "Official World Curling results system; per-country coverage still requires inventory.",
    })
    if member["association_website"]:
        by_id["national_governing_body"].update({
            "status": "discovered",
            "source_url": member["association_website"],
            "notes": "Official website published by World Curling; document inventory not yet complete.",
        })

    return {
        "country_or_member": member["country_or_member"],
        "world_code": member["world_code"],
        "association_name": member["association_name"],
        "member_since": member["member_since"],
        "world_member_url": member["world_member_url"],
        "association_website": member["association_website"],
        "source_families": slots,
        "country_specific_sources": [],
        "progress": {},
    }

def calculate_progress(country):
    slots = country["source_families"] + country.get("country_specific_sources", [])
    applicable = [s for s in slots if s.get("applicable") is True]
    unknown_app = [s for s in slots if s.get("applicable") == "unknown"]
    verified = [s for s in applicable if s.get("status") == "verified"]
    discovered = [s for s in applicable if s.get("status") in {"discovered", "verified"}]
    ingestible = [s for s in applicable if s.get("status") == "verified"]
    ingested = [s for s in ingestible if s.get("ingest_status") == "ingested"]

    discovery = round(100 * len(verified) / len(applicable), 1) if applicable else 0.0
    ingestion = round(100 * len(ingested) / len(ingestible), 1) if ingestible else 0.0
    country["progress"] = {
        "applicable_source_families": len(applicable),
        "applicability_unknown": len(unknown_app),
        "sources_discovered_or_verified": len(discovered),
        "sources_verified": len(verified),
        "sources_ingested": len(ingested),
        "discovery_percent": discovery,
        "ingestion_percent": ingestion,
        "overall_percent": None,
        "overall_reason": "Overall percentage withheld until source applicability is fully surveyed."
            if unknown_app else "Ready for weighted overall calculation after archive inventory.",
    }
def main():
    parser = argparse.ArgumentParser(description="Build the global curling member/source registry.")
    parser.add_argument("--world-html", help="Use a saved World Curling member page instead of fetching.")
    parser.add_argument("--output", default=str(DATA / "country-registry.json"))
    args = parser.parse_args()

    taxonomy = json.loads((DATA / "source-taxonomy.json").read_text(encoding="utf-8"))
    if args.world_html:
        page = Path(args.world_html).read_text(encoding="utf-8")
    else:
        page = fetch(WORLD_MEMBERS_URL)

    members = parse_world_members(page)
    if len(members) < 60:
        raise SystemExit(f"Refusing to write registry: only {len(members)} World Curling members parsed.")

    countries = [build_country(member, taxonomy) for member in members]
    for country in countries:
        calculate_progress(country)

    payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "world_member_source": WORLD_MEMBERS_URL,
        "world_member_count": len(countries),
        "definition": {
            "complete": "Every applicable source family and country-specific source is identified, verified, inventoried, and either ingested or explicitly classified as inaccessible/non-digital.",
            "not_claimed": "This registry never equates missing records with records that never existed.",
        },
        "countries": sorted(countries, key=lambda row: row["world_code"]),
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(countries)} World Curling members to {out}")

if __name__ == "__main__":
    main()
