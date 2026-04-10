#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path
import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[3]

PERSONS_CSV = REPO_ROOT / "legacy_data" / "event_results" / "canonical_input" / "persons.csv"
MEMBERSHIP_LINKED_CSV = REPO_ROOT / "legacy_data" / "membership" / "out" / "membership_linked_persons.csv"
MEMBERSHIP_ONLY_CSV = REPO_ROOT / "legacy_data" / "membership" / "out" / "membership_only_persons.csv"

OUT_DIR = REPO_ROOT / "legacy_data" / "clubs" / "out"
OUT_CSV = OUT_DIR / "persons_enriched_for_clubs.csv"


def normalize_name(name: str) -> str:
    text = str(name).strip().lower()
    text = text.replace("-", " ")
    text = " ".join(text.split())
    return text


def stable_membership_only_id(name_norm: str) -> str:
    digest = hashlib.sha1(name_norm.encode("utf-8")).hexdigest()[:16]
    return f"membership_only::{digest}"


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def build_base_persons(df: pd.DataFrame) -> pd.DataFrame:
    source_name_col = None
    for col in ["person_name", "person_canon", "name"]:
        if col in df.columns:
            source_name_col = col
            break

    if source_name_col is None:
        raise ValueError(
            f"persons.csv must contain one of ['person_name', 'person_canon', 'name']; "
            f"found {list(df.columns)}"
        )

    out = df.copy()

    out["person_name"] = out[source_name_col].fillna("").astype(str).str.strip()
    out["person_name_norm"] = out["person_name"].map(normalize_name)

    # normalize likely canonical fields if missing
    for col in ["person_id", "ifpa_member_id", "country", "first_year", "last_year"]:
        if col not in out.columns:
            out[col] = ""

    out["membership_status"] = ""
    out["membership_expiration"] = ""
    out["membership_tier_provisional"] = ""

    out["source_results_person"] = 1
    out["source_membership_linked"] = 0
    out["source_membership_only"] = 0

    # Linkable now = has platform person row; stronger if it also has member anchor
    out["linkable_for_clubs"] = out["person_id"].astype(str).str.strip().ne("").astype(int)

    keep_cols = [
        "person_id",
        "person_name",
        "person_name_norm",
        "ifpa_member_id",
        "country",
        "first_year",
        "last_year",
        "membership_status",
        "membership_expiration",
        "membership_tier_provisional",
        "source_results_person",
        "source_membership_linked",
        "source_membership_only",
        "linkable_for_clubs",
    ]
    return out[keep_cols].copy()


def apply_membership_linked(base: pd.DataFrame, linked: pd.DataFrame) -> pd.DataFrame:
    require_columns(
        linked,
        {
            "person_id",
            "person_canon",
            "membership_name_raw",
            "membership_name_norm",
            "membership_status",
            "membership_expiration",
            "membership_tier_provisional",
        },
        "membership_linked_persons.csv",
    )

    linked2 = linked.copy()
    linked2["person_id"] = linked2["person_id"].fillna("").astype(str).str.strip()

    # prefer first row per person_id if duplicates
    linked2 = linked2.sort_values(
        by=["person_id", "membership_tier_provisional", "membership_expiration"],
        ascending=[True, False, False],
        kind="stable",
    )
    linked2 = linked2.drop_duplicates(subset=["person_id"], keep="first")

    merged = base.merge(
        linked2[
            [
                "person_id",
                "membership_status",
                "membership_expiration",
                "membership_tier_provisional",
            ]
        ],
        on="person_id",
        how="left",
        suffixes=("", "_linked"),
    )

    for target in ["membership_status", "membership_expiration", "membership_tier_provisional"]:
        linked_col = f"{target}_linked"
        merged[target] = merged[linked_col].where(
            merged[linked_col].fillna("").astype(str).str.strip().ne(""),
            merged[target],
        )
        merged.drop(columns=[linked_col], inplace=True)

    linked_person_ids = set(linked2["person_id"])
    merged["source_membership_linked"] = merged["person_id"].isin(linked_person_ids).astype(int)

    # if linked membership exists, definitely linkable
    merged["linkable_for_clubs"] = (
        (merged["linkable_for_clubs"] == 1) | (merged["source_membership_linked"] == 1)
    ).astype(int)

    return merged


