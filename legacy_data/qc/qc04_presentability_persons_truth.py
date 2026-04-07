from __future__ import annotations
import re
import pandas as pd
from qc_common import load_csv, write_csv, fail, ok, PERSONS

RE_BAD = re.compile(r"[+=\\|/]")
RE_EMBED_RANK = re.compile(r"\b\d+\.\s")
RE_TOO_MUCH_PUNCT = re.compile(r"[()]{1,}")  # parentheses usually metadata
RE_HAS_FLAG = re.compile(r"[\U0001F1E6-\U0001F1FF]")  # flag emoji range

def main() -> None:
    pt = load_csv(PERSONS)
    need = ["effective_person_id","person_canon","source"]
    miss = [c for c in need if c not in pt.columns]
    if miss:
        fail(f"Persons_Truth missing columns: {miss}")

    s = pt["person_canon"].astype(str)
    bad = pd.Series(False, index=pt.index)

    bad |= s.str.contains(RE_BAD, regex=True, na=False)
    bad |= s.str.contains(RE_EMBED_RANK, regex=True, na=False)
    bad |= s.str.contains(RE_HAS_FLAG, regex=True, na=False)

    # allow parentheses ONLY for verified rows (you can tighten this later)
    verified = pt["source"].astype(str).str.contains("overrides", na=False)
    bad |= (~verified) & s.str.contains(RE_TOO_MUCH_PUNCT, regex=True, na=False)

    out = pt.loc[bad, ["effective_person_id","person_canon","source"]].copy()
    if len(out):
        p = write_csv(out, "qc04_presentability_persons_truth_failures.csv")
        fail(f"QC04 FAIL: {len(out)} non-presentable Persons_Truth rows. See {p}")
    ok("QC04 OK")

if __name__ == "__main__":
    main()
