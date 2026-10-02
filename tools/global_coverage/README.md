# Global Curling Coverage System

This directory is the deterministic discovery and ingestion foundation for Curler Tracker's worldwide data program.

## Goal
Account for every authoritative or materially useful curling source for every World Curling member, then ingest everything that can be lawfully and reliably collected.

"Complete" means the source universe is accounted for. It does **not** mean every historical curling fact still exists.

## Three progress measures
- **Discovery %**: verified applicable source families / applicable source families.
- **Ingestion %**: ingested verified machine-accessible sources / verified machine-accessible sources.
- **Archive knowledge %**: classified known archive collections / discovered archive collections.

An overall country percentage is withheld while any source-family applicability remains unknown.

## Universal source families
The canonical list is `data/global/source-taxonomy.json`. It covers governing bodies, results, clubs/facilities, rankings, calendars, athlete/team profiles, regional governance, digital archives, external archives, and physical-only collections.

## Country-specific completeness
Each country/member must have a documented source inventory. Country-specific sources are added to its denominator as they are discovered. This prevents a small federation and a large federation from being measured against a fictional identical document count.

A source can be:
- unknown
- discovered
- verified

An ingest can be:
- not_started
- ingested
- inaccessible
- prohibited
- failed

Inaccessible/prohibited material remains in the denominator and is explicitly accounted for rather than silently omitted.

## Current tools
- `build_country_registry.py` — rebuilds the World Curling member universe from the official member-association page.
- `inventory_site.py` — same-domain, robots-aware deterministic site inventory with hashes and source-family candidates.
- `report_coverage.py` — country-by-country progress report.

No AI is required to run these tools.

## Acquisition order
1. Rebuild the current World Curling member registry.
2. Verify each member's national governing source.
3. Inventory national sites and official results systems.
4. Determine country-specific regional/club structure and expand the denominator.
5. Inventory/download permitted structured data, HTML, PDFs and files.
6. Record blocked, missing or physical-only sources explicitly.
7. For Canada, continue until every member association and known facility/club is accounted for, then produce a ranked fieldwork list for unresolved physical archive gaps.

## Safety and provenance
Respect robots.txt, source terms, rate limits and access controls. Never bypass restrictions. Keep source URL, retrieval time, content hash and source-native identity. Missing evidence stays unknown.
