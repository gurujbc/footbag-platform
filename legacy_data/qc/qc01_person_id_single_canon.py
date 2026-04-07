from __future__ import annotations
import pandas as pd
from qc_common import load_csv, write_csv, fail, ok, PERSONS

def main() -> None:
    pt = load_csv(PERSONS)

    need = ["effective_person_id", "person_canon"]
    missing = [c for c in need if c not in pt.columns]
    if missing:
        fail(f"Persons_Truth missing columns: {missing}")

    g = (pt.groupby("effective_person_id")["person_canon"]
           .nunique()
           .reset_index(name="distinct_canons"))
    bad = g[g["distinct_canons"] > 1].copy()

    if len(bad):
        sample = (pt.merge(bad[["effective_person_id"]], on="effective_person_id", how="inner")
                    .groupby("effective_person_id")["person_canon"]
                    .apply(lambda s: " | ".join(sorted(set(s))[:10]))
                    .reset_index(name="sample_canons"))
        out = bad.merge(sample, on="effective_person_id", how="left") \
                 .sort_values(["distinct_canons","effective_person_id"], ascending=[False, True])
        p = write_csv(out, "qc01_person_id_single_canon_failures.csv")
        fail(f"QC01 FAIL: {len(out)} person_ids map to multiple canons. See {p}")
    ok("QC01 OK")

if __name__ == "__main__":
    main()
