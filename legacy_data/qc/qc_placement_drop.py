#!/usr/bin/env python3
"""
QC: Placement counts across pipeline (stage2 vs Placements_Flat).

Run after stage2 and 02p5 (so stage2_canonical_events.csv and Placements_Flat.csv exist).
Writes out/qc_placement_counts.csv: event_id, year, stage2_placements, flat_placements, delta.
Flags events where Flat has more rows than stage2 (Excel should use Flat for those).
Does NOT modify data. (Flat comes from identity lock; 02p5 lock mode does not use stage2. To check drops before 02p5 run qc_stage1_stage2_drop.py.)
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "out"
STAGE2_CSV = OUT / "stage2_canonical_events.csv"
PLACEMENTS_FLAT_CSV = OUT / "Placements_Flat.csv"


def _norm_eid(v) -> str:
    if v is None:
        return ""
    try:
        import pandas as pd
        if hasattr(pd, "isna") and isinstance(v, float) and pd.isna(v):
            return ""
    except Exception:
        pass
    try:
        return str(int(float(v)))
    except (ValueError, TypeError):
        return str(v).strip()


def main() -> None:
    import pandas as pd

    if not STAGE2_CSV.exists():
        print(f"Missing {STAGE2_CSV}; run stage2 first.")
        return
    if not PLACEMENTS_FLAT_CSV.exists():
        print(f"Missing {PLACEMENTS_FLAT_CSV}; run 02p5 first.")
        return

    # Stage2: event_id -> placement count (from placements_json)
    stage2_counts = {}
    csv.field_size_limit(min(2**31 - 1, 10 * 1024 * 1024))
    with open(STAGE2_CSV, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eid = _norm_eid(row.get("event_id"))
            if not eid:
                continue
            try:
                pl = json.loads(row.get("placements_json") or "[]")
            except json.JSONDecodeError:
                pl = []
            stage2_counts[eid] = len(pl)

    # Placements_Flat: event_id -> row count
    df = pd.read_csv(PLACEMENTS_FLAT_CSV)
    flat_counts = df.groupby(df["event_id"].apply(_norm_eid)).size()
    flat_counts = {str(k): int(v) for k, v in flat_counts.items() if k}

    # All event_ids (union), sort numerically when possible
    def _eid_sort_key(x):
        try:
            return (0, int(x)) if x.isdigit() else (1, x)
        except Exception:
            return (1, x)
    all_eids = sorted(set(stage2_counts) | set(flat_counts), key=_eid_sort_key)

    rows = []
    for eid in all_eids:
        s2 = stage2_counts.get(eid, 0)
        fl = flat_counts.get(eid, 0)
        delta = fl - s2
        # year from Flat if available
        year = ""
        if eid in flat_counts and not df[df["event_id"].apply(_norm_eid) == eid].empty:
            y = df[df["event_id"].apply(_norm_eid) == eid]["year"].iloc[0]
            try:
                year = str(int(float(y))) if y is not None and str(y).strip() else ""
            except Exception:
                year = str(y).strip()
        rows.append({
            "event_id": eid,
            "year": year,
            "stage2_placements": s2,
            "flat_placements": fl,
            "delta_flat_minus_stage2": delta,
        })

    out_csv = OUT / "qc_placement_counts.csv"
    pd.DataFrame(rows).to_csv(out_csv, index=False)
    print(f"Wrote {out_csv} ({len(rows)} events)")

    # Summary: events where Flat has more than stage2 (data would be dropped if Excel used only stage2)
    more_in_flat = [r for r in rows if r["delta_flat_minus_stage2"] > 0]
    if more_in_flat:
        print(f"\n⚠️  {len(more_in_flat)} event(s) have MORE placements in Placements_Flat than in stage2.")
        print("    Excel Results cell should use Placements_Flat for these (03 does this when event_id matches).")
        for r in more_in_flat[:15]:
            print(f"    event_id={r['event_id']} year={r['year']} stage2={r['stage2_placements']} flat={r['flat_placements']} delta=+{r['delta_flat_minus_stage2']}")
        if len(more_in_flat) > 15:
            print(f"    ... and {len(more_in_flat) - 15} more (see {out_csv})")
    else:
        print("\n✓ No events have more in Flat than stage2.")


if __name__ == "__main__":
    main()
