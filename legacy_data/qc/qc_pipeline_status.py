#!/usr/bin/env python3
"""
Quick QC status check for the Footbag pipeline.
Run AFTER: 02p5 → 03 → 04

Does NOT modify data.
"""

from pathlib import Path
import json
import pandas as pd

ROOT = Path(".")
OUT = ROOT / "out"
XLSX = ROOT / "Footbag_Results_Canonical.xlsx"

def header(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)

def main():
    # ------------------------------------------------------------
    # 1) Stage 2.5 QC summary
    # ------------------------------------------------------------
    header("STAGE 2.5 QC SUMMARY")
    qc_json = OUT / "stage2p5_qc_summary.json"
    if qc_json.exists():
        qc = json.loads(qc_json.read_text())
        for k, v in qc.items():
            print(f"{k}: {v}")
    else:
        print("❌ Missing:", qc_json)

    # ------------------------------------------------------------
    # 2) Placements_Flat sanity
    # ------------------------------------------------------------
    header("PLACEMENTS_FLAT SANITY")
    pf = OUT / "Placements_Flat.csv"
    if not pf.exists():
        print("❌ Missing:", pf)
    else:
        df = pd.read_csv(pf, dtype=str, keep_default_na=False)
        n = len(df)
        p1_filled = (df["player1_person_id"] != "").sum()
        p2_filled = (df["player2_person_id"] != "").sum()

        print(f"Rows: {n}")
        print(f"player1_person_id filled: {p1_filled} ({p1_filled/n:.1%})")
        print(f"player2_person_id filled: {p2_filled} ({p2_filled/n:.1%})")

        if "player1_person_canon" in df.columns:
            print("Unique player1_person_canon:",
                  df["player1_person_canon"].replace("", pd.NA).nunique())

    # ------------------------------------------------------------
    # 3) Workbook presence + sheet sanity (no Excel UI)
    # ------------------------------------------------------------
    header("WORKBOOK CHECK")
    if not XLSX.exists():
        print("❌ Missing:", XLSX)
        return

    try:
        import openpyxl
        wb = openpyxl.load_workbook(XLSX, read_only=True)
        sheets = wb.sheetnames
        print("Workbook:", XLSX)
        print("Sheet count:", len(sheets))

        interesting = [s for s in sheets if s.startswith("Person") or "Merge" in s or "Stats" in s]
        print("Key sheets:")
        for s in interesting:
            print("  -", s)

        # --------------------------------------------------------
        # 4) Persons_Truth quick stats (if present)
        # --------------------------------------------------------
        if "Persons_Truth" in sheets:
            df_pt = pd.read_excel(XLSX, sheet_name="Persons_Truth", dtype=str)
            print("\nPersons_Truth rows:", len(df_pt))

            if "source" in df_pt.columns:
                print("Persons_Truth by source:")
                print(df_pt["source"].value_counts(dropna=False).to_string())

    except Exception as e:
        print("❌ Failed to inspect workbook:", e)

    header("QC STATUS: DONE")

if __name__ == "__main__":
    main()
