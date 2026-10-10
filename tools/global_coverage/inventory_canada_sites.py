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

def inventory_one(row, max_pages, delay):
    code = "CAN-" + row["code"]
    seed = row.get("website") or ""
    if not seed:
        return {
            "code": code,
            "association": row["name"],
            "status": "site_not_listed",
            "seed_url": "",
        }
    try:
        raw_dir = ROOT / "data" / "raw" / "canada-associations" / row["code"].lower()
        result = crawl(seed, max_pages, delay, save_dir=raw_dir, source_id=f"canada-{row['code'].lower()}")
        payload = {
            "schema_version": 1,
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "country_code": code,
            "association": row["name"],
            "scope": row.get("scope", ""),
            "seed_url": seed,
            **result,
        }
        payload["pages_fetched"] = sum(
            1 for page in payload["pages"]
            if isinstance(page.get("status"), int)
        )
        payload["pages_blocked"] = sum(
            1 for page in payload["pages"]
            if page.get("status") == "robots_disallowed"
        )
        payload["pages_failed"] = sum(
            1 for page in payload["pages"]
            if page.get("status") in {"error", "robots_unavailable"}
        )
        payload["family_candidates"] = sorted({
            family
            for page in payload["pages"]
            for family in page.get("source_families", [])
        })
        outdir = DATA / "inventories" / "canada"
        outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / f"{row['code'].lower()}-{safe_host(seed)}.json"
        out.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return {
            "code": code,
            "association": row["name"],
            "seed_url": seed,
            "status": "blocked" if (not result.get("robots_loaded", True)
                or (payload["pages_fetched"] == 0 and (payload["pages_blocked"] or any("block" in str(page.get("error", "")).lower() for page in payload["pages"])))) else "inventoried",
            "pages_fetched": payload["pages_fetched"],
            "pages_blocked": payload["pages_blocked"],
            "pages_failed": payload["pages_failed"],
            "families": payload["family_candidates"],
            "output": str(out.relative_to(ROOT)),
        }
    except Exception as exc:
        return {
            "code": code,
            "association": row["name"],
            "seed_url": seed,
            "status": "failed",
            "error": str(exc),
        }
def main():
    parser = argparse.ArgumentParser(
        description="Inventory Canadian member-association sites."
    )
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--delay", type=float, default=0.12)
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()

    registry = json.loads(
        (DATA / "canada-member-associations.json").read_text(
            encoding="utf-8"
        )
    )
    rows = registry["member_associations"]
    results = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max(1, args.workers)
    ) as pool:
        futures = {
            pool.submit(
                inventory_one,
                row,
                args.max_pages,
                args.delay,
            ): row
            for row in rows
        }
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            print(
                f"{result['code']}: {result['status']} "
                f"pages={result.get('pages_fetched', 0)}",
                flush=True,
            )

    results.sort(key=lambda item: item["code"])
    summary = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "association_count": len(results),
        "inventoried": sum(
            1 for row in results if row["status"] == "inventoried"
        ),
        "site_not_listed": sum(
            1 for row in results if row["status"] == "site_not_listed"
        ),
        "failed": sum(
            1 for row in results if row["status"] == "failed"
        ),
        "blocked": sum(
            1 for row in results if row["status"] == "blocked"
        ),
        "results": results,
    }
    out = DATA / "canada-site-inventory-summary.json"
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