def build_membership_only_rows(membership_only: pd.DataFrame) -> pd.DataFrame:
    require_columns(
        membership_only,
        {
            "person_name",
            "person_name_norm",
            "membership_status",
            "membership_expiration",
            "membership_tier_provisional",
        },
        "membership_only_persons.csv",
    )

    df = membership_only.copy()
    df["person_name"] = df["person_name"].fillna("").astype(str).str.strip()
    df["person_name_norm"] = df["person_name_norm"].fillna("").astype(str).map(normalize_name)

    df = df[df["person_name_norm"].ne("")].copy()
    df = df.drop_duplicates(subset=["person_name_norm"], keep="first")

    df["person_id"] = df["person_name_norm"].map(stable_membership_only_id)
    df["ifpa_member_id"] = ""
    df["country"] = ""
    df["first_year"] = ""
    df["last_year"] = ""

    df["source_results_person"] = 0
    df["source_membership_linked"] = 0
    df["source_membership_only"] = 1

    # Membership-only rows are useful for club universe, but not leader-linkable yet
    df["linkable_for_clubs"] = 0

    keep_cols = [
        "person_id",
        "person_name",
        "person_name_norm",
        "ifpa_member_id",
        "country",
        "first_year",
        "last_year",
        "membership_status",
        "membership_expiration",
        "membership_tier_provisional",
        "source_results_person",
        "source_membership_linked",
        "source_membership_only",
        "linkable_for_clubs",
    ]
    return df[keep_cols].copy()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not PERSONS_CSV.exists():
        raise FileNotFoundError(f"Missing canonical persons file: {PERSONS_CSV}")
    if not MEMBERSHIP_LINKED_CSV.exists():
        raise FileNotFoundError(f"Missing membership linked file: {MEMBERSHIP_LINKED_CSV}")
    if not MEMBERSHIP_ONLY_CSV.exists():
        raise FileNotFoundError(f"Missing membership-only file: {MEMBERSHIP_ONLY_CSV}")

    persons_raw = pd.read_csv(PERSONS_CSV, dtype=str).fillna("")
    membership_linked = pd.read_csv(MEMBERSHIP_LINKED_CSV, dtype=str).fillna("")
    membership_only = pd.read_csv(MEMBERSHIP_ONLY_CSV, dtype=str).fillna("")

    base = build_base_persons(persons_raw)
    enriched_base = apply_membership_linked(base, membership_linked)
    membership_only_rows = build_membership_only_rows(membership_only)

    # prevent appending a membership-only row if the normalized name already exists in base
    existing_norm_names = set(enriched_base["person_name_norm"])
    membership_only_rows = membership_only_rows[
        ~membership_only_rows["person_name_norm"].isin(existing_norm_names)
    ].copy()

    final_df = pd.concat([enriched_base, membership_only_rows], ignore_index=True)

    final_df = final_df.sort_values(
        by=["person_name_norm", "source_results_person", "source_membership_only"],
        ascending=[True, False, True],
        kind="stable",
    ).reset_index(drop=True)

    final_df.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(final_df):,} rows to {OUT_CSV}")
    print()
    print("Breakdown:")
    print(f"  results persons:         {int((final_df['source_results_person'] == 1).sum()):,}")
    print(f"  membership linked:       {int((final_df['source_membership_linked'] == 1).sum()):,}")
    print(f"  membership-only appended:{int((final_df['source_membership_only'] == 1).sum()):,}")
    print(f"  linkable_for_clubs:      {int((final_df['linkable_for_clubs'] == 1).sum()):,}")


if __name__ == "__main__":
    main()
