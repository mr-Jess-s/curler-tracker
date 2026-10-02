#!/usr/bin/env python3
import concurrent.futures
import datetime as dt
import html
import json
import re
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
UA = "CurlerTrackerCoverage/1.0 (+https://github.com/mr-Jess-s/curler-tracker)"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")

def clean(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()

def first(pattern, page):
    match = re.search(pattern, page, re.I | re.S)
    return match.group(1).strip() if match else ""

def parse_profile(country):
    url = country["world_member_url"]
    page = fetch(url)
    website = first(
        r'<strong>Website:</strong>.*?<a[^>]+href="([^"]+)"',
        page,
    )
    historical = first(
        r'href="(https://results\.worldcurling\.org/Association/Details/\d+)"',
        page,
    )
    president = clean(first(
        r"<strong>President:</strong>(.*?)</em>\s*</p>",
        page,
    ))
    secretary = clean(first(
        r"<strong>Secretary General:</strong>(.*?)</em>\s*</p>",
        page,
    ))
    social_links = sorted(set(
        match
        for match in re.findall(
            r'<a[^>]+class="[^"]*sm-icon[^"]*"[^>]+href="([^"]+)"',
            page,
            re.I,
        )
    ))
    return {
        "world_code": country["world_code"],
        "country_or_member": country["country_or_member"],
        "association_name": country["association_name"],
        "profile_url": url,
        "official_website": website or country.get("association_website", ""),
        "historical_results_url": historical,
        "president": president,
        "secretary_general": secretary,
        "social_links": social_links,
        "profile_retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
def main():
    registry_path = DATA / "country-registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    countries = registry["countries"]
    results = []
    errors = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {
            pool.submit(parse_profile, country): country
            for country in countries
        }
        for future in concurrent.futures.as_completed(future_map):
            country = future_map[future]
            try:
                row = future.result()
                results.append(row)
                print(
                    f"{row['world_code']}: profile "
                    f"website={bool(row['official_website'])} "
                    f"results={bool(row['historical_results_url'])}",
                    flush=True,
                )
            except Exception as exc:
                errors.append({
                    "world_code": country["world_code"],
                    "profile_url": country["world_member_url"],
                    "error": str(exc),
                })
                print(
                    f"{country['world_code']}: failed {exc}",
                    flush=True,
                )
    results.sort(key=lambda row: row["world_code"])
    payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "profile_count": len(results),
        "error_count": len(errors),
        "profiles": results,
        "errors": errors,
    }
    out = DATA / "world-member-profiles.json"
    out.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    by_code = {row["world_code"]: row for row in results}
    for country in registry["countries"]:
        profile = by_code.get(country["world_code"])
        if not profile:
            continue
        country["association_website"] = (
            profile["official_website"]
            or country.get("association_website", "")
        )
        country["world_results_url"] = profile["historical_results_url"]
        country["world_profile_people"] = {
            "president": profile["president"],
            "secretary_general": profile["secretary_general"],
        }
        country["world_profile_social_links"] = profile["social_links"]
    registry["profile_enriched_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    registry_path.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(results)} profiles to {out}")
    print(f"Errors: {len(errors)}")

if __name__ == "__main__":
    main()
