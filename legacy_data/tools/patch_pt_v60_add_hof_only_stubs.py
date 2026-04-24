#!/usr/bin/env python3
"""
patch_pt_v60_add_hof_only_stubs.py

Adds PT stub rows for HoF members who have no canonical placement record
and no pre-existing PT entry. Makes them resolvable by the HoF loader so
their honor flag lands, and makes them visible on HoF/platform views.

Scope constraints (per 2026-04-23 decision):
  - 13 names total, one PT row each.
  - No Placements_ByPerson changes.
  - No alias rows added.
  - No inferred competitive history (event_count / placement_count stay 0).
  - source = "patch_v60:hof_only_stub" marks the row's origin.
  - Scott-Mag Hughes reuses the pid pre-filled in hof.csv
    (ca63a7da-a00a-5a83-ae43-2e17b5758fc8) — all others get deterministic
    UUID5s via the same namespace as patch_pt_v53_add_unresolved_persons.py.

Output: inputs/identity_lock/Persons_Truth_Final_v60.csv (+13 rows vs v59).

Usage (from legacy_data/):
    .venv/bin/python tools/patch_pt_v60_add_hof_only_stubs.py
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PT_IN  = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v59.csv"
PT_OUT = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v60.csv"

# Same namespace as seed builder / patch_pt_v53 for deterministic pid generation.
_AUTO_PERSON_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

# Make pipeline.identity importable so we use the canonical normalize_name
# (prevents subtle pid drift if local normalization differs).
sys.path.insert(0, str(ROOT))
from pipeline.identity.alias_resolver import normalize_name as _shared_normalize_name  # noqa: E402

# Declared stubs. (display_name, explicit_pid_override_or_None).
# Scott-Mag Hughes reuses the hof.csv pre-filled pid for source continuity.
_STUBS: list[tuple[str, str | None]] = [
    ("Bill Fischetti",         None),
    ("Brenda Solonoski",       None),
    ("Craig Hufford",          None),
    ("David Watson",           None),
    ("Eddie Robertson",        None),
    ("Garwin Bruce",           None),
    ("Jane Wievisick Sellman", None),
    ("Jerry Cunningham",       None),
    ("Mark Hill",              None),
    ("Maxell Smith Jr.",       None),
    ("Mike Noonan",            None),
    ("Scott-Mag Hughes",       "ca63a7da-a00a-5a83-ae43-2e17b5758fc8"),
    ("Walt Benziger",          None),
]

SOURCE_TAG = "patch_v60:hof_only_stub"

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def _norm_for_sort(s: str) -> str:
    """Local sort-only normalizer — matches patch_pt_v53 sort convention
    (diacritic-stripped lower). Intentionally separate from the pid hash
    input (which uses the shared canonical normalizer)."""
    s = (s or "").replace("�", "").replace("­", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def _pid_for(display_name: str, override: str | None) -> str:
    if override:
        return override
    return str(uuid.uuid5(_AUTO_PERSON_NS, _shared_normalize_name(display_name)))


def _last_token(display_name: str) -> str:
    parts = display_name.split()
    return parts[-1].lower() if parts else ""


def main() -> None:
    if not PT_IN.exists():
        print(f"ERROR: {PT_IN} not found", file=sys.stderr); sys.exit(1)

    with open(PT_IN, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        assert fieldnames is not None, "PT header missing"
        rows = list(reader)

    existing_pids = {r["effective_person_id"] for r in rows}

    # Pre-flight: no pid collision, no canonical-name collision (via normalized form)
    existing_norms = {_shared_normalize_name(r.get("person_canon", "")) for r in rows}
    new_rows: list[dict] = []
    skipped: list[str] = []
    for display, override in _STUBS:
        pid = _pid_for(display, override)
        canon_norm = _shared_normalize_name(display)

        if pid in existing_pids:
            skipped.append(f"{display!r}: pid {pid} already in PT")
            continue
        if canon_norm in existing_norms:
            skipped.append(f"{display!r}: normalized canon {canon_norm!r} already in PT")
            continue

        new_row = {k: "" for k in fieldnames}
        new_row["effective_person_id"] = pid
        new_row["person_canon"]        = display
        new_row["player_names_seen"]   = display
        new_row["source"]              = SOURCE_TAG
        new_row["person_canon_clean"]  = display
        new_row["last_token"]          = _last_token(display)
        new_rows.append(new_row)
        existing_pids.add(pid)
        existing_norms.add(canon_norm)

    print(f"v59 input rows: {len(rows)}")
    print(f"  declared stubs: {len(_STUBS)}")
    print(f"  new stubs to insert: {len(new_rows)}")
    if skipped:
        print("  skipped:")
        for s in skipped:
            print(f"    {s}")

    out_rows = rows + new_rows
    out_rows.sort(key=lambda r: _norm_for_sort(r.get("person_canon", "")))

    with open(PT_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(out_rows)

    print(f"\nOutput: {PT_OUT}")
    print(f"  v59 rows: {len(rows)}  v60 rows: {len(out_rows)}  delta: +{len(new_rows)}")
    print(f"\nNew stubs written:")
    for r in new_rows:
        print(f"  {r['effective_person_id']}  '{r['person_canon']}'  "
              f"last_token={r['last_token']!r}")


if __name__ == "__main__":
    main()
