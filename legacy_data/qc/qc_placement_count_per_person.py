#!/usr/bin/env python3
"""
QC: Per-person placement count — find people who have more placements in
Placements_Flat than in Placements_ByPerson (spreadsheet).

Run after 04_build_analytics.py. Reads out/Placements_Flat.csv and
out/Placements_ByPerson.csv. Writes out/qc/placement_count_per_person_issues.csv
with one row per person where flat_count > pbp_count (and optionally where
total_placements_gate3 in Persons_Truth is less than pbp_count).

Possible causes when flat_count > pbp_count:
  - Gate 1: some of their placements were in Placements_ByPerson_Rejected or
    excluded_results_rows_unpresentable (intentional exclusion).
  - Dedup: non-flat layout collapses duplicate (event, division, place, person)
    rows to one (expected when source has dupes).
  - Bug: rows lost in build_placements_by_person_clean or earlier.

Does not modify data.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "out"
QCDIR = OUT / "qc"
PLACEMENTS_FLAT = OUT / "Placements_Flat.csv"
PLACEMENTS_BY_PERSON = OUT / "Placements_ByPerson.csv"
PERSONS_TRUTH = OUT / "Persons_Truth.csv"


def _norm(s) -> str:
    return (str(s).strip() if s is not None and str(s).strip() else "")


def _count_placements_flat_flat_layout(pf) -> dict[str, int]:
    """Flat layout: one row per placement; person_id for singles, team_person_key for teams."""
    counts = {}
    pid = pf["person_id"].fillna("").astype(str).str.strip().map(_norm)
    for p in pid:
        if p:
            counts[p] = counts.get(p, 0) + 1
    team_col = pf.get("team_person_key")
    if team_col is not None:
        for t in team_col.fillna("").astype(str).str.strip():
            if t and "|" in t:
                for part in t.replace("|?", "").split("|"):
                    part = _norm(part)
                    if part:
                        counts[part] = counts.get(part, 0) + 1
    return counts


def _count_placements_flat_legacy_layout(pf) -> dict[str, int]:
    """Legacy: one row per placement; player1 and optionally player2."""
    counts = {}
    p1 = pf.get("player1_person_id", pf.get("player1_id", None))
    if p1 is None:
        return counts
    p1 = p1.fillna("").astype(str).str.strip().map(_norm)
    for pid in p1:
        if pid:
            counts[pid] = counts.get(pid, 0) + 1
    p2 = pf.get("player2_person_id", pf.get("player2_id", None))
    if p2 is not None:
        p2 = p2.fillna("").astype(str).str.strip().map(_norm)
        for pid in p2:
            if pid:
                counts[pid] = counts.get(pid, 0) + 1
    return counts


def _count_placements_pbp(pbp) -> dict[str, int]:
    """Placements_ByPerson: one row per (event, division, place, identity)."""
    # Singles: person_id; teams: team_person_key. Count one per row for
    # person_id (singles), and for team rows count each UUID in team_person_key once.
    pid_col = pbp.get("person_id", None)
    team_col = pbp.get("team_person_key", None)
    if pid_col is None:
        return {}
    counts = {}
    for i in range(len(pbp)):
        p = _norm(pid_col.iloc[i])
        if p:
            counts[p] = counts.get(p, 0) + 1
        if team_col is not None:
            t = _norm(team_col.iloc[i])
            if t and "|" in t:
                for part in t.replace("|?", "").split("|"):
                    part = _norm(part)
                    if part:
                        counts[part] = counts.get(part, 0) + 1
    return counts


def _person_canon_lookup(pbp) -> dict[str, str]:
    """person_id -> person_canon from Placements_ByPerson (first occurrence)."""
    pid = pbp.get("person_id")
    canon = pbp.get("person_canon")
    if pid is None or canon is None:
        return {}
    out = {}
    for i in range(len(pbp)):
        p = _norm(pid.iloc[i])
        c = _norm(canon.iloc[i])
        if p and p not in out:
            out[p] = c
    return out


def main() -> int:
    import pandas as pd

    if not PLACEMENTS_FLAT.exists():
        print(f"Missing {PLACEMENTS_FLAT}; run 02p5 first.", file=sys.stderr)
        return 2
    if not PLACEMENTS_BY_PERSON.exists():
        print(f"Missing {PLACEMENTS_BY_PERSON}; run 04_build_analytics first.", file=sys.stderr)
        return 2

    pf = pd.read_csv(PLACEMENTS_FLAT, dtype=str).fillna("")
    pbp = pd.read_csv(PLACEMENTS_BY_PERSON, dtype=str).fillna("")

    has_flat_layout = "person_id" in pf.columns and "player1_person_id" not in pf.columns

    if has_flat_layout:
        flat_counts = _count_placements_flat_flat_layout(pf)
    else:
        flat_counts = _count_placements_flat_legacy_layout(pf)

    pbp_counts = _count_placements_pbp(pbp)
    canon_lookup = _person_canon_lookup(pbp)

    # All person_ids that appear in either source
    all_ids = sorted(set(flat_counts) | set(pbp_counts))

    rows = []
    for pid in all_ids:
        fc = flat_counts.get(pid, 0)
        pc = pbp_counts.get(pid, 0)
        delta = fc - pc
        if delta <= 0:
            continue
        rows.append({
            "person_id": pid,
            "person_canon": canon_lookup.get(pid, ""),
            "placements_in_flat": fc,
            "placements_in_pbp": pc,
            "delta_flat_minus_pbp": delta,
        })

    QCDIR.mkdir(parents=True, exist_ok=True)
    out_path = QCDIR / "placement_count_per_person_issues.csv"

    # Optional: flag persons whose total_placements_gate3 (Persons_Truth) < placements in PBP
    # (Explains "shows 1 in spreadsheet": coverage filter only counts complete/mostly_complete divisions.)
    if PERSONS_TRUTH.exists():
        pt = pd.read_csv(PERSONS_TRUTH, dtype=str).fillna("")
        if "effective_person_id" in pt.columns and "total_placements_gate3" in pt.columns:
            pt_count = dict(zip(
                pt["effective_person_id"].astype(str).str.strip(),
                pd.to_numeric(pt["total_placements_gate3"], errors="coerce").fillna(0).astype(int),
            ))
            undercount = []
            for pid, pbp_count in pbp_counts.items():
                gate3 = pt_count.get(pid, 0)
                if 0 < gate3 < pbp_count:
                    undercount.append((pid, canon_lookup.get(pid, ""), int(gate3), pbp_count))
            if undercount:
                under_path = QCDIR / "placement_count_gate3_undercount.csv"
                udf = pd.DataFrame(
                    [{"person_id": p, "person_canon": c, "total_placements_gate3": g, "placements_in_pbp": n}
                     for p, c, g, n in undercount]
                )
                udf.to_csv(under_path, index=False)
                print(f"QC: {len(undercount)} person(s) have total_placements_gate3 < PBP (coverage filter). Wrote {under_path}")

    if not rows:
        print("OK: No person has more placements in Flat than in Placements_ByPerson.")
        if out_path.exists():
            out_path.unlink()
        return 0

    df = pd.DataFrame(rows)
    df.sort_values(by=["delta_flat_minus_pbp", "placements_in_flat"], ascending=[False, False], inplace=True)
    df.to_csv(out_path, index=False)
    print(f"QC: {len(rows)} person(s) have more placements in Flat than in PBP. Wrote {out_path}")
    print("    Possible causes: Gate 1 exclusion, dedup in non-flat layout, or bug in 04.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
