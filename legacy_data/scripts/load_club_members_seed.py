#!/usr/bin/env python3
"""Seed legacy_club_candidates and legacy_person_club_affiliations from club_members.csv.

For each club in clubs.csv: inserts a legacy_club_candidates row mapping the
legacy_club_key to the resolved club_id (already in the clubs table).

For each row in club_members.csv: attempts an exact name match in
historical_persons, then inserts a legacy_person_club_affiliations row.
Rows that don't match a historical_person are still inserted using
legacy_member_id only (mirror_member_id from the showmembers page).

Idempotent: uses INSERT OR IGNORE throughout.

Usage:
  python legacy_data/scripts/load_club_members_seed.py [--db path/to/footbag.db]
"""

import argparse
import csv
import hashlib
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

CLUBS_CSV = Path(__file__).parent.parent / "seed" / "clubs.csv"
MEMBERS_CSV = Path(__file__).parent.parent / "seed" / "club_members.csv"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stable_id(prefix: str, *parts: str) -> str:
    raw = "||".join(str(p) for p in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


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

    if not CLUBS_CSV.exists():
        print(f"ERROR: clubs CSV not found at {CLUBS_CSV}", file=sys.stderr)
        sys.exit(1)

    if not MEMBERS_CSV.exists():
        print(f"ERROR: club_members CSV not found at {MEMBERS_CSV}", file=sys.stderr)
        print("Run legacy_data/scripts/extract_club_members.py first.", file=sys.stderr)
        sys.exit(1)

    clubs_rows = load_csv(CLUBS_CSV)
    members_rows = load_csv(MEMBERS_CSV)
    ts = now_iso()

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")
    con.row_factory = sqlite3.Row

    # Build legacy_club_key → club_id mapping from the clubs table.
    # The load_clubs_seed.py script uses stable_id("club", legacy_club_key) as club_id.
    existing_clubs = {
        row["legacy_club_key"]: stable_id("club", row["legacy_club_key"])
        for row in clubs_rows
    }

    # Verify the club_ids actually exist in the DB.
    existing_club_ids = {
        r[0] for r in con.execute("SELECT id FROM clubs")
    }

    # Build person_name → person_id lookup (exact, case-insensitive fallback).
    person_by_name: dict[str, str] = {}
    for r in con.execute("SELECT person_id, person_name FROM historical_persons"):
        person_by_name[r["person_name"].strip()] = r["person_id"]

    candidates_inserted = 0
    candidates_skipped = 0
    affiliations_matched = 0
    affiliations_unmatched = 0

    with con:
        # ── 1. Seed legacy_club_candidates ────────────────────────────────────
        for row in clubs_rows:
            key = row["legacy_club_key"]
            club_id = existing_clubs.get(key)
            if not club_id or club_id not in existing_club_ids:
                candidates_skipped += 1
                continue

            cand_id = stable_id("lcc", key)
            cur = con.execute(
                """
                INSERT OR IGNORE INTO legacy_club_candidates
                  (id, created_at, created_by, updated_at, updated_by, version,
                   legacy_club_key, display_name, city, region, country,
                   confidence_score, mapped_club_id, bootstrap_eligible)
                VALUES (?, ?, 'seed', ?, 'seed', 1, ?, ?, ?, ?, ?, 1.0, ?, 0)
                """,
                (
                    cand_id, ts, ts,
                    key,
                    row["name"],
                    row["city"] or None,
                    row["region"] or None,
                    row["country"] or None,
                    club_id,
                ),
            )
            candidates_inserted += cur.rowcount

        # ── 2. Seed legacy_person_club_affiliations ───────────────────────────
        for row in members_rows:
            key = row["legacy_club_key"]
            club_id = existing_clubs.get(key)
            if not club_id or club_id not in existing_club_ids:
                continue

            cand_id = stable_id("lcc", key)
            display_name = row["display_name"].strip()
            mirror_member_id = row["mirror_member_id"].strip() or None

            # Name match: exact first, then case-insensitive.
            person_id = person_by_name.get(display_name)
            if not person_id:
                lower_map = {k.lower(): v for k, v in person_by_name.items()}
                person_id = lower_map.get(display_name.lower())

            affil_id = stable_id("lpca", key, row["mirror_member_id"], display_name)

            if person_id:
                cur = con.execute(
                    """
                    INSERT OR IGNORE INTO legacy_person_club_affiliations
                      (id, created_at, created_by, updated_at, updated_by, version,
                       historical_person_id, legacy_member_id,
                       legacy_club_candidate_id, inferred_role,
                       confidence_score, resolution_status, display_name)
                    VALUES (?, ?, 'seed', ?, 'seed', 1,
                            ?, ?, ?, 'member', 1.0, 'confirmed_current', ?)
                    """,
                    (affil_id, ts, ts, person_id, mirror_member_id, cand_id, display_name),
                )
                affiliations_matched += cur.rowcount
            else:
                if not mirror_member_id:
                    continue
                cur = con.execute(
                    """
                    INSERT OR IGNORE INTO legacy_person_club_affiliations
                      (id, created_at, created_by, updated_at, updated_by, version,
                       historical_person_id, legacy_member_id,
                       legacy_club_candidate_id, inferred_role,
                       confidence_score, resolution_status, display_name)
                    VALUES (?, ?, 'seed', ?, 'seed', 1,
                            NULL, ?, ?, 'member', 0.5, 'confirmed_current', ?)
                    """,
                    (affil_id, ts, ts, mirror_member_id, cand_id, display_name),
                )
                affiliations_unmatched += cur.rowcount

    con.close()

    print(
        f"Done.\n"
        f"  legacy_club_candidates inserted: {candidates_inserted} "
        f"(skipped/not-in-db: {candidates_skipped})\n"
        f"  legacy_person_club_affiliations inserted:\n"
        f"    name-matched (with historical_person_id): {affiliations_matched}\n"
        f"    unmatched (legacy_member_id only):         {affiliations_unmatched}"
    )


if __name__ == "__main__":
    main()
