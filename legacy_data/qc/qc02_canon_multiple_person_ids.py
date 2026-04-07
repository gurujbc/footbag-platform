from __future__ import annotations
import pandas as pd
from qc_common import load_csv, write_csv, ok, PERSONS

BAD_TINY = {"nd", "st", "rd"}  # common ordinal leakage

def main() -> None:
    pt = load_csv(PERSONS)
    if "person_canon" not in pt.columns or "effective_person_id" not in pt.columns:
        ok("QC02 SKIP: missing required columns")
        return

    df = pt[["person_canon","effective_person_id"]].copy()
    df["person_canon_l"] = df["person_canon"].str.strip().str.lower()
    df = df[df["person_canon"].str.strip() != ""]
    df = df[~df["person_canon_l"].isin(BAD_TINY)]

    g = (df.groupby("person_canon")["effective_person_id"]
           .nunique()
           .reset_index(name="distinct_person_ids"))
    cand = g[g["distinct_person_ids"] > 1].copy().sort_values(
        ["distinct_person_ids","person_canon"], ascending=[False, True]
    )

    # add sample ids + counts (useful for triage)
    if len(cand):
        ids = (df.merge(cand[["person_canon"]], on="person_canon", how="inner")
                 .groupby("person_canon")["effective_person_id"]
                 .apply(lambda s: " | ".join(list(dict.fromkeys(s))[:20]))
                 .reset_index(name="sample_person_ids"))
        rows = (df.merge(cand[["person_canon"]], on="person_canon", how="inner")
                  .groupby("person_canon")
                  .size()
                  .reset_index(name="rows"))
        out = cand.merge(rows, on="person_canon", how="left").merge(ids, on="person_canon", how="left")
        write_csv(out, "qc02_canon_multiple_person_ids_candidates.csv")

    ok(f"QC02 OK (wrote candidates: {len(cand)})")

if __name__ == "__main__":
    main()
