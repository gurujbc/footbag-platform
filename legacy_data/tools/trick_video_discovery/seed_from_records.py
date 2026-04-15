#!/usr/bin/env python3
"""
seed_from_records.py

Extracts existing video URLs from freestyle_records and maps them to
canonical trick names. This seeds the video_coverage.csv with known data.

Usage (from legacy_data/):
    .venv/bin/python tools/trick_video_discovery/seed_from_records.py
"""

import csv
import json
import re
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent.parent
DB_PATH = REPO_ROOT / "database" / "footbag.db"

COVERAGE_CSV = ROOT / "video_coverage.csv"
SEARCH_TERMS_CSV = ROOT / "trick_search_terms.csv"


def classify_source(url: str) -> tuple[str, str]:
    """Return (source_type, source_name) from a URL."""
    if not url:
        return ("", "")
    lower = url.lower()
    if "youtube.com" in lower or "youtu.be" in lower:
        return ("youtube", "")
    if "vimeo.com" in lower:
        return ("vimeo", "")
    if "instagram.com" in lower:
        return ("instagram", "")
    if "facebook.com" in lower:
        return ("facebook", "")
    if "footbag.org" in lower:
        return ("website", "footbag.org")
    return ("other", "")


def extract_timestamp(url: str) -> str:
    """Extract timecode from URL if present."""
    m = re.search(r'[?&]t=(\d+)', url)
    if m:
        secs = int(m.group(1))
        mins = secs // 60
        secs = secs % 60
        return f"{mins}:{secs:02d}"
    return ""


def main() -> None:
    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Load canonical tricks with aliases
    tricks = conn.execute("""
        SELECT slug, canonical_name, aliases_json, trick_family, adds, category
        FROM freestyle_tricks
        ORDER BY sort_order
    """).fetchall()

    # Build search terms CSV
    search_rows = []
    trick_name_to_slug = {}
    for t in tricks:
        name = t["canonical_name"]
        slug = t["slug"]
        aliases = json.loads(t["aliases_json"] or "[]")
        trick_name_to_slug[name.lower()] = slug
        for a in aliases:
            trick_name_to_slug[a.lower()] = slug

        search_rows.append({
            "canonical_name": name,
            "slug": slug,
            "aliases": "; ".join(aliases) if aliases else "",
            "adds": t["adds"] or "",
            "category": t["category"] or "",
            "trick_family": t["trick_family"] or "",
        })

    with open(SEARCH_TERMS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "canonical_name", "slug", "aliases", "adds", "category", "trick_family",
        ])
        writer.writeheader()
        writer.writerows(search_rows)
    print(f"Search terms: {len(search_rows)} tricks → {SEARCH_TERMS_CSV.name}")

    # Load freestyle records with video URLs
    records = conn.execute("""
        SELECT fr.trick_name, fr.video_url, fr.video_timecode,
               COALESCE(hp.person_name, fr.display_name) AS holder_name,
               fr.confidence
        FROM freestyle_records fr
        LEFT JOIN historical_persons hp ON hp.person_id = fr.person_id
        WHERE fr.video_url IS NOT NULL AND fr.video_url != ''
          AND fr.confidence IN ('verified', 'probable')
          AND fr.superseded_by IS NULL
        ORDER BY fr.trick_name
    """).fetchall()

    conn.close()

    # Map records to canonical tricks
    coverage_rows = []
    unmapped = []
    seen_urls = set()

    for r in records:
        trick_raw = r["trick_name"] or ""
        url = r["video_url"].strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        # Try to match to canonical trick
        slug = trick_name_to_slug.get(trick_raw.lower())
        canonical = ""
        matched_alias = trick_raw
        if slug:
            for t in tricks:
                if t["slug"] == slug:
                    canonical = t["canonical_name"]
                    break

        source_type, source_name = classify_source(url)
        timestamp = r["video_timecode"] or extract_timestamp(url)

        coverage_rows.append({
            "canonical_trick_name": canonical,
            "trick_slug": slug or "",
            "matched_alias": matched_alias,
            "video_exists": "YES",
            "confidence": "HIGH",
            "source_type": source_type,
            "source_name": source_name,
            "page_or_channel": "",
            "title": f"Passback record by {r['holder_name']}" if r["holder_name"] else "",
            "url": url,
            "timestamp": timestamp,
            "creator": r["holder_name"] or "",
            "clip_type": "passback",
            "license_notes": "",
            "notes": f"From freestyle_records ({r['confidence']})" if not canonical else "",
            "reviewed": "YES" if canonical else "NO",
        })

        if not canonical:
            unmapped.append(trick_raw)

    # Write coverage CSV
    fieldnames = [
        "canonical_trick_name", "trick_slug", "matched_alias", "video_exists",
        "confidence", "source_type", "source_name", "page_or_channel",
        "title", "url", "timestamp", "creator", "clip_type",
        "license_notes", "notes", "reviewed",
    ]
    with open(COVERAGE_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(coverage_rows)

    # Summary
    canonical_matched = sum(1 for r in coverage_rows if r["canonical_trick_name"])
    canonical_tricks_covered = len(set(r["trick_slug"] for r in coverage_rows if r["trick_slug"]))

    print(f"\nVideo coverage seeded from freestyle_records:")
    print(f"  Total video URLs:          {len(coverage_rows)}")
    print(f"  Mapped to canonical trick: {canonical_matched}")
    print(f"  Unmapped (compound/new):   {len(coverage_rows) - canonical_matched}")
    print(f"  Canonical tricks covered:  {canonical_tricks_covered} / {len(tricks)}")
    print(f"  Output: {COVERAGE_CSV.name}")

    if unmapped:
        unique_unmapped = sorted(set(unmapped))
        print(f"\n  Unmapped trick names ({len(unique_unmapped)} unique):")
        for name in unique_unmapped[:20]:
            print(f"    - {name}")
        if len(unique_unmapped) > 20:
            print(f"    ... and {len(unique_unmapped) - 20} more")


if __name__ == "__main__":
    main()
