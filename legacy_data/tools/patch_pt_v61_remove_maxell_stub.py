#!/usr/bin/env python3
"""
patch_pt_v61_remove_maxell_stub.py

Drops the "Maxell Smith Jr." stub (ff68216c-ec00-56ba-8b00-101f1fb3f6b1)
added in v60 after domain review determined that HoF member Maxell Smith
Jr. is the same person as existing PT row `95fb4def` "Max Smith"
(US, 1981, 4 events, 5 placements).

HoF attribution will be re-routed via two alias rows added alongside
this patch (see person_aliases.csv):
  "Maxell Smith Jr." → 95fb4def
  "Maxell Smith"     → 95fb4def

Does not mutate v60. Produces v61 with 12 stubs instead of 13.

Usage (from legacy_data/):
    .venv/bin/python tools/patch_pt_v61_remove_maxell_stub.py
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PT_IN  = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v60.csv"
PT_OUT = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v61.csv"

DOOMED_PID = "ff68216c-ec00-56ba-8b00-101f1fb3f6b1"  # Maxell Smith Jr. stub

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def _norm_for_sort(s: str) -> str:
    s = (s or "").replace("�", "").replace("­", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def main() -> None:
    if not PT_IN.exists():
        print(f"ERROR: {PT_IN} not found", file=sys.stderr); sys.exit(1)

    with open(PT_IN, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        assert fieldnames is not None
        rows = list(reader)

    doomed = next((r for r in rows if r["effective_person_id"] == DOOMED_PID), None)
    if doomed is None:
        print(f"ERROR: doomed pid {DOOMED_PID} not found in v60", file=sys.stderr)
        sys.exit(2)

    print(f"v60 input rows: {len(rows)}")
    print(f"  dropping stub: {doomed['effective_person_id']}  '{doomed['person_canon']}'")

    out_rows = [r for r in rows if r["effective_person_id"] != DOOMED_PID]
    assert len(out_rows) == len(rows) - 1

    out_rows.sort(key=lambda r: _norm_for_sort(r.get("person_canon", "")))

    with open(PT_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(out_rows)

    print(f"\nOutput: {PT_OUT}")
    print(f"  v60 rows: {len(rows)}  v61 rows: {len(out_rows)}  delta: -1")


if __name__ == "__main__":
    main()
