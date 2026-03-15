#!/usr/bin/env python3
"""
legacy_data/event_results/scripts/09_patch_missing_person_ids.py

One-time patch: assign stable person_ids to participant rows that are
missing one in the current seed CSVs, and add minimal records to
seed_persons.csv for any newly created IDs.

This script is needed when 07_build_mvfp_seed_full.py cannot be re-run
(canonical input data not available) but the seed files need to be
updated in-place.

Usage:
  python legacy_data/event_results/scripts/09_patch_missing_person_ids.py \
    --seed-dir legacy_data/event_results/seed/mvfp_full
"""

from __future__ import annotations

import argparse
import csv
import uuid
from pathlib import Path

_AUTO_PERSON_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def auto_person_id(display_name: str) -> str:
    return str(uuid.uuid5(_AUTO_PERSON_NS, display_name.strip().lower()))


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--seed-dir",
        default="legacy_data/event_results/seed/mvfp_full",
    )
    args = ap.parse_args()

    seed_dir = Path(args.seed_dir)
    participants_path = seed_dir / "seed_event_result_participants.csv"
    persons_path = seed_dir / "seed_persons.csv"

    participants = read_csv(participants_path)
    persons = read_csv(persons_path)

    existing_ids = {r["person_id"].strip() for r in persons if r.get("person_id", "").strip()}

    patched = 0
    new_persons: dict[str, str] = {}  # person_id -> display_name

    for row in participants:
        if not row.get("person_id", "").strip():
            pid = auto_person_id(row.get("display_name", ""))
            row["person_id"] = pid
            patched += 1
            if pid not in existing_ids and pid not in new_persons:
                new_persons[pid] = row.get("display_name", "").strip()

    if patched == 0:
        print("Nothing to patch — all participants already have person_id.")
        return

    # Write patched participants
    participant_fields = list(participants[0].keys())
    write_csv(participants_path, participants, participant_fields)
    print(f"Patched {patched:,} participant rows in {participants_path.name}")

    # Append new minimal person records
    if new_persons:
        person_fields = list(persons[0].keys()) if persons else [
            "person_id", "person_name", "country", "first_year", "last_year",
            "event_count", "placement_count", "bap_member", "bap_nickname",
            "bap_induction_year", "fbhof_member", "fbhof_induction_year",
            "freestyle_sequences", "freestyle_max_add", "freestyle_unique_tricks",
            "freestyle_diversity_ratio", "signature_trick_1", "signature_trick_2",
            "signature_trick_3",
        ]
        for pid, name in new_persons.items():
            record: dict[str, str] = {f: "" for f in person_fields}
            record["person_id"] = pid
            record["person_name"] = name
            persons.append(record)

        write_csv(persons_path, persons, person_fields)
        print(f"Added {len(new_persons):,} new minimal person records to {persons_path.name}")

    print("\nDone. Re-run 08_load_mvfp_seed_full_to_sqlite.py to reload the database.")


if __name__ == "__main__":
    main()
