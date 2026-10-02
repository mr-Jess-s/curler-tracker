#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"
RAW_RESULTS = ROOT / "data" / "raw" / "worldcurling-results"

def load(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def by_family(country):
    return {
        row["family"]: row
        for row in country.get("source_families", [])
    }

def results_complete(association_id):
    if not association_id:
        return False, 0
    folder = RAW_RESULTS / "association" / str(association_id)
    if not folder.exists():
        return False, 0
    expected = {
        "details.html.gz",
        "Appearances.html.gz",
        "IndividualChampionships.html.gz",
        "IndividualFinals.html.gz",
        "IndividualMedals.html.gz",
        "IndividualGames.html.gz",
        "IndividualWins.html.gz",
    }
    present = {p.name for p in folder.glob("*.gz")}
    return expected.issubset(present), len(expected.intersection(present))
def calculate(country):
    rows = country.get("source_families", []) + country.get("country_specific_sources", [])
    applicable = [r for r in rows if r.get("applicable") is True]
    unknown = [r for r in rows if r.get("applicable") == "unknown"]
    verified = [r for r in applicable if r.get("status") == "verified"]
    discovered = [
        r for r in applicable
        if r.get("status") in {"discovered", "verified"}
    ]
    ingested = [
        r for r in verified
        if r.get("ingest_status") == "ingested"
    ]
    country["progress"] = {
        "applicable_source_families": len(applicable),
        "applicability_unknown": len(unknown),
        "sources_discovered_or_verified": len(discovered),
        "sources_verified": len(verified),
        "sources_ingested": len(ingested),
        "discovery_percent": round(
            100 * len(verified) / len(applicable), 1
        ) if applicable else 0.0,
        "ingestion_percent": round(
            100 * len(ingested) / len(verified), 1
        ) if verified else 0.0,
        "overall_percent": None,
        "overall_reason": (
            "Overall percentage withheld until source applicability is fully surveyed."
            if unknown
            else "Archive inventory still required before overall completion can be calculated."
        ),
    }

def main():
    registry_path = DATA / "country-registry.json"
    registry = load(registry_path)
    site_summary = load(DATA / "world-site-inventory-summary.json", {"results": []})
    results_index = load(DATA / "world-results-association-index.json", {"associations": []})
    site_by_code = {
        row["code"]: row
        for row in site_summary.get("results", [])
    }
    results_by_code = {
        row["world_code"]: row
        for row in results_index.get("associations", [])
    }

    for country in registry["countries"]:
        code = country["world_code"]
        slots = by_family(country)

        member = slots.get("world_member_record")
        if member:
            member["applicable"] = True
            member["status"] = "verified"
            member["ingest_status"] = "ingested"

        national = slots.get("national_governing_body")
        site = site_by_code.get(code)
        if national and country.get("association_website"):
            national["applicable"] = True
            national["status"] = "verified"
            national["source_url"] = country["association_website"]
            if site and site.get("pages_fetched", 0) > 0:
                national["ingest_status"] = "ingested"
            elif site and site.get("status") == "inventoried":
                national["ingest_status"] = "failed"

        international = slots.get("international_results")
        result_row = results_by_code.get(code)
        if international and result_row:
            international["applicable"] = True
            international["status"] = "verified"
            international["source_url"] = result_row["details_url"]
            complete, count = results_complete(result_row["association_id"])
            international["ingest_status"] = "ingested" if complete else ("partial" if count else "not_started")
            international["documents_downloaded"] = count
            international["documents_expected"] = 7
            country["world_results_association_id"] = result_row["association_id"]

        calculate(country)
    registry_path.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Updated coverage for {len(registry['countries'])} "
        "World Curling members."
    )

if __name__ == "__main__":
    main()
