#!/usr/bin/env python3
"""
patch_pt_v53_add_unresolved_persons.py

Creates Persons_Truth_Final_v53.csv by:
  1. Copying all rows from v52
  2. Adding new rows for canonical participants who have no PT entry

New person_ids use the same UUID5 namespace as the seed builder's auto_person_id
so that DB person_ids remain stable across the transition.

Usage (from legacy_data/):
    .venv/bin/python tools/patch_pt_v53_add_unresolved_persons.py

Inputs:
    inputs/identity_lock/Persons_Truth_Final_v52.csv
    out/canonical/event_result_participants.csv
    overrides/person_aliases.csv

Output:
    inputs/identity_lock/Persons_Truth_Final_v53.csv
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
import uuid
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # legacy_data/
PT_V52 = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v52.csv"
PT_V53 = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v53.csv"
PARTICIPANTS_CSV = ROOT / "out" / "canonical" / "event_result_participants.csv"
ALIASES_CSV = ROOT / "overrides" / "person_aliases.csv"

# Same namespace as seed builder auto_person_id
_AUTO_PERSON_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")

_EXCLUDE_NAMES = {
    "[unknown partner]", "__unknown_partner__", "__non_person__",
    "(unknown)", "",
}


def _norm_name(s: str) -> str:
    s = s.replace("\ufffd", "").replace("\u00ad", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def auto_person_id(display_name: str) -> str:
    """Stable UUID5 — matches seed builder."""
    return str(uuid.uuid5(_AUTO_PERSON_NS, display_name.strip().lower()))


def main() -> None:
    if not PT_V52.exists():
        print(f"ERROR: {PT_V52} not found")
        sys.exit(1)

    # ── Load existing PT v52 ───────────────────────────────────────────
    with open(PT_V52, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        pt_rows = list(reader)

    existing_pids: set[str] = set()
    existing_norms: set[str] = set()
    for row in pt_rows:
        existing_pids.add(row["effective_person_id"])
        existing_norms.add(_norm_name(row["person_canon"]))
        for name in re.split(r"\s*\|\s*", row.get("player_names_seen", "")):
            name = name.strip()
            if name:
                existing_norms.add(_norm_name(name))

    # Also load aliases as resolved norms
    alias_norms: set[str] = set()
    if ALIASES_CSV.exists():
        with open(ALIASES_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                alias = row.get("alias", "").strip()
                if alias:
                    alias_norms.add(_norm_name(alias))

    all_resolved_norms = existing_norms | alias_norms

    print(f"PT v52: {len(pt_rows)} persons, {len(existing_norms)} normalized names")
    print(f"Aliases: {len(alias_norms)} additional normalized names")

    # ── Find unresolved participants ───────────────────────────────────
    unresolved_names: dict[str, dict] = {}  # norm -> {display_name, count, events}

    with open(PARTICIPANTS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["person_id"].strip():
                continue
            name = row["display_name"].strip()
            if name.lower() in _EXCLUDE_NAMES:
                continue

            normed = _norm_name(name)
            if normed in all_resolved_norms:
                continue

            if normed not in unresolved_names:
                unresolved_names[normed] = {
                    "display_name": name,
                    "count": 0,
                    "events": set(),
                    "years": set(),
                }
            info = unresolved_names[normed]
            info["count"] += 1
            info["events"].add(row.get("event_key", ""))
            year_str = row.get("event_key", "")[:4]
            if year_str.isdigit():
                info["years"].add(int(year_str))

    print(f"Unresolved participants to add: {len(unresolved_names)} persons")

    # ── Build new PT rows ──────────────────────────────────────────────
    new_rows = []
    for normed, info in sorted(unresolved_names.items()):
        display_name = info["display_name"]
        pid = auto_person_id(display_name)

        # Skip if pid collision (shouldn't happen with UUID5 but be safe)
        if pid in existing_pids:
            print(f"  WARNING: pid collision for \"{display_name}\" — skipping")
            continue

        new_row = {k: "" for k in fieldnames}
        new_row["effective_person_id"] = pid
        new_row["person_canon"] = display_name
        new_row["player_ids_seen"] = ""
        new_row["player_names_seen"] = display_name
        new_row["source"] = "patch_v53:unresolved_canonical_participant"
        new_row["person_canon_clean"] = display_name
        new_row["norm_key"] = normed
        new_row["last_token"] = display_name.split()[-1].lower() if display_name.split() else ""

        new_rows.append(new_row)
        existing_pids.add(pid)

    print(f"New PT rows created: {len(new_rows)}")

    # ── Write PT v53 ──────────────────────────────────────────────────
    all_rows = pt_rows + new_rows
    # Sort by person_canon for stable output
    all_rows.sort(key=lambda r: _norm_name(r.get("person_canon", "")))

    with open(PT_V53, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\nOutput: {PT_V53}")
    print(f"  v52 persons: {len(pt_rows)}")
    print(f"  new persons: {len(new_rows)}")
    print(f"  v53 total:   {len(all_rows)}")

    # ── Summary of top new additions ──────────────────────────────────
    top = sorted(unresolved_names.items(), key=lambda x: -x[1]["count"])[:15]
    print(f"\nTop new persons by appearance count:")
    for normed, info in top:
        yr = ""
        if info["years"]:
            yr = f" ({min(info['years'])}–{max(info['years'])})"
        print(f"  ({info['count']:>2}x) {info['display_name']}{yr}")


if __name__ == "__main__":
    main()
