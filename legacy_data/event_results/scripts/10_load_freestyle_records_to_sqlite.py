#!/usr/bin/env python3
"""
10_load_freestyle_records_to_sqlite.py

Loads freestyle passback records into the freestyle_records table.

Source:
  inputs/curated/records/records_master.csv

Each row is the current best performance for a specific trick (per-trick
consecutive record). All rows originate from the passback records pipeline.

Confidence mapping (CSV → DB):
  'medium' → 'probable'    (visible with disclaimer on /freestyle/records)
  'low'    → 'provisional' (not surfaced publicly)

Public filter (enforced in service layer, not here):
  confidence IN ('verified', 'probable')
  AND superseded_by IS NULL
  AND (person_id IS NOT NULL OR display_name IS NOT NULL)

Person ID resolution:
  Case-insensitive exact match on historical_persons.person_name.
  Falls back to display_name when no match found.

Usage:
  python event_results/scripts/10_load_freestyle_records_to_sqlite.py \\
    --db path/to/footbag.db \\
    --records-csv inputs/curated/records/records_master.csv
"""

from __future__ import annotations

import argparse
import csv
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RECORD_TYPE_MAP = {
    "consecutive_completions": "trick_consecutive",
    "consecutive_dex":         "trick_consecutive_dex",
    "consecutive_juggles":     "trick_consecutive_juggle",
}

CONFIDENCE_MAP = {
    "medium": "probable",
    "low":    "provisional",
    "high":   "verified",
}


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_date(raw: str) -> str | None:
    """Parse M/D/YYYY → ISO YYYY-MM-DD. Returns None on failure."""
    v = raw.strip()
    if not v:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_adds(raw: str) -> int | None:
    v = raw.strip()
    if not v or v.upper() == "N/A":
        return None
    try:
        return int(v)
    except ValueError:
        return None


def opt_str(val: str) -> str | None:
    v = val.strip()
    return v if v else None


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return [{k: (v or "") for k, v in row.items()} for row in csv.DictReader(f)]


# ---------------------------------------------------------------------------
# Person resolution
# ---------------------------------------------------------------------------

def build_name_index(conn: sqlite3.Connection) -> dict[str, str]:
    """
    Returns {lowercase_name: person_id} from historical_persons.
    All persons are indexed (CANONICAL, PROVISIONAL, and NULL-scope) so that
    freestyle records resolve against any known identity, regardless of
    whether they have competition results.
    """
    rows = conn.execute(
        "SELECT person_id, person_name FROM historical_persons"
    ).fetchall()
    return {name.strip().lower(): pid for pid, name in rows}


def resolve_person(display_name: str, name_index: dict[str, str]) -> str | None:
    return name_index.get(display_name.strip().lower())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load freestyle passback records into freestyle_records table"
    )
    parser.add_argument("--db",          required=True, help="Path to footbag.db")
    parser.add_argument("--records-csv", required=True, help="Path to records_master.csv")
    args = parser.parse_args()

    db_path     = Path(args.db)
    records_csv = Path(args.records_csv)

    for p in [db_path, records_csv]:
        if not p.exists():
            raise FileNotFoundError(f"Required file not found: {p}")

    rows = read_csv(records_csv)
    print(f"Records CSV rows: {len(rows)}")

    ts           = now_iso()
    system_user  = "system:freestyle_records_seed"

    inserted      = 0
    skipped_dup   = 0
    skipped_bad   = 0
    pid_resolved  = 0
    pid_unresolved = 0
    unknown_unit  = []
    unknown_conf  = []

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")

        name_index = build_name_index(conn)
        print(f"Persons in name index: {len(name_index):,}")

        for row in rows:
            record_id = row["record_id"].strip()
            if not record_id:
                skipped_bad += 1
                continue

            # record_type
            unit = row.get("unit", "").strip()
            record_type = RECORD_TYPE_MAP.get(unit)
            if not record_type:
                unknown_unit.append(unit)
                skipped_bad += 1
                continue

            # confidence
            raw_conf = row.get("confidence", "").strip().lower()
            confidence = CONFIDENCE_MAP.get(raw_conf)
            if not confidence:
                unknown_conf.append(raw_conf)
                skipped_bad += 1
                continue

            # player / person resolution
            display_name = row.get("player", "").strip()
            if not display_name:
                skipped_bad += 1
                continue

            person_id = resolve_person(display_name, name_index)
            if person_id:
                pid_resolved += 1
            else:
                pid_unresolved += 1

            # date
            achieved_date  = parse_date(row.get("date_normalized", ""))
            date_precision = "month" if row.get("approx_date", "").strip().lower() == "yes" else "day"

            # value
            raw_value = row.get("record_value", "").strip()
            try:
                value_numeric = float(raw_value)
            except ValueError:
                skipped_bad += 1
                continue

            # trick metadata
            trick_name = opt_str(row.get("trick_name", ""))
            sort_name  = opt_str(row.get("sort_name", ""))
            adds_count = parse_adds(row.get("adds", ""))

            # video
            video_url      = opt_str(row.get("video", ""))
            video_timecode = opt_str(row.get("time_clip", ""))
            notes          = opt_str(row.get("notes", ""))

            try:
                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO freestyle_records (
                      id, record_type,
                      person_id, display_name,
                      trick_name, sort_name, adds_count,
                      value_numeric, achieved_date, date_precision,
                      source, confidence,
                      video_url, video_timecode, notes,
                      superseded_by,
                      created_at, updated_at
                    ) VALUES (
                      ?, ?,
                      ?, ?,
                      ?, ?, ?,
                      ?, ?, ?,
                      ?, ?,
                      ?, ?, ?,
                      NULL,
                      ?, ?
                    )
                    """,
                    (
                        record_id, record_type,
                        person_id, display_name,
                        trick_name, sort_name, adds_count,
                        value_numeric, achieved_date, date_precision,
                        "passback", confidence,
                        video_url, video_timecode, notes,
                        ts, ts,
                    ),
                )
                if cur.rowcount == 0:
                    skipped_dup += 1
                else:
                    inserted += 1
            except sqlite3.IntegrityError as e:
                print(f"  WARN: {record_id!r} skipped — {e}")
                skipped_bad += 1

        conn.commit()

    # ---------------------------------------------------------------------------
    # Report
    # ---------------------------------------------------------------------------
    print(f"\nInserted:          {inserted:,}")
    print(f"Skipped duplicate: {skipped_dup:,}")
    print(f"Skipped bad rows:  {skipped_bad:,}")
    print(f"Person ID resolved:{pid_resolved:,}")
    print(f"Display name only: {pid_unresolved:,}")

    if unknown_unit:
        from collections import Counter
        print(f"\nUnknown unit values: {dict(Counter(unknown_unit))}")
    if unknown_conf:
        from collections import Counter
        print(f"Unknown confidence values: {dict(Counter(unknown_conf))}")

    print("\nPublic filter (service layer contract):")
    print("  confidence IN ('verified', 'probable')")
    print("  AND superseded_by IS NULL")
    print("  AND (person_id IS NOT NULL OR display_name IS NOT NULL)")


if __name__ == "__main__":
    main()
