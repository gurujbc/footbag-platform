#!/usr/bin/env python3
from __future__ import annotations
import sys
import pandas as pd

REQUIRED_SHEETS = ["Index", "Placements_ByPerson", "Persons_Truth"]

def die(msg: str, code: int = 2) -> None:
    print("FAIL:", msg)
    sys.exit(code)

def main(xlsx_path: str) -> None:
    xls = pd.ExcelFile(xlsx_path)
    sheets = set(xls.sheet_names)

    missing = [s for s in REQUIRED_SHEETS if s not in sheets]
    if missing:
        die(f"Missing required sheets: {missing}")

    idx = pd.read_excel(xls, "Index", dtype=str)
    pbp = pd.read_excel(xls, "Placements_ByPerson", dtype=str)
    pt  = pd.read_excel(xls, "Persons_Truth", dtype=str)

    # Basic required columns
    for col in ["event_id"]:
        if col not in idx.columns: die(f"Index missing column: {col}")
    for col in ["event_id", "division_canon", "place", "person_id", "person_canon"]:
        if col not in pbp.columns: die(f"Placements_ByPerson missing column: {col}")
    for col in ["effective_person_id", "person_canon"]:
        if col not in pt.columns: die(f"Persons_Truth missing column: {col}")

    # Normalize
    idx_event = idx["event_id"].astype(str).str.strip()
    pbp_event = pbp["event_id"].astype(str).str.strip()
    pbp_pid   = pbp["person_id"].astype(str).str.strip()
    pt_pid    = pt["effective_person_id"].astype(str).str.strip()

    # 1) Index uniqueness
    dup_events = idx_event.duplicated().sum()

    # 2) Duplicate structural placements (hard fail)
    key = ["event_id", "division_canon", "place", "person_id"]
    dup_struct = pbp.duplicated(subset=key).sum()

    # 3) Orphan person IDs (warn or fail; you decide)
    orphan_person = (~pbp_pid.isin(set(pt_pid))).sum()

    # 4) Orphan event IDs (should be 0 for results-only universe)
    orphan_event = (~pbp_event.isin(set(idx_event))).sum()

    # 5) Same person multiple places in same (event,division) (warn)
    # count keys with >1 distinct place
    tmp = pbp[["event_id","division_canon","person_id","place"]].copy()
    tmp["place"] = tmp["place"].astype(str).str.strip()
    g = tmp.groupby(["event_id","division_canon","person_id"])["place"].nunique(dropna=True)
    multi_place_keys = int((g > 1).sum())

    # Print summary
    print("=== Spreadsheet QC Gate ===")
    print("Index rows:", len(idx), "unique event_id:", idx_event.nunique(), "dup_event_id:", int(dup_events))
    print("Placements rows:", len(pbp))
    print("Persons_Truth rows:", len(pt), "unique effective_person_id:", pt_pid.nunique())
    print("dup_structural_placements:", int(dup_struct))
    print("orphan_event_rows:", int(orphan_event))
    print("orphan_person_rows:", int(orphan_person))
    print("multi_place_person_keys:", multi_place_keys)

    # Gate criteria
    errors = []
    if dup_events != 0: errors.append(f"Index has {dup_events} duplicate event_id")
    if dup_struct != 0: errors.append(f"Placements_ByPerson has {dup_struct} duplicate structural rows")
    if orphan_event != 0: errors.append(f"Placements_ByPerson has {orphan_event} orphan event rows")

    if errors:
        print("\nFAIL conditions:")
        for e in errors: print(" -", e)
        sys.exit(1)

    print("\nPASS ✅")
    sys.exit(0)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: qc_spreadsheet_gate.py <Footbag_Results_Canonical.xlsx>")
        sys.exit(2)
    main(sys.argv[1])
