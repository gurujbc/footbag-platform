from __future__ import annotations
import re
import pandas as pd
from qc_common import load_csv, write_csv, fail, ok, PLACEMENTS

RE_BAD = re.compile(r"[+=\\|]")        # flag these
RE_EMBED_RANK = re.compile(r"\b\d+\.\s")  # "2. Name"
RE_DOUBLESPACE = re.compile(r"\s{2,}")
RE_HAS_DIGIT = re.compile(r"\d")

def main() -> None:
    df = load_csv(PLACEMENTS)

    cols = [c for c in ["player1_name","player2_name","team_display_name"] if c in df.columns]
    if not cols:
        fail("Placements_ByPerson missing expected name columns")

    bad_rows = []

    for c in cols:
        s = df[c].astype(str)

        m = s.str.contains(RE_BAD, regex=True, na=False)
        if m.any():
            t = df.loc[m, ["event_id","year","division_canon","place",c]].copy()
            t["which"] = c
            t.rename(columns={c:"value"}, inplace=True)
            t["reason"] = "bad_separator_[+=\\|]"
            bad_rows.append(t)

        m = s.str.contains(RE_EMBED_RANK, regex=True, na=False)
        if m.any():
            t = df.loc[m, ["event_id","year","division_canon","place",c]].copy()
            t["which"] = c
            t.rename(columns={c:"value"}, inplace=True)
            t["reason"] = "embedded_rank_token"
            bad_rows.append(t)

        m = s.str.contains(RE_DOUBLESPACE, regex=True, na=False)
        if m.any():
            t = df.loc[m, ["event_id","year","division_canon","place",c]].copy()
            t["which"] = c
            t.rename(columns={c:"value"}, inplace=True)
            t["reason"] = "double_space"
            bad_rows.append(t)

    bad = pd.concat(bad_rows, ignore_index=True) if bad_rows else pd.DataFrame()
    if len(bad):
        p = write_csv(bad, "qc03_presentability_results_failures.csv")
        fail(f"QC03 FAIL: {len(bad)} presentability failures. See {p}")
    ok("QC03 OK")

if __name__ == "__main__":
    main()
