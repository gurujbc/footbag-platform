#!/usr/bin/env python3
"""
export_approved_aliases.py

Exports approved recovery alias candidates into person_aliases.csv format.

Usage (from legacy_data/):
    .venv/bin/python pipeline/export_approved_aliases.py
    .venv/bin/python pipeline/export_approved_aliases.py --dry-run
    .venv/bin/python pipeline/export_approved_aliases.py --output overrides/person_aliases.csv

Reads:
    database/footbag.db  (net_recovery_alias_candidate table)
    overrides/person_aliases.csv (existing aliases, for dedup)

Writes:
    overrides/person_aliases.csv (appended rows, sorted)
    OR stdout in --dry-run mode
"""

from __future__ import annotations

import argparse
import csv
import re
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # legacy_data/
DB_PATH = ROOT.parent / "database" / "footbag.db"
ALIASES_CSV = ROOT / "overrides" / "person_aliases.csv"

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def _norm_name(s: str) -> str:
    s = s.replace("\ufffd", "").replace("\u00ad", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Export approved recovery aliases")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be written without modifying files")
    parser.add_argument("--output", type=str, default=None,
                        help="Output path (default: overrides/person_aliases.csv)")
    args = parser.parse_args()

    output_path = Path(args.output) if args.output else ALIASES_CSV

    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found")
        sys.exit(1)

    # Read approved candidates from DB
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    approved = conn.execute("""
        SELECT stub_name, suggested_person_id, suggested_person_name,
               suggestion_type, operator_notes
        FROM net_recovery_alias_candidate
        WHERE operator_decision = 'approve'
        ORDER BY stub_name ASC
    """).fetchall()
    conn.close()

    if not approved:
        print("No approved candidates to export.")
        return

    # Load existing aliases for dedup
    existing_aliases: set[str] = set()
    existing_rows: list[dict] = []
    fieldnames = ["alias", "person_id", "person_canon", "status", "notes"]

    if output_path.exists():
        with open(output_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing_rows.append(row)
                existing_aliases.add(_norm_name(row.get("alias", "")))

    # Build new rows
    new_rows: list[dict] = []
    skipped_dup = 0
    for r in approved:
        normed = _norm_name(r["stub_name"])
        if normed in existing_aliases:
            skipped_dup += 1
            continue

        note_parts = [f"recovery:{r['suggestion_type']}"]
        if r["operator_notes"]:
            note_parts.append(r["operator_notes"])

        new_rows.append({
            "alias":       r["stub_name"],
            "person_id":   r["suggested_person_id"],
            "person_canon": r["suggested_person_name"],
            "status":      "verified",
            "notes":       "; ".join(note_parts),
        })
        existing_aliases.add(normed)

    # Summary
    print(f"Approved candidates:    {len(approved)}")
    print(f"Already in aliases:     {skipped_dup}")
    print(f"New alias rows:         {len(new_rows)}")

    if not new_rows:
        print("Nothing new to write.")
        return

    if args.dry_run:
        print(f"\n--- DRY RUN: would append {len(new_rows)} rows ---")
        for row in new_rows:
            print(f"  {row['alias']} → {row['person_canon']} ({row['person_id'][:16]}...)")
        return

    # Write: existing + new, sorted
    all_rows = existing_rows + new_rows
    all_rows.sort(key=lambda r: _norm_name(r.get("alias", "")))

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Written to {output_path}")
    print(f"Total aliases now: {len(all_rows)}")


if __name__ == "__main__":
    main()
