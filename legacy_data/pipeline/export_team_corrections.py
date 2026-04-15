#!/usr/bin/env python3
"""
export_team_corrections.py

Exports approved team correction candidates from the DB into
inputs/team_corrections.csv format.

Usage (from legacy_data/):
    .venv/bin/python pipeline/export_team_corrections.py
    .venv/bin/python pipeline/export_team_corrections.py --dry-run

Reads:
    database/footbag.db (net_team_correction_candidate table)
    inputs/team_corrections.csv (existing corrections for dedup)

Writes:
    inputs/team_corrections.csv (appended rows, sorted)
"""

from __future__ import annotations

import argparse
import csv
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT.parent / "database" / "footbag.db"
CORRECTIONS_CSV = ROOT / "inputs" / "team_corrections.csv"

FIELDNAMES = [
    "event_key", "discipline_key", "placement", "original_display",
    "corrected_player_a", "corrected_player_b", "correction_type",
    "source_note", "active", "verification_level", "verified_by", "confidence",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Export approved team corrections")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    approved = conn.execute("""
        SELECT event_key, discipline_key, placement, original_display,
               suggested_player_a, suggested_player_b, anomaly_type, decision_notes
        FROM net_team_correction_candidate
        WHERE decision = 'approve'
          AND suggested_player_a IS NOT NULL AND suggested_player_a != ''
          AND suggested_player_b IS NOT NULL AND suggested_player_b != ''
        ORDER BY event_key, discipline_key, CAST(placement AS INTEGER)
    """).fetchall()
    conn.close()

    if not approved:
        print("No approved corrections to export.")
        return

    # Load existing corrections for dedup
    existing: set[tuple[str, str, str]] = set()
    existing_rows: list[dict] = []
    if CORRECTIONS_CSV.exists():
        with open(CORRECTIONS_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing_rows.append(row)
                existing.add((row["event_key"], row["discipline_key"], row["placement"]))

    new_rows: list[dict] = []
    skipped = 0
    for r in approved:
        key = (r["event_key"], r["discipline_key"], r["placement"])
        if key in existing:
            skipped += 1
            continue

        new_rows.append({
            "event_key":         r["event_key"],
            "discipline_key":    r["discipline_key"],
            "placement":         r["placement"],
            "original_display":  r["original_display"],
            "corrected_player_a": r["suggested_player_a"],
            "corrected_player_b": r["suggested_player_b"],
            "correction_type":   r["anomaly_type"],
            "source_note":       r["decision_notes"] or "Approved via triage dashboard",
            "active":            "1",
            "verification_level": "operator_reviewed",
            "verified_by":       "operator",
            "confidence":        "HIGH",
        })

    print(f"Approved corrections:   {len(approved)}")
    print(f"Already in CSV:         {skipped}")
    print(f"New corrections:        {len(new_rows)}")

    if not new_rows:
        print("Nothing new to write.")
        return

    if args.dry_run:
        print(f"\n--- DRY RUN: would append {len(new_rows)} rows ---")
        for row in new_rows:
            print(f"  {row['event_key']} | P{row['placement']} | "
                  f"{row['corrected_player_a']} / {row['corrected_player_b']}")
        return

    all_rows = existing_rows + new_rows
    all_rows.sort(key=lambda r: (r["event_key"], r["discipline_key"], r["placement"]))

    with open(CORRECTIONS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Written to {CORRECTIONS_CSV}")
    print(f"Total corrections now: {len(all_rows)}")


if __name__ == "__main__":
    main()
