#!/usr/bin/env python3
"""
QC: Possible placement drops between stage1 and stage2.

Compares per-event "placement-like" line count in stage1 results_block_raw
to stage2 placement count. If stage2 has fewer than stage1 for an event,
data may have been dropped during canonicalization (02).

Run after stage1 (merge) and stage2:
  - out/stage1_raw_events.csv
  - out/stage2_canonical_events.csv

Writes out/qc_stage1_stage2_drop.csv and prints events where stage2 < stage1.
Does NOT modify data.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "out"
STAGE1_CSV = OUT / "stage1_raw_events.csv"
STAGE2_CSV = OUT / "stage2_canonical_events.csv"

# Lines that look like "1. Name" or "2. A / B" in raw results
PLACEMENT_LINE_RE = re.compile(r"^\s*\d+\.\s+\S", re.MULTILINE)


def _norm_eid(v) -> str:
    if v is None:
        return ""
    try:
        return str(int(float(v)))
    except (ValueError, TypeError):
        return str(v).strip()


def _count_placement_like_lines(text: str) -> int:
    if not text or not isinstance(text, str):
        return 0
    return len(PLACEMENT_LINE_RE.findall(text))


def main() -> None:
    if not STAGE1_CSV.exists():
        print(f"Missing {STAGE1_CSV}; run stage1 merge (01c_merge_stage1.py) first.")
        return
    if not STAGE2_CSV.exists():
        print(f"Missing {STAGE2_CSV}; run stage2 first.")
        return

    csv.field_size_limit(min(2**31 - 1, 10 * 1024 * 1024))

    # Stage1: event_id -> count of placement-like lines in results_block_raw
    stage1_counts = {}
    with open(STAGE1_CSV, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eid = _norm_eid(row.get("event_id"))
            if not eid:
                continue
            raw = (row.get("results_block_raw") or "").strip()
            stage1_counts[eid] = _count_placement_like_lines(raw)

    # Stage2: event_id -> placement count from placements_json
    stage2_counts = {}
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

    # Events in both; only care where stage2 < stage1 (possible drop)
    all_eids = sorted(
        set(stage1_counts) & set(stage2_counts),
        key=lambda x: (int(x) if x.isdigit() else 0, x),
    )
    rows = []
    for eid in all_eids:
        s1 = stage1_counts[eid]
        s2 = stage2_counts[eid]
        delta = s2 - s1
        rows.append({
            "event_id": eid,
            "stage1_placement_like_lines": s1,
            "stage2_placements": s2,
            "delta_stage2_minus_stage1": delta,
        })

    out_csv = OUT / "qc_stage1_stage2_drop.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["event_id", "stage1_placement_like_lines", "stage2_placements", "delta_stage2_minus_stage1"])
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {out_csv} ({len(rows)} events)")

    # Events where stage2 has fewer than stage1 (possible drop in 02)
    dropped = [r for r in rows if r["delta_stage2_minus_stage1"] < 0]
    if dropped:
        print(f"\n⚠️  {len(dropped)} event(s) have FEWER placements in stage2 than placement-like lines in stage1 (possible drop in 02):")
        for r in dropped[:20]:
            print(f"    event_id={r['event_id']} stage1_lines={r['stage1_placement_like_lines']} stage2={r['stage2_placements']} delta={r['delta_stage2_minus_stage1']}")
        if len(dropped) > 20:
            print(f"    ... and {len(dropped) - 20} more (see {out_csv})")
    else:
        print("\n✓ No events have stage2 < stage1 placement-like lines.")


if __name__ == "__main__":
    main()
