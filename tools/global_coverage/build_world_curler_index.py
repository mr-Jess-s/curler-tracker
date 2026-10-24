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
            if key not in known_facts:
                current["championships"].append(fact)
                known_facts.add(key)

    for person in people.values():
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
            "retained_previous_people": retained_people,
            "history_complete": False,
            "limitations": [
                "World Curling documents known missing historical results and lineups and says recovery is ongoing.",
                "This index contains championship appearance summaries from the saved association pages, not every game or complete playing statistics.",
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
