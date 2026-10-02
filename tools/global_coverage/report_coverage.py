#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "global"

def load_registry(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def row(country):
    p = country.get("progress", {})
    return {
        "code": country["world_code"],
        "member": country["country_or_member"],
        "association": country["association_name"],
        "discovery": p.get("discovery_percent"),
        "ingestion": p.get("ingestion_percent"),
        "unknown": p.get("applicability_unknown"),
        "overall": p.get("overall_percent"),
    }

def print_table(rows):
    print(f"{'CODE':<5} {'DISC%':>7} {'INGEST%':>8} {'UNK':>5}  MEMBER")
    print("-" * 90)
    for r in rows:
        overall = "-" if r["overall"] is None else f"{r['overall']:.1f}"
        print(f"{r['code']:<5} {r['discovery']:>7.1f} {r['ingestion']:>8.1f} {r['unknown']:>5}  {r['member']}")

def main():
    parser = argparse.ArgumentParser(description="Report global curling source-coverage progress.")
    parser.add_argument("--registry", default=str(DATA / "country-registry.json"))
    parser.add_argument("--country")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    registry = load_registry(args.registry)
    countries = registry["countries"]
    if args.country:
        key = args.country.strip().lower()
        countries = [
            c for c in countries
            if c["world_code"].lower() == key or c["country_or_member"].lower() == key
        ]
        if not countries:
            raise SystemExit(f"No country/member found for {args.country!r}")

    rows = [row(c) for c in countries]
    rows.sort(key=lambda r: (r["discovery"], r["ingestion"], r["code"]))
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        print_table(rows)
        print()
        print(f"Tracked World Curling members: {registry['world_member_count']}")
        print("Overall percentages remain blank until each country's source applicability survey is complete.")

if __name__ == "__main__":
    main()
