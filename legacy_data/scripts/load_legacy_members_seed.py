#!/usr/bin/env python3
"""Seed the legacy_members table with a temporary mirror-derived population.

This population is TEMPORARY. It exists to unblock the FK
historical_persons.legacy_member_id -> legacy_members(legacy_member_id).
Steve Goldberg's data dump will supersede these rows with full profile
fields and flip import_source from 'mirror' to 'steve_dump'.

Minimum columns populated today: legacy_member_id (PK), display_name,
display_name_normalized, imported_at, import_source='mirror'. Everything
else (legacy_email, legacy_user_id, country, bio, honor flags, etc.) is
intentionally left NULL until Steve's dump lands.

Sources:
  legacy_data/seed/club_members.csv                       (2,372 unique
    mirror_member_ids; columns legacy_club_key,
    mirror_member_id, display_name, alias)
  legacy_data/event_results/canonical_input/persons.csv   (gap-fill for
    HP-referenced IDs that don't appear in any club roster)

Idempotent: INSERT OR IGNORE throughout. Safe to re-run.

Must run BEFORE event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py
so the FK on historical_persons.legacy_member_id can be satisfied.

Usage:
  python legacy_data/scripts/load_legacy_members_seed.py [--db path/to/footbag.db]
"""

import argparse
import csv
import os
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

CLUB_MEMBERS_CSV = Path(__file__).parent.parent / "seed" / "club_members.csv"
PERSONS_CSV = Path(__file__).parent.parent / "event_results" / "canonical_input" / "persons.csv"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize(name: str) -> str:
    return " ".join(name.strip().lower().split())


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return [{k: (v or "") for k, v in row.items()} for row in reader]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--db",
        default=os.environ.get("FOOTBAG_DB_PATH", "database/footbag.db"),
    )
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"ERROR: database not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    if not CLUB_MEMBERS_CSV.exists():
        print(f"ERROR: {CLUB_MEMBERS_CSV} not found; "
              f"run extract_club_members.py first.", file=sys.stderr)
        sys.exit(1)

    if not PERSONS_CSV.exists():
        print(f"ERROR: {PERSONS_CSV} not found; "
              f"run the canonical pipeline export first.", file=sys.stderr)
        sys.exit(1)

    club_rows = load_csv(CLUB_MEMBERS_CSV)
    persons_rows = load_csv(PERSONS_CSV)
    ts = now_iso()

    # id -> display_name. First occurrence wins when an id appears in multiple clubs.
    rows_by_id: dict[str, str] = {}

    for r in club_rows:
        mid = r.get("mirror_member_id", "").strip()
        if not mid or mid in rows_by_id:
            continue
        rows_by_id[mid] = r.get("display_name", "").strip()

    # Gap-fill from historical_persons: any legacy_member_id referenced by an
    # HP row that isn't already covered from a club roster.
    for r in persons_rows:
        mid = r.get("member_id", "").strip()
        if not mid or mid.startswith("STUB_") or mid in rows_by_id:
            continue
        rows_by_id[mid] = r.get("person_name", "").strip()

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")

    inserted = 0
    with con:
        for mid, display_name in rows_by_id.items():
            display_name = display_name or None
            display_name_normalized = normalize(display_name) if display_name else None
            cur = con.execute(
                """
                INSERT OR IGNORE INTO legacy_members
                  (legacy_member_id, display_name, display_name_normalized,
                   imported_at, import_source, version)
                VALUES (?, ?, ?, ?, 'mirror', 1)
                """,
                (mid, display_name, display_name_normalized, ts),
            )
            inserted += cur.rowcount

    con.close()

    print(
        f"Done. legacy_members rows inserted: {inserted} "
        f"(sources considered: {len(rows_by_id)} unique IDs)"
    )


if __name__ == "__main__":
    main()
