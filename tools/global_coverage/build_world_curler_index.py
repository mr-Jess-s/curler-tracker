#!/usr/bin/env python3
"""Normalize saved World Curling association result pages into a sourced index."""
import datetime as dt
import gzip
import hashlib
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path

from atomic_state import atomic_json

ROOT = Path(os.environ.get("CURLER_TRACKER_ROOT", Path(__file__).resolve().parents[2]))
ARCHIVE_ROOT = Path(os.environ.get("CURLER_TRACKER_ARCHIVE_ROOT", ROOT))
ARCHIVE_DATA = ARCHIVE_ROOT / "data" / "global"
RAW = ARCHIVE_ROOT / "data" / "raw" / "worldcurling-results" / "association"
DOWNLOAD_MANIFEST = ARCHIVE_DATA / "world-results-download-manifest.json"
SNAPSHOT_MANIFEST = ARCHIVE_DATA / "acquisition-manifests" / "worldcurling-results.json"
OUTPUT = ROOT / "data" / "world-curler-index.json"
CHAMPIONSHIP_RAW = ARCHIVE_DATA.parent / "raw" / "worldcurling-results" / "championship"
CHAMPIONSHIP_DOWNLOAD_MANIFEST = ARCHIVE_DATA / "world-championship-details-manifest.json"
BASE = "https://results.worldcurling.org"
RECORD_TYPES = [
    "Appearances", "IndividualChampionships", "IndividualFinals",
    "IndividualMedals", "IndividualGames", "IndividualWins",
]


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def text(self):
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


def clean(fragment):
    parser = _Text()
    parser.feed(fragment or "")
    return parser.text()


def table_headers(page):
    header = re.search(r"<thead\b[^>]*>(.*?)</thead>", page, re.I | re.S)
    if not header:
        return []
    return [clean(cell) for cell in re.findall(r"<th\b[^>]*>(.*?)</th>", header.group(1), re.I | re.S)]


def parse_record_page(page, association, record_type, source_url, snapshot):
    headers = table_headers(page)
    rows = []
    body = re.search(r"<tbody\b[^>]*>(.*?)</tbody>", page, re.I | re.S)
    if not body:
        return rows
    for row_html in re.findall(r"<tr\b[^>]*>(.*?)</tr>", body.group(1), re.I | re.S):
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row_html, re.I | re.S)
        if not cells:
            continue
        person = re.search(r'href="/Person/Details/(\d+)"[^>]*>(.*?)</a>', cells[0], re.I | re.S)
        if not person:
            continue
        person_id = person.group(1)
        published_name = clean(person.group(2))
        if not published_name:
            continue
        flag = re.search(r"wcf-flags/([A-Z0-9]+)\.png", row_html, re.I)
        flag_alt = re.search(r'<img\b[^>]*alt="([^"]+)"', cells[0], re.I | re.S)
        metrics = {}
        for index, value in enumerate(cells[1:-1], start=1):
            key = headers[index] if index < len(headers) else f"column_{index + 1}"
            if key:
                metrics[key] = clean(value)

        tournament_cell = cells[-1]
        event_rows = []
        category_matches = list(re.finditer(r"<b\b[^>]*>(.*?)</b>", tournament_cell, re.I | re.S))
        for event in re.finditer(r'href="/Championship/Details/(\d+)"[^>]*>(.*?)</a>', tournament_cell, re.I | re.S):
            preceding = [match for match in category_matches if match.start() < event.start()]
            category = clean(preceding[-1].group(1)) if preceding else ""
            event_rows.append({
                "championship_id": event.group(1),
                "championship_type": category,
                "source_label": clean(event.group(2)),
                "source_url": f"{BASE}/Championship/Details/{event.group(1)}",
            })
        rows.append({
            "world_person_id": person_id,
            "published_name": published_name,
            "association_id": str(association.get("association_id", "")),
            "association_names": association.get("labels") or [],
            "flag_code": flag.group(1).upper() if flag else "",
            "flag_label": clean(flag_alt.group(1)) if flag_alt else "",
            "record_type": record_type,
            "metrics": metrics,
            "championships": event_rows,
            "person_url": f"{BASE}/Person/Details/{person_id}",
            "source_page": source_url,
            "source_sha256": snapshot.get("sha256") or "",
            "source_retrieved_at": snapshot.get("retrieved_at") or snapshot.get("not_modified_at") or "",
        })
    return rows


