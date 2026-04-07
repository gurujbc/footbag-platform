#!/usr/bin/env python3
"""
pipeline/platform/build_platform_exports.py

Export out/canonical_all/*.csv → out/platform_release/*.csv in the schema
expected by footbag-platform script 08_load_mvfp_seed_full_to_sqlite.py.

This is the final step of the merged pipeline (run_pipeline.sh merged).

Coverage filter (applied inline):
  INCLUDE: FULL, PARTIAL, QUARANTINED
  EXCLUDE: SPARSE, NO RESULTS

Input:  out/canonical_all/
Output: out/platform_release/

Run:
    python pipeline/platform/build_platform_exports.py
    python pipeline/platform/build_platform_exports.py --output-dir /path/to/canonical_input
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "out" / "canonical_all"
DEFAULT_OUTPUT = ROOT / "out" / "platform_release"

INCLUDE_COVERAGE = {"FULL", "PARTIAL", "QUARANTINED"}


def compute_pub_eids(events: pd.DataFrame, results: pd.DataFrame,
                     discs: pd.DataFrame) -> set:
    """Return event_ids that meet publication coverage threshold."""
    plc_count  = Counter(results["event_id"])
    disc_count = Counter(discs["event_id"])
    pub = set()
    for _, ev in events.iterrows():
        eid    = ev["event_id"]
        np     = plc_count.get(eid, 0)
        nd     = disc_count.get(eid, 0)
        vs     = ev.get("validation_status", "")
        status = ev.get("status", "")
        if status == "no_results":
            cov = "NO RESULTS"
        elif vs in ("CONFIRMED_MULTI_SOURCE", "VERIFIED") and np >= 3:
            cov = "FULL"
        elif np >= 20 and nd >= 3:
            cov = "FULL"
        elif np >= 10 or nd >= 2:
            cov = "PARTIAL"
        elif np > 0:
            cov = "SPARSE"
        else:
            cov = "NO RESULTS"
        if cov in INCLUDE_COVERAGE:
            pub.add(eid)
    return pub


def load(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing: {path}")
    return pd.read_csv(path, dtype=str).fillna("")


def discipline_key(event_key: pd.Series, discipline: pd.Series) -> pd.Series:
    norm = discipline.astype(str).str.strip().str.lower()
    norm = norm.str.replace(r"\s+", "_", regex=True)
    return event_key.astype(str).str.strip() + "__" + norm


def export_events(df: pd.DataFrame) -> pd.DataFrame:
    ek = df["event_id"].str.strip()
    return pd.DataFrame({
        "event_key":       ek,
        "legacy_event_id": "",
        "year":            df["year"].str.strip(),
        "event_name":      df["event_name"].str.strip(),
        "event_slug":      ek,
        "start_date":      df["start_date"].str.strip(),
        "end_date":        df["end_date"].str.strip(),
        "city":            df["city"].str.strip(),
        "region":          df["region"].str.strip(),
        "country":         df["country"].str.strip(),
        "host_club":       df["host_club"].str.strip(),
        "status":          df["status"].str.strip(),
        "notes":           df.get("validation_status", pd.Series([""] * len(df))).str.strip(),
        "source":          df.get("data_source", pd.Series([""] * len(df))).str.strip(),
    }).sort_values(["year", "event_name", "event_key"], kind="stable")


def export_event_disciplines(df: pd.DataFrame) -> pd.DataFrame:
    ek = df["event_id"].str.strip()
    dk = discipline_key(ek, df["discipline"])
    out = pd.DataFrame({
        "event_key":          ek,
        "discipline_key":     dk,
        "discipline_name":    df["discipline_name"].str.strip(),
        "discipline_category": df["discipline_category"].str.strip(),
        "team_type":          df["team_type"].str.strip(),
        "sort_order":         df["sort_order"].str.strip(),
        "coverage_flag":      df["coverage_flag"].str.strip(),
        "notes":              df["notes"].str.strip(),
    })
    out = out.sort_values(["event_key", "discipline_key"], kind="stable")
    out = out.drop_duplicates(subset=["event_key", "discipline_key"], keep="first")
    return out


def export_event_results(df: pd.DataFrame) -> pd.DataFrame:
    ek = df["event_id"].astype(str).str.strip()
    dk = discipline_key(ek, df["discipline"])
    source = (
        df.get("source_type", pd.Series([""] * len(df))).astype(str).str.strip()
        + "|" +
        df.get("data_source", pd.Series([""] * len(df))).astype(str).str.strip()
    ).str.strip("|")
    out = pd.DataFrame({
        "event_key":      ek,
        "discipline_key": dk,
        "placement":      df["placement"].astype(str).str.strip(),
        "score_text":     df["score_text"].astype(str).str.strip(),
        "notes":          "",
        "source":         source,
    })
    # PRE1997 source sorts before POST1997 (F < P), keep PRE1997 when deduping
    n_before = len(out)
    out = out.sort_values(
        ["event_key", "discipline_key", "placement", "source"],
        ascending=[True, True, True, True],
        kind="stable",
    )
    out = out.drop_duplicates(subset=["event_key", "discipline_key", "placement"], keep="first")
    n_dupes = n_before - len(out)
    if n_dupes:
        print(f"  event_results: deduped {n_dupes} rows (PRE1997 kept where discipline names collide)")
    return out


_SENTINEL_NAMES = {"__NON_PERSON__", "[UNKNOWN PARTNER]", "__UNKNOWN_PARTNER__"}


def export_event_result_participants(df: pd.DataFrame) -> pd.DataFrame:
    ek = df["event_id"].astype(str).str.strip()
    dk = discipline_key(ek, df["discipline"])
    display = df["display_name"].astype(str).str.strip().replace(
        {s: "Unknown" for s in _SENTINEL_NAMES}
    )
    out = pd.DataFrame({
        "event_key":        ek,
        "discipline_key":   dk,
        "placement":        df["placement"].astype(str).str.strip(),
        "participant_order": df["participant_order"].astype(str).str.strip(),
        "display_name":     display,
        "person_id":        df["person_id"].astype(str).str.strip(),
        "team_person_key":  df["team_person_key"].astype(str).str.strip(),
        "notes":            "",
        "_data_source":     df.get("data_source", pd.Series([""] * len(df))).astype(str).str.strip(),
    })
    # PRE1997 > POST1997 alphabetically (R > O) — descending keeps PRE1997 first
    n_before = len(out)
    out = out.sort_values(
        ["event_key", "discipline_key", "placement", "participant_order", "_data_source"],
        ascending=[True, True, True, True, False],
        kind="stable",
    )
    out = out.drop_duplicates(
        subset=["event_key", "discipline_key", "placement", "participant_order"],
        keep="first",
    )
    n_dupes = n_before - len(out)
    if n_dupes:
        print(f"  event_result_participants: deduped {n_dupes} rows (PRE1997 kept)")
    return out.drop(columns=["_data_source"])


def _yn_to_bit(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.upper().map(lambda v: "1" if v == "Y" else "0")


def export_persons(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        "person_id":              df["person_id"].astype(str).str.strip(),
        "person_name":            df["person_canon"].astype(str).str.strip(),
        "country":                df["country"].astype(str).str.strip(),
        "first_year":             df["first_year"].astype(str).str.strip(),
        "last_year":              df["last_year"].astype(str).str.strip(),
        "event_count":            "",
        "placement_count":        "",
        "bap_member":             _yn_to_bit(df["bap_member"]),
        "bap_nickname":           df["bap_nickname"].astype(str).str.strip(),
        "bap_induction_year":     df["bap_induction_year"].astype(str).str.strip(),
        "hof_member":             _yn_to_bit(df["fbhof_member"]),
        "hof_induction_year":     df["fbhof_induction_year"].astype(str).str.strip(),
        "freestyle_sequences":    "",
        "freestyle_max_add":      "",
        "freestyle_unique_tricks": "",
        "freestyle_diversity_ratio": "",
        "signature_trick_1":      "",
        "signature_trick_2":      "",
        "signature_trick_3":      "",
    })
    out = out[out["person_name"].str.strip() != ""].copy()
    out["_sort_key"] = out["person_name"].str.lower()
    out = out.sort_values(["_sort_key", "person_id"], kind="stable")
    return out.drop(columns=["_sort_key"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir", default=str(DEFAULT_INPUT))
    ap.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    args = ap.parse_args()

    in_dir = Path(args.input_dir).expanduser().resolve()
    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load source tables
    events_raw  = load(in_dir / "events.csv")
    discs_raw   = load(in_dir / "event_disciplines.csv")
    results_raw = load(in_dir / "event_results.csv")
    parts_raw   = load(in_dir / "event_result_participants.csv")
    persons_raw = load(in_dir / "persons.csv")

    # Coverage filter — exclude SPARSE / NO RESULTS events
    pub_eids = compute_pub_eids(events_raw, results_raw, discs_raw)
    n_total  = len(events_raw)
    n_excl   = n_total - len(pub_eids)
    print(f"  Coverage filter: {len(pub_eids)} / {n_total} events included ({n_excl} SPARSE/NO RESULTS excluded)")

    events_f  = events_raw[events_raw["event_id"].isin(pub_eids)].copy()
    discs_f   = discs_raw[discs_raw["event_id"].isin(pub_eids)].copy()
    results_f = results_raw[results_raw["event_id"].isin(pub_eids)].copy()
    parts_f   = parts_raw[parts_raw["event_id"].isin(pub_eids)].copy()

    steps = [
        ("events.csv",                    events_f,   export_events),
        ("event_disciplines.csv",         discs_f,    export_event_disciplines),
        ("event_results.csv",             results_f,  export_event_results),
        ("event_result_participants.csv", parts_f,    export_event_result_participants),
        ("persons.csv",                   persons_raw, export_persons),
    ]

    for filename, df, fn in steps:
        out = fn(df)
        for col in out.columns:
            out[col] = out[col].fillna("").astype(str).replace({"nan": ""})
        dest = out_dir / filename
        out.to_csv(dest, index=False)
        print(f"  {filename}: {len(out):,} rows → {dest}")

    print(f"\nplatform_release/ ready for footbag-platform script 08.")


if __name__ == "__main__":
    main()
