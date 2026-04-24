#!/usr/bin/env python3
"""
patch_placements_v103_remap_adams.py

Companion to patch_pt_v59_consolidate_adams.py. Advances
Placements_ByPerson from v102 to v103 by remapping every reference to
526baae4-39bf-5caa-b548-14ed106bd118 (Ray Adams) onto
20d639b1-087f-5227-9eaa-6dd342d57439 (Rob Adams).

Expected v102 → v103 diff (pre-verified):
  - 1 solo row remapped (event 947026077, 2000 Singles Net)
  - 1 team row remapped (event 947026077, 2000 Doubles Net, partner 0f51c65d)
  - total row count unchanged (27,970)
  - post-run `grep 526baae4` in v103 must return 0

Usage (from legacy_data/):
    .venv/bin/python tools/patch_placements_v103_remap_adams.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PB_IN  = ROOT / "inputs" / "identity_lock" / "Placements_ByPerson_v102.csv"
PB_OUT = ROOT / "inputs" / "identity_lock" / "Placements_ByPerson_v103.csv"

DOOMED_PID   = "526baae4-39bf-5caa-b548-14ed106bd118"
SURVIVOR_PID = "20d639b1-087f-5227-9eaa-6dd342d57439"
SURVIVOR_DISPLAY = "Rob Adams"
SURVIVOR_NORM    = "rob adams"


def _remap_team_key(team_key: str) -> str:
    parts = [p.strip() for p in team_key.split("|") if p.strip()]
    seen = set(); out = []
    for p in parts:
        new = SURVIVOR_PID if p == DOOMED_PID else p
        if new in seen: continue
        seen.add(new); out.append(new)
    return "|".join(out)


def main() -> None:
    if not PB_IN.exists():
        print(f"ERROR: {PB_IN} not found", file=sys.stderr); sys.exit(1)

    with open(PB_IN, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f); fieldnames = reader.fieldnames; rows = list(reader)

    solo = team = 0
    out_rows = []
    for row in rows:
        pid = row.get("person_id", "") or ""
        tkey = row.get("team_person_key", "") or ""
        if pid == DOOMED_PID:
            row = dict(row)
            row["person_id"] = SURVIVOR_PID
            row["person_canon"] = SURVIVOR_DISPLAY
            if "norm" in fieldnames:
                row["norm"] = SURVIVOR_NORM
            solo += 1
        if DOOMED_PID in tkey:
            row = dict(row)
            row["team_person_key"] = _remap_team_key(tkey)
            team += 1
        out_rows.append(row)

    offenders = [(i, k, v) for i, r in enumerate(out_rows) for k, v in r.items() if v and DOOMED_PID in v]
    if offenders:
        print(f"ERROR: {len(offenders)} residual DOOMED refs", file=sys.stderr)
        for o in offenders[:5]: print(f"  row {o[0]} col {o[1]}: {o[2]}", file=sys.stderr)
        sys.exit(3)
    assert len(out_rows) == len(rows)

    with open(PB_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames); w.writeheader(); w.writerows(out_rows)

    survivor_total = sum(
        1 for r in out_rows
        if r.get("person_id") == SURVIVOR_PID or SURVIVOR_PID in (r.get("team_person_key") or "")
    )
    print(f"v102 rows: {len(rows)}  v103 rows: {len(out_rows)}  delta: 0")
    print(f"  solo remapped: {solo}  team remapped: {team}")
    print(f"  rows referencing survivor: {survivor_total}")
    print(f"Output: {PB_OUT}")


if __name__ == "__main__":
    main()