def parse_championship_page(page, championship_id):
    """Extract the dated finish and team record for athletes on an official event page."""
    headings = [clean(value) for value in re.findall(r"<h[1-3]\b[^>]*>(.*?)</h[1-3]>", page, re.I | re.S)]
    title = next((value for value in headings if re.search(r"\b(?:19|20)\d{2}\b", value)), headings[0] if headings else "")
    dates = re.search(r"(\d{1,2}/\d{1,2}/\d{4})\s*-\s*(\d{1,2}/\d{1,2}/\d{4})", page)
    starts_on = ends_on = ""
    if dates:
        try:
            starts_on = dt.datetime.strptime(dates.group(1), "%m/%d/%Y").date().isoformat()
            ends_on = dt.datetime.strptime(dates.group(2), "%m/%d/%Y").date().isoformat()
        except ValueError:
            pass

    participants = {}
    for table in re.findall(r"<table\b[^>]*>(.*?)</table>", page, re.I | re.S):
        headers = table_headers(table)
        position_index = next((i for i, value in enumerate(headers) if value.casefold() == "position"), None)
        record_index = next((i for i, value in enumerate(headers) if value.casefold() == "record"), None)
        if position_index is None and record_index is None:
            continue
        body = re.search(r"<tbody\b[^>]*>(.*?)</tbody>", table, re.I | re.S)
        if not body:
            continue
        for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", body.group(1), re.I | re.S):
            cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.I | re.S)
            person_ids = [match.group(1) for match in re.finditer(r"href=['\"]/?Person/Details/(\d+)['\"]", row, re.I)]
            if not cells or not person_ids:
                continue
            position = clean(cells[position_index]) if position_index is not None and position_index < len(cells) else ""
            record = clean(cells[record_index]) if record_index is not None and record_index < len(cells) else ""
            association_ids = [match.group(1) for match in re.finditer(r"href=['\"]/?Association/Details/(\d+)['\"]", row, re.I)]
            association_names = [clean(match.group(1)) for match in re.finditer(
                r"<a\b[^>]*href=['\"]/?Association/Details/\d+['\"][^>]*>(.*?)</a>", row, re.I | re.S)]
            result = {"position": position, "record": record,
                      "association_id": association_ids[0] if association_ids else "",
                      "team": association_names[0] if association_names else ""}
            for person_id in person_ids:
                participants[person_id] = result
    return {"championship_id": str(championship_id), "title": title,
            "starts_on": starts_on, "ends_on": ends_on, "participants": participants}


