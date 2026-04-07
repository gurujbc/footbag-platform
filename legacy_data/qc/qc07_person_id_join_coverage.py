from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pandas as pd
from qc_common import load_csv, write_csv, fail, ok, PLACEMENTS, PERSONS

# Load 04_build_analytics as build_analytics (module name not valid for plain import)
_build_analytics_path = Path(__file__).resolve().parent / "04_build_analytics.py"
_spec = importlib.util.spec_from_file_location("build_analytics", _build_analytics_path)
_bam = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_bam)
clean_person_label_no_guess = _bam.clean_person_label_no_guess
is_presentable_person_canon = _bam.is_presentable_person_canon

_RE_BAD_SEP = re.compile(r"[+=\\|]")
_RE_RANK = re.compile(r"\b\d+\.\s+\S")
_RE_DBLSPACE = re.compile(r"\s{2,}")


def is_presentable_value(s: str) -> bool:
    """Match QC03 presentability (minimal): reject separators, rank fragments, and double spaces."""
    if not isinstance(s, str):
        return False
    t = s.strip()
    if not t:
        return False
    if _RE_BAD_SEP.search(t):
        return False
    if _RE_RANK.search(t):
        return False
    if _RE_DBLSPACE.search(t):
        return False
    return True


def canon_key(raw: str) -> str:
    raw = str(raw or "").strip()
    if not raw:
        return ""
    cleaned, _reason = clean_person_label_no_guess(raw)
    return (cleaned or raw).strip()


def main() -> None:
    pl = load_csv(PLACEMENTS)
    pt = load_csv(PERSONS)

    if "person_canon" not in pt.columns:
        fail("Persons_Truth missing person_canon")

    truth_canons = set(pt["person_canon"].astype(str).map(canon_key))
    truth_canons.discard("")

    missing_rows = []

    # Placements_ByPerson schema: player*_person_canon + player*_name
    pairs = [
        ("player1_person_canon", "player1_name"),
        ("player2_person_canon", "player2_name"),
    ]

    for canon_col, name_col in pairs:
        if canon_col not in pl.columns:
            continue

        canon_s = pl[canon_col].astype(str).map(canon_key)
        name_s = pl[name_col].astype(str) if name_col in pl.columns else pd.Series([""] * len(pl))

        m = (canon_s != "") & (~canon_s.isin(truth_canons)) \
            & (name_s.map(is_presentable_value)) \
            & (canon_s.map(is_presentable_person_canon))

        if m.any():
            t = pl.loc[m, ["event_id", "year", "division_canon", "place", name_col, canon_col]].copy()
            t.rename(columns={name_col: "name", canon_col: "canon"}, inplace=True)
            t["which"] = canon_col
            missing_rows.append(t)

    out = pd.concat(missing_rows, ignore_index=True) if missing_rows else pd.DataFrame()
    if len(out):
        p = write_csv(out, "qc07_person_canon_join_coverage_failures.csv")
        fail(f"QC07 FAIL: {len(out)} presentable canon values not in Persons_Truth. See {p}")

    ok("QC07 OK")

if __name__ == "__main__":
    main()
