#!/usr/bin/env python3
"""
11_load_consecutive_records_to_sqlite.py

Loads consecutive kicks records from the curated CSV into the SQLite database.

Source: legacy_data/inputs/curated/records/consecutives_records.csv
Target table: consecutive_kicks_records

Usage (from legacy_data/):
    python event_results/scripts/11_load_consecutive_records_to_sqlite.py \
        --db ~/projects/footbag-platform/database/footbag.db

Or via run_pipeline.sh which resolves --db automatically.
"""

import argparse
import csv
import os
import sqlite3
import sys

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
LEGACY_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
SOURCE_CSV  = os.path.join(LEGACY_ROOT, 'inputs', 'curated', 'records', 'consecutives_records.csv')

def load_records(db_path: str) -> None:
    if not os.path.exists(SOURCE_CSV):
        print(f"ERROR: source CSV not found: {SOURCE_CSV}", file=sys.stderr)
        sys.exit(1)

    with open(SOURCE_CSV, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Source rows read: {len(rows)}")

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")

    # Wipe and reload (idempotent)
    con.execute("DELETE FROM consecutive_kicks_records")

    inserted = 0
    for row in rows:
        sort_order = int(row['sort_order']) if row['sort_order'].strip() else None
        if sort_order is None:
            print(f"  SKIP: missing sort_order on row {row}", file=sys.stderr)
            continue

        score_raw = row['score'].strip()
        score = int(score_raw) if score_raw else None

        rank_raw = row['rank'].strip()
        rank = int(rank_raw) if rank_raw else None

        year_raw = row['year'].strip()
        year = year_raw if year_raw else None

        con.execute("""
            INSERT OR REPLACE INTO consecutive_kicks_records
              (sort_order, section, subsection, division, year, rank,
               player_1, player_2, score, note, event_date, event_name, location)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sort_order,
            row['section'].strip(),
            row['subsection'].strip(),
            row['division'].strip(),
            year,
            rank,
            row['person_or_team'].strip() or None,
            row['partner'].strip() or None,
            score,
            row['note'].strip() or None,
            row['event_date'].strip() or None,
            row['event_name'].strip() or None,
            row['location'].strip() or None,
        ))
        inserted += 1

    con.commit()
    con.close()

    print(f"Rows inserted: {inserted}")
    print(f"Database: {db_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description='Load consecutive kicks records into SQLite.')
    parser.add_argument('--db', required=True, help='Path to footbag.db')
    args = parser.parse_args()

    db_path = os.path.expanduser(args.db)
    if not os.path.exists(db_path):
        print(f"ERROR: database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    load_records(db_path)


if __name__ == '__main__':
    main()