def load_championship_details():
    details = {}
    manifest = {}
    if CHAMPIONSHIP_DOWNLOAD_MANIFEST.exists():
        try:
            manifest = json.loads(CHAMPIONSHIP_DOWNLOAD_MANIFEST.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            manifest = {}
    pages = manifest.get("pages") or {}
    for path in CHAMPIONSHIP_RAW.glob("*.html.gz"):
        championship_id = path.name.removesuffix(".html.gz")
        try:
            with gzip.open(path, "rb") as handle:
                page = handle.read().decode("utf-8", errors="replace")
            parsed = parse_championship_page(page, championship_id)
            if not parsed["participants"]:
                continue
            parsed["retrieved_at"] = (pages.get(championship_id) or {}).get("retrieved_at", "")
            parsed["sha256"] = (pages.get(championship_id) or {}).get("sha256", "")
            details[championship_id] = parsed
        except (OSError, EOFError):
            continue
    return details


def load_snapshot_metadata():
    if not SNAPSHOT_MANIFEST.exists():
        return {}
    try:
        manifest = json.loads(SNAPSHOT_MANIFEST.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return {}
    return manifest.get("pages") or {}


def _read_snapshot(path):
    with gzip.open(path, "rb") as handle:
        body = handle.read()
    return body.decode("utf-8", errors="replace"), hashlib.sha256(body).hexdigest()


def build_index():
    download_manifest = json.loads(DOWNLOAD_MANIFEST.read_text(encoding="utf-8-sig"))
    associations = download_manifest.get("associations") or []
    snapshot_pages = load_snapshot_metadata()
    people = {}
    coverage = []
    errors = []
    page_count = 0
    parsed_rows = 0
    event_facts = 0

    for association in associations:
        aid = str(association.get("association_id", ""))
        record = {"association_id": aid, "labels": association.get("labels") or []}
        association_pages = 0
        association_rows = 0
        missing = []
        for record_type in RECORD_TYPES:
            path = RAW / aid / f"{record_type}.html.gz"
            url = f"{BASE}/Record/{record_type}/0?associationId={aid}"
            if not path.exists():
                missing.append(record_type)
                continue
            try:
                page, digest = _read_snapshot(path)
                snapshot = snapshot_pages.get(url, {})
                if not snapshot.get("sha256"):
                    snapshot = {**snapshot, "sha256": digest}
                rows = parse_record_page(page, record, record_type, url, snapshot)
            except Exception as exc:
                errors.append({"association_id": aid, "record_type": record_type, "error": str(exc)})
                continue
            page_count += 1
            association_pages += 1
            association_rows += len(rows)
            parsed_rows += len(rows)
            for row in rows:
                person = people.setdefault(row["world_person_id"], {
                    "world_person_id": row["world_person_id"],
                    "person_url": row["person_url"],
                    "published_names": [],
                    "associations": [],
                    "flag_codes": [],
                    "record_summaries": {},
                    "championships": [],
                    "source_pages": [],
                })
                name = {"name": row["published_name"], "association_id": aid,
                        "source_page": url, "source_sha256": row["source_sha256"]}
                if name not in person["published_names"]:
                    person["published_names"].append(name)
                for label in row["association_names"]:
                    if label not in person["associations"]:
                        person["associations"].append(label)
                if row["flag_code"] and row["flag_code"] not in person["flag_codes"]:
                    person["flag_codes"].append(row["flag_code"])
                person["record_summaries"].setdefault(row["record_type"], []).append({
                    "association_id": aid,
                    "metrics": row["metrics"],
                    "source_page": url,
                    "source_sha256": row["source_sha256"],
                    "source_retrieved_at": row["source_retrieved_at"],
                })
                if url not in person["source_pages"]:
                    person["source_pages"].append(url)
                for championship in row["championships"]:
                    fact = {
                        **championship,
                        "association_id": aid,
                        "association_names": row["association_names"],
                        "record_type": row["record_type"],
                        "source_page": url,
                        "source_sha256": row["source_sha256"],
                    }
                    key = (fact["championship_id"], fact["championship_type"], fact["source_label"], aid)
                    if not any((old["championship_id"], old["championship_type"], old["source_label"], old["association_id"]) == key
                               for old in person["championships"]):
                        person["championships"].append(fact)
                        event_facts += 1
        coverage.append({
            "association_id": aid,
            "labels": association.get("labels") or [],
            "pages_expected": len(RECORD_TYPES),
            "pages_available": association_pages,
            "parsed_rows": association_rows,
            "missing_pages": missing,
            "state": "complete" if not missing and association_pages == len(RECORD_TYPES) else "partial",
        })

    previous_people = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8-sig"))
            previous_people = previous.get("people") or {}
        except (OSError, json.JSONDecodeError):
            previous_people = {}
    retained_people = 0
    for person_id, old in previous_people.items():
        if person_id not in people:
            people[person_id] = old
            retained_people += 1
            continue
        current = people[person_id]
        for field in ("published_names", "associations", "flag_codes", "source_pages"):
            for item in old.get(field) or []:
                if item not in current[field]:
                    current[field].append(item)
        for record_type, summaries in (old.get("record_summaries") or {}).items():
            known = current["record_summaries"].setdefault(record_type, [])
            for summary in summaries:
                if summary not in known:
                    known.append(summary)
        known_facts = {(row.get("championship_id"), row.get("championship_type"), row.get("source_label"), row.get("association_id"))
                       for row in current["championships"]}
        for fact in old.get("championships") or []:
            key = (fact.get("championship_id"), fact.get("championship_type"), fact.get("source_label"), fact.get("association_id"))
            existing = next((row for row in current["championships"]
                             if (row.get("championship_id"), row.get("championship_type"), row.get("source_label"), row.get("association_id")) == key), None)
            if existing:
                for field in ("event_title", "starts_on", "ends_on", "individual_result", "details_retrieved_at", "details_sha256"):
                    if not existing.get(field) and fact.get(field):
                        existing[field] = fact[field]
            else:
                current["championships"].append(fact)
                known_facts.add(key)

    championship_details = load_championship_details()
    enriched_facts = 0
    for person in people.values():
        for fact in person["championships"]:
            detail = championship_details.get(str(fact.get("championship_id", "")))
            if not detail:
                continue
            if detail.get("title"):
                fact["event_title"] = detail["title"]
            for field in ("starts_on", "ends_on"):
                if detail.get(field):
                    fact[field] = detail[field]
            result = detail.get("participants", {}).get(str(person.get("world_person_id", "")))
            if result:
                fact["individual_result"] = result
                fact["details_retrieved_at"] = detail.get("retrieved_at", "")
                fact["details_sha256"] = detail.get("sha256", "")
                enriched_facts += 1
        person["published_names"].sort(key=lambda row: (row.get("name", "").casefold(), row.get("association_id", "")))
        person["associations"].sort(key=str.casefold)
        person["flag_codes"].sort()
        person["championships"].sort(key=lambda row: (row.get("source_label", ""), row.get("championship_id", "")))
        person["source_pages"].sort()

    payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_provider": "World Curling",
        "source_url": BASE,
        "coverage": {
            "association_count": len(associations),
            "association_pages": coverage,
            "pages_expected": len(associations) * len(RECORD_TYPES),
            "pages_parsed": page_count,
            "people_indexed": len(people),
            "source_rows_parsed": parsed_rows,
            "championship_facts_indexed": event_facts,
            "championship_detail_pages_parsed": len(championship_details),
            "championship_facts_with_individual_results": enriched_facts,
            "retained_previous_people": retained_people,
            "history_complete": False,
            "limitations": [
                "World Curling documents known missing historical results and lineups and says recovery is ongoing.",
                "Individual finishes and event dates are included where saved championship detail pages support them; this is not a complete game-by-game record.",
            ],
        },
        "people": people,
        "errors": errors,
    }
    atomic_json(OUTPUT, payload)
    return payload


def main():
    payload = build_index()
    coverage = payload["coverage"]
    print(
        f"World Curling index: people={coverage['people_indexed']} "
        f"championship facts={coverage['championship_facts_indexed']} "
        f"pages={coverage['pages_parsed']}/{coverage['pages_expected']} errors={len(payload['errors'])}",
        flush=True,
    )


if __name__ == "__main__":
    main()
