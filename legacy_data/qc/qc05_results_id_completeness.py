from __future__ import annotations
import pandas as pd
from qc_common import load_csv, write_csv, fail, ok, PLACEMENTS

def main() -> None:
    df = load_csv(PLACEMENTS)
    need = ["competitor_type","player1_id","player1_name"]
    miss = [c for c in need if c not in df.columns]
    if miss:
        fail(f"Placements_ByPerson missing columns: {miss}")

    # player1 must always exist
    m1 = df["player1_id"].astype(str).str.strip().eq("")
    m1 |= df["player1_name"].astype(str).str.strip().eq("")
    bad = df.loc[m1, ["event_id","year","division_canon","place","player1_id","player1_name","competitor_type"]].copy()

    if len(bad):
        p = write_csv(bad, "qc05_results_missing_player1_failures.csv")
        fail(f"QC05 FAIL: {len(bad)} rows missing player1 id/name. See {p}")

    ok("QC05 OK")

if __name__ == "__main__":
    main()
