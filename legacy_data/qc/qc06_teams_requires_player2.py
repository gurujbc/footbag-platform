from __future__ import annotations
import pandas as pd
from qc_common import load_csv, write_csv, fail, ok, PLACEMENTS

def main() -> None:
    df = load_csv(PLACEMENTS)
    need = ["competitor_type","player2_id","player2_name"]
    miss = [c for c in need if c not in df.columns]
    if miss:
        ok("QC06 SKIP (columns missing)")
        return

    team = df["competitor_type"].astype(str).str.lower().eq("team")
    m = team & (df["player2_id"].astype(str).str.strip().eq("") | df["player2_name"].astype(str).str.strip().eq(""))
    bad = df.loc[m, ["event_id","year","division_canon","place","player1_name","player2_id","player2_name","team_display_name"]].copy()

    if len(bad):
        p = write_csv(bad, "qc06_team_missing_player2_failures.csv")
        fail(f"QC06 FAIL: {len(bad)} team rows missing player2. See {p}")

    ok("QC06 OK")

if __name__ == "__main__":
    main()
