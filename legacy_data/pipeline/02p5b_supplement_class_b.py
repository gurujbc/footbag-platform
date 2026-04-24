#!/usr/bin/env python3
"""
pipeline/02p5b_supplement_class_b.py

Supplement Placements_Flat.csv with resolved canonical participants from
events that PBP v97 did not cover.

Background
----------
Placements_Flat.csv is produced by 02p5 directly from Placements_ByPerson_v96.csv
(the identity-lock file).  PBP v97 covers mirror-era events well but is missing
many pre-1997 curated events, and it has no entries for "Class B" persons
(those resolved via Person_Display_Names_v1.csv but never added to PT/PBP).

As a result, the workbook's Person_Stats and related analytics sheets are
completely missing those placements.

This script:
1. Identifies canonical_input events that have zero rows in Placements_Flat.
2. For each such event, injects one Placements_Flat row per resolved participant
   (person_id must be non-blank).
3. Uses the canonical events bridge to map canonical event_key → stage2 event_id
   (= legacy_event_id in out/canonical/events.csv), so that stage-04's Statistical
   Gate recognises the injected rows as official events.
4. Skips events already present in Placements_Flat to avoid double-counting.

Inputs
------
  out/Placements_Flat.csv                              (read + appended)
  event_results/canonical_input/event_result_participants.csv
  event_results/canonical_input/event_disciplines.csv
  event_results/canonical_input/persons.csv
  out/canonical/events.csv                             (event_key → legacy_event_id bridge)

Output
------
  out/Placements_Flat.csv   (original rows preserved; new rows appended at end)

Run
---
  cd ~/projects/footbag-platform/legacy_data
  .venv/bin/python pipeline/02p5b_supplement_class_b.py

Downstream: the release workbook flow is
  canonical CSVs
    → pipeline/platform/export_canonical_platform.py
    → event_results/canonical_input/*.csv
    → pipeline/build_workbook_release.py
    → out/Footbag_Results_Release.xlsx
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR    = REPO_ROOT / "out"
CI_DIR     = REPO_ROOT / "event_results" / "canonical_input"

PF_PATH      = OUT_DIR / "Placements_Flat.csv"
EVENTS_PATH  = OUT_DIR / "canonical" / "events.csv"
PARTS_PATH   = CI_DIR  / "event_result_participants.csv"
DISCS_PATH   = CI_DIR  / "event_disciplines.csv"
PERSONS_PATH = CI_DIR  / "persons.csv"

# Columns in Placements_Flat (must match exactly).
PF_COLS = [
    "event_id", "year", "division_canon", "division_category",
    "place", "competitor_type", "person_id", "team_person_key",
    "person_canon", "team_display_name", "coverage_flag",
    "person_unresolved", "norm", "division_raw",
]


def _norm(s: str) -> str:
    return s.strip().lower()


def load_bridge() -> dict[str, dict]:
    """canonical event_key → {legacy_event_id, year}"""
    bridge: dict[str, dict] = {}
    with open(EVENTS_PATH) as f:
        for row in csv.DictReader(f):
            eid = row.get("legacy_event_id", "").strip() or row["event_key"].strip()
            bridge[row["event_key"].strip()] = {
                "stage2_event_id": eid,
                "year": row.get("year", "").strip(),
            }
    return bridge


def load_discipline_info() -> dict[tuple[str, str], dict]:
    """(event_key, discipline_key) → {discipline_name, discipline_category, coverage_flag}"""
    info: dict[tuple[str, str], dict] = {}
    with open(DISCS_PATH) as f:
        for row in csv.DictReader(f):
            key = (row["event_key"].strip(), row["discipline_key"].strip())
            info[key] = {
                "discipline_name":     row["discipline_name"].strip(),
                "discipline_category": row["discipline_category"].strip(),
                "coverage_flag":       row["coverage_flag"].strip(),
            }
    return info


def load_persons() -> dict[str, str]:
    """person_id → person_name"""
    persons: dict[str, str] = {}
    with open(PERSONS_PATH) as f:
        for row in csv.DictReader(f):
            pid = row.get("person_id", "").strip()
            if pid:
                persons[pid] = row.get("person_name", "").strip()
    return persons


def load_existing_pf() -> tuple[list[dict], set[str], set[tuple[str, str, str]]]:
    """
    Returns:
        existing_rows    – all current Placements_Flat rows as dicts
        covered_event_ids – set of event_ids that already have rows in PF
        dedup_keys        – set of (event_id, person_id_norm, division_canon_norm)
    """
    existing_rows: list[dict] = []
    covered_event_ids: set[str] = set()
    dedup_keys: set[tuple[str, str, str]] = set()

    with open(PF_PATH) as f:
        for row in csv.DictReader(f):
            existing_rows.append(row)
            eid = row["event_id"]
            covered_event_ids.add(eid)
            dedup_keys.add((
                eid,
                _norm(row.get("person_id", "")),
                _norm(row.get("division_canon", "")),
            ))

    return existing_rows, covered_event_ids, dedup_keys


def build_new_rows(
    bridge: dict[str, dict],
    disc_info: dict[tuple[str, str], dict],
    persons: dict[str, str],
    covered_event_ids: set[str],
    dedup_keys: set[tuple[str, str, str]],
) -> list[dict]:
    """Iterate canonical_input participants and build new Placements_Flat rows."""
    new_rows: list[dict] = []
    skipped_no_pid       = 0
    skipped_event_covered = 0
    skipped_no_bridge    = 0
    skipped_no_disc      = 0
    skipped_duplicate    = 0

    with open(PARTS_PATH) as f:
        for part in csv.DictReader(f):
            event_key  = part["event_key"].strip()
            disc_key   = part["discipline_key"].strip()
            placement  = part["placement"].strip()
            person_id  = part.get("person_id", "").strip()
            display_nm = part.get("display_name", "").strip()
            tpk        = part.get("team_person_key", "").strip()

            # Must have resolved person_id.
            if not person_id:
                skipped_no_pid += 1
                continue

            # Map event_key to stage2 event_id.
            b = bridge.get(event_key)
            if not b:
                skipped_no_bridge += 1
                continue
            stage2_eid = b["stage2_event_id"]
            year       = b["year"]

            # Skip events already represented in Placements_Flat.
            if stage2_eid in covered_event_ids:
                skipped_event_covered += 1
                continue

            # Get discipline details.
            disc = disc_info.get((event_key, disc_key))
            if not disc:
                skipped_no_disc += 1
                continue

            div_canon  = disc["discipline_name"]
            div_cat    = disc["discipline_category"]
            cov_flag   = disc["coverage_flag"]

            # Dedup check.
            dk = (stage2_eid, _norm(person_id), _norm(div_canon))
            if dk in dedup_keys:
                skipped_duplicate += 1
                continue

            # Person canonical name.
            person_canon = persons.get(person_id, display_nm)

            row: dict = {
                "event_id":        stage2_eid,
                "year":            year,
                "division_canon":  div_canon,
                "division_category": div_cat,
                "place":           placement,
                "competitor_type": "player",
                "person_id":       person_id,
                "team_person_key": tpk,
                "person_canon":    person_canon,
                "team_display_name": "",
                "coverage_flag":   cov_flag,
                "person_unresolved": "",
                "norm":            _norm(person_canon),
                "division_raw":    "",
            }
            new_rows.append(row)
            dedup_keys.add(dk)  # prevent intra-batch duplicates

    print(f"  Skipped (no person_id):          {skipped_no_pid:,}")
    print(f"  Skipped (event already in PF):   {skipped_event_covered:,}")
    print(f"  Skipped (no canonical bridge):   {skipped_no_bridge:,}")
    print(f"  Skipped (no discipline info):    {skipped_no_disc:,}")
    print(f"  Skipped (duplicate key):         {skipped_duplicate:,}")
    return new_rows


def write_pf(existing_rows: list[dict], new_rows: list[dict]) -> None:
    with open(PF_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=PF_COLS, extrasaction="ignore")
        writer.writeheader()
        for row in existing_rows:
            writer.writerow(row)
        for row in new_rows:
            writer.writerow(row)


def main() -> None:
    print("[02p5b] Supplementing Placements_Flat with canonical_input participants...")

    bridge    = load_bridge()
    disc_info = load_discipline_info()
    persons   = load_persons()

    existing_rows, covered_event_ids, dedup_keys = load_existing_pf()
    print(f"  Existing Placements_Flat rows: {len(existing_rows):,}")
    print(f"  Events already covered:        {len(covered_event_ids):,}")

    new_rows = build_new_rows(
        bridge, disc_info, persons, covered_event_ids, dedup_keys
    )

    if not new_rows:
        print("[02p5b] Nothing to inject. Placements_Flat unchanged.")
        return

    write_pf(existing_rows, new_rows)

    total = len(existing_rows) + len(new_rows)
    print(f"\n[02p5b] Done.")
    print(f"  New rows injected:             {len(new_rows):,}")
    print(f"  Placements_Flat total rows:    {total:,}  (was {len(existing_rows):,})")
    print(f"\nDownstream: release workbook via pipeline/build_workbook_release.py"
          f" (reads event_results/canonical_input/*.csv → out/Footbag_Results_Release.xlsx).")


if __name__ == "__main__":
    main()
