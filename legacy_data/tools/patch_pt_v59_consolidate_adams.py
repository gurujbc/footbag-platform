#!/usr/bin/env python3
"""
patch_pt_v59_consolidate_adams.py

Domain-expert identity consolidation: the 2000-event "Ray Adams" entry is
actually Rob Adams. Folds the Ray Adams PT row
(526baae4-39bf-5caa-b548-14ed106bd118) into the canonical Rob Adams row
(20d639b1-087f-5227-9eaa-6dd342d57439).

Same shape as patch_pt_v55..v58.

Usage (from legacy_data/):
    .venv/bin/python tools/patch_pt_v59_consolidate_adams.py
"""

from __future__ import annotations

import csv
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PT_IN  = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v58.csv"
PT_OUT = ROOT / "inputs" / "identity_lock" / "Persons_Truth_Final_v59.csv"

DOOMED_PID   = "526baae4-39bf-5caa-b548-14ed106bd118"  # Ray Adams
SURVIVOR_PID = "20d639b1-087f-5227-9eaa-6dd342d57439"  # Rob Adams

MERGE_NOTE = (
    "consolidated 526baae4-39bf-5caa-b548-14ed106bd118 (Ray Adams) "
    "into 20d639b1-087f-5227-9eaa-6dd342d57439 per domain-expert 2026-04-23 "
    "(2000 Ray Adams entry is Rob Adams)"
)

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def _norm_name(s: str) -> str:
    s = s.replace("�", "").replace("­", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


def _split_pipe(s: str) -> list[str]:
    return [p.strip() for p in re.split(r"\s*\|\s*", s or "") if p.strip()]


def _join_pipe(parts: list[str]) -> str:
    return " | ".join(parts)


def _union_preserving(primary: list[str], additions: list[str]) -> list[str]:
    seen = set()
    out: list[str] = []
    for tok in primary + additions:
        n = _norm_name(tok)
        if not n or n in seen:
            continue
        seen.add(n)
        out.append(tok)
    return out


def main() -> None:
    if not PT_IN.exists():
        print(f"ERROR: {PT_IN} not found", file=sys.stderr); sys.exit(1)

    with open(PT_IN, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        assert fieldnames is not None
        rows = list(reader)

    doomed = next((r for r in rows if r["effective_person_id"] == DOOMED_PID), None)
    survivor = next((r for r in rows if r["effective_person_id"] == SURVIVOR_PID), None)
    if doomed is None or survivor is None:
        print("ERROR: expected pids not both present", file=sys.stderr); sys.exit(2)

    print(f"v58 input rows: {len(rows)}")
    print(f"  DOOMED   person_canon={doomed['person_canon']!r}")
    print(f"  SURVIVOR person_canon={survivor['person_canon']!r}")

    merged_ids = _union_preserving(_split_pipe(survivor.get("player_ids_seen", "")),
                                   _split_pipe(doomed.get("player_ids_seen", "")))
    merged_names = _union_preserving(_split_pipe(survivor.get("player_names_seen", "")),
                                     _split_pipe(doomed.get("player_names_seen", "")))
    merged_aliases = _union_preserving(_split_pipe(survivor.get("aliases", "")),
                                       _split_pipe(doomed.get("aliases", "")))

    combined_notes = [MERGE_NOTE]
    if (doomed.get("notes") or "").strip():
        combined_notes.append(f"prior-on-doomed-row: {doomed['notes'].strip()}")
    if (survivor.get("notes") or "").strip():
        combined_notes.append(f"prior-on-survivor-row: {survivor['notes'].strip()}")

    new_survivor = dict(survivor)
    new_survivor["player_ids_seen"] = _join_pipe(merged_ids)
    new_survivor["player_names_seen"] = _join_pipe(merged_names)
    new_survivor["aliases"] = _join_pipe(merged_aliases)
    new_survivor["notes"] = " ; ".join(combined_notes)

    out_rows = []
    for r in rows:
        if r["effective_person_id"] == DOOMED_PID:
            continue
        out_rows.append(new_survivor if r["effective_person_id"] == SURVIVOR_PID else r)

    assert len(out_rows) == len(rows) - 1
    out_rows.sort(key=lambda r: _norm_name(r.get("person_canon", "")))

    with open(PT_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames); w.writeheader(); w.writerows(out_rows)

    print(f"\nOutput: {PT_OUT}")
    print(f"  v58 rows: {len(rows)}  v59 rows: {len(out_rows)}  delta: -1")
    print(f"\nSurvivor row after merge:")
    for k in ("effective_person_id", "person_canon", "player_ids_seen",
              "player_names_seen", "aliases", "notes"):
        print(f"  {k}: {new_survivor.get(k, '')}")


if __name__ == "__main__":
    main()
