#!/usr/bin/env python3
import argparse
import concurrent.futures
import datetime as dt
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / "data" / "global"
sys.path.insert(0, str(HERE))
from inventory_site import crawl

def safe_host(url):
    host = urlsplit(url).netloc.replace(":", "_")
    return host.removeprefix("www.") or "unknown"

def inventory_one(country, max_pages, delay):
    code = country["world_code"]
    seed = country.get("association_website") or ""
    if not seed:
        return {
            "code": code,
            "country": country["country_or_member"],
            "association": country["association_name"],
            "seed_url": "",
            "status": "site_not_listed",
        }
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        raw_dir = ROOT / "data" / "raw" / "world-member-sites" / code.lower()
        result = crawl(seed, max_pages, delay, save_dir=raw_dir)
        payload = {
            "schema_version": 1,
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "country_code": code,
            "country": country["country_or_member"],
            "association": country["association_name"],
            "seed_url": seed,
            "source": country["world_member_url"],
            "max_pages": max_pages,
            **result,
        }
        payload["pages_fetched"] = sum(
            1 for p in payload["pages"] if isinstance(p.get("status"), int)
        )
        payload["pages_blocked"] = sum(
            1 for p in payload["pages"] if p.get("status") == "robots_disallowed"
        )
        payload["pages_failed"] = sum(
            1 for p in payload["pages"] if p.get("status") == "error"
        )
        payload["family_candidates"] = sorted({
            family
            for page in payload["pages"]
            for family in page.get("source_families", [])
        })
        outdir = DATA / "inventories" / "world-members"
        outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / f"{code.lower()}-{safe_host(seed)}.json"
        out.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return {
            "code": code,
            "country": country["country_or_member"],
            "association": country["association_name"],
            "seed_url": seed,
            "status": "inventoried",
            "pages_fetched": payload["pages_fetched"],
            "pages_blocked": payload["pages_blocked"],
            "pages_failed": payload["pages_failed"],
            "families": payload["family_candidates"],
            "started_at": started,
            "output": str(out.relative_to(ROOT)),
        }
    except Exception as exc:
        return {
            "code": code,
            "country": country["country_or_member"],
            "association": country["association_name"],
            "seed_url": seed,
            "status": "failed",
            "error": str(exc),
            "started_at": started,
        }
def main():
    parser = argparse.ArgumentParser(
        description="Inventory official sites for all World Curling members."
    )
    parser.add_argument("--max-pages", type=int, default=25)
    parser.add_argument("--delay", type=float, default=0.15)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--codes")
    args = parser.parse_args()

    registry = json.loads(
        (DATA / "country-registry.json").read_text(encoding="utf-8")
    )
    countries = registry["countries"]
    if args.codes:
        wanted = {
            value.strip().upper()
            for value in args.codes.split(",")
            if value.strip()
        }
        countries = [
            country
            for country in countries
            if country["world_code"] in wanted
        ]

    results = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max(1, args.workers)
    ) as pool:
        futures = {
            pool.submit(
                inventory_one,
                country,
                args.max_pages,
                args.delay,
            ): country
            for country in countries
        }
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            fetched = result.get("pages_fetched", 0)
            print(
                f"{result['code']}: {result['status']} pages={fetched}",
                flush=True,
            )

    results.sort(key=lambda item: item["code"])
    summary = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "member_count": len(results),
        "inventoried": sum(
            1 for row in results if row["status"] == "inventoried"
        ),
        "site_not_listed": sum(
            1 for row in results if row["status"] == "site_not_listed"
        ),
        "failed": sum(
            1 for row in results if row["status"] == "failed"
        ),
        "results": results,
    }
    out = DATA / "world-site-inventory-summary.json"
    out.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        "SUMMARY "
        f"inventoried={summary['inventoried']} "
        f"site_not_listed={summary['site_not_listed']} "
        f"failed={summary['failed']}"
    )
    print(f"Wrote {out}")

if __name__ == "__main__":
    main()
