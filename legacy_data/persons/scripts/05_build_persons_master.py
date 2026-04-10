#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path
import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[3]

CANONICAL_PERSONS_CSV = REPO_ROOT / "legacy_data" / "event_results" / "canonical_input" / "persons.csv"
# Optional: full promoted sheet if you materialize it; otherwise built from candidates + links below.
PROMOTED_CANDIDATES_CSV = REPO_ROOT / "legacy_data" / "persons" / "provisional" / "out" / "provisional_identity_candidates_promoted.csv"
IDENTITY_CANDIDATES_CSV = REPO_ROOT / "legacy_data" / "persons" / "provisional" / "out" / "provisional_identity_candidates.csv"
PROMOTED_LINKS_CSV = REPO_ROOT / "legacy_data" / "persons" / "provisional" / "out" / "provisional_promoted_links.csv"

OUT_DIR = REPO_ROOT / "legacy_data" / "persons" / "out"
OUT_CSV = OUT_DIR / "persons_master.csv"


def norm_text(x: str) -> str:
    return " ".join(str(x).strip().split())


def norm_name(x: str) -> str:
    return norm_text(x).lower().replace("-", " ")


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def pick_person_name_col(df: pd.DataFrame) -> str:
    for col in ["person_name", "person_canon", "name"]:
        if col in df.columns:
            return col
    raise ValueError(
        f"canonical persons.csv must contain one of ['person_name', 'person_canon', 'name']; found {list(df.columns)}"
    )


def stable_master_person_id(name_norm: str, source_types: str) -> str:
    digest = hashlib.sha1(f"master|{source_types}|{name_norm}".encode("utf-8")).hexdigest()[:16]
    return f"master_person::{digest}"


def build_canonical_rows(df: pd.DataFrame) -> pd.DataFrame:
    source_name_col = pick_person_name_col(df)

    out = df.copy()

    out["person_id"] = out["person_id"].fillna("").astype(str)
    out["person_name"] = out[source_name_col].fillna("").astype(str).map(norm_text)
    out["person_name_norm"] = out["person_name"].map(norm_name)

    # Normalize common optional columns if present; create if absent
    defaults = {
        "ifpa_member_id": "",
        "country": "",
        "first_year": "",
        "last_year": "",
        "bap_member": "",
        "bap_nickname": "",
        "bap_induction_year": "",
        "hof_member": "",
        "hof_induction_year": "",
    }
    for col, default in defaults.items():
        if col not in out.columns:
            out[col] = default
        out[col] = out[col].fillna("").astype(str)

    out["master_person_id"] = out["person_id"]
    out["person_type"] = "CANONICAL"
    out["source_types"] = "RESULTS"
    out["promotion_status"] = "CANONICAL"
    out["matched_historical_person_id"] = out["person_id"]
    out["matched_historical_person_name"] = out["person_name"]
    out["legacy_member_id"] = out["ifpa_member_id"]
    out["legacy_user_id"] = ""
    out["legacy_email"] = ""
    out["confidence"] = "high"

    keep_cols = [
        "master_person_id",
        "person_id",
        "person_name",
        "person_name_norm",
        "person_type",
        "source_types",
        "promotion_status",
        "matched_historical_person_id",
        "matched_historical_person_name",
        "legacy_member_id",
        "legacy_user_id",
        "legacy_email",
        "ifpa_member_id",
        "country",
        "first_year",
        "last_year",
        "bap_member",
        "bap_nickname",
        "bap_induction_year",
        "hof_member",
        "hof_induction_year",
        "confidence",
    ]
    return out[keep_cols].copy()


def build_provisional_rows(candidates: pd.DataFrame, promoted_links: pd.DataFrame) -> pd.DataFrame:
    require_columns(
        candidates,
        {
            "provisional_identity_id",
            "canonical_candidate_name",
            "canonical_candidate_name_norm",
            "source_types",
            "staged_row_count",
            "membership_row_count",
            "club_row_count",
            "mirror_member_id_count",
            "confidence",
            "promotion_status",
            "matched_historical_person_id",
            "matched_historical_person_name",
            "match_status",
            "match_rule",
            "match_score",
            "candidate_count",
            "review_needed",
        },
        "provisional_identity_candidates_promoted.csv",
    )

    if not promoted_links.empty:
        require_columns(
            promoted_links,
            {
                "provisional_identity_id",
                "matched_historical_person_id",
                "matched_historical_person_name",
                "match_status",
                "match_rule",
                "match_score",
            },
            "provisional_promoted_links.csv",
        )

    out = candidates.copy()

    out["canonical_candidate_name"] = out["canonical_candidate_name"].fillna("").astype(str).map(norm_text)
    out["canonical_candidate_name_norm"] = out["canonical_candidate_name_norm"].fillna("").astype(str).map(norm_name)
    out["source_types"] = out["source_types"].fillna("").astype(str).map(norm_text)
    out["confidence"] = out["confidence"].fillna("").astype(str).map(norm_text)
    out["promotion_status"] = out["promotion_status"].fillna("").astype(str).map(norm_text)

    # Fill linked historical info from promoted links if available
    if not promoted_links.empty:
        promoted_links2 = promoted_links[
            [
                "provisional_identity_id",
                "matched_historical_person_id",
                "matched_historical_person_name",
            ]
        ].drop_duplicates(subset=["provisional_identity_id"], keep="first")
        out = out.merge(
            promoted_links2,
            on="provisional_identity_id",
            how="left",
            suffixes=("", "_linked"),
        )

        for target in ["matched_historical_person_id", "matched_historical_person_name"]:
            linked_col = f"{target}_linked"
            out[target] = out[linked_col].where(
                out[linked_col].fillna("").astype(str).str.strip().ne(""),
                out[target],
            )
            out.drop(columns=[linked_col], inplace=True)

    # Only unmatched or review-needed provisional rows should become standalone master persons.
    # MATCHED_TO_HISTORICAL rows are represented by canonical rows and should not be duplicated.
    out = out[out["promotion_status"].isin(["STAGED", "REVIEW_REQUIRED"])].copy()

    out["master_person_id"] = out.apply(
        lambda r: stable_master_person_id(
            r["canonical_candidate_name_norm"], r["source_types"]
        ),
        axis=1,
    )

    out["person_id"] = ""  # no canonical person_id yet
    out["person_name"] = out["canonical_candidate_name"]
    out["person_name_norm"] = out["canonical_candidate_name_norm"]
    out["person_type"] = "PROVISIONAL"

    out["legacy_member_id"] = ""
    out["legacy_user_id"] = ""
    out["legacy_email"] = ""
    out["ifpa_member_id"] = ""
    out["country"] = ""
    out["first_year"] = ""
    out["last_year"] = ""
    out["bap_member"] = ""
    out["bap_nickname"] = ""
    out["bap_induction_year"] = ""
    out["hof_member"] = ""
    out["hof_induction_year"] = ""

    keep_cols = [
        "master_person_id",
        "person_id",
        "person_name",
        "person_name_norm",
        "person_type",
        "source_types",
        "promotion_status",
        "matched_historical_person_id",
        "matched_historical_person_name",
        "legacy_member_id",
        "legacy_user_id",
        "legacy_email",
        "ifpa_member_id",
        "country",
        "first_year",
        "last_year",
        "bap_member",
        "bap_nickname",
        "bap_induction_year",
        "hof_member",
        "hof_induction_year",
        "confidence",
    ]
    return out[keep_cols].copy()


def load_promoted_candidates() -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Return (candidates_df, promoted_links_df) for build_provisional_rows.

    Prefer explicit provisional_identity_candidates_promoted.csv when present.
    Otherwise merge provisional_identity_candidates.csv with provisional_promoted_links.csv
    (outputs of provisional/scripts 02 and 04) and default columns the reconcile pipeline
    does not emit yet.
    """
    if PROMOTED_CANDIDATES_CSV.exists():
        promoted_candidates = pd.read_csv(PROMOTED_CANDIDATES_CSV, dtype=str).fillna("")
        if PROMOTED_LINKS_CSV.exists():
            promoted_links = pd.read_csv(PROMOTED_LINKS_CSV, dtype=str).fillna("")
        else:
            promoted_links = pd.DataFrame()
        return promoted_candidates, promoted_links

    if not IDENTITY_CANDIDATES_CSV.exists():
        raise FileNotFoundError(
            "Missing provisional identity inputs: need either "
            f"{PROMOTED_CANDIDATES_CSV} or {IDENTITY_CANDIDATES_CSV}"
        )

    cand = pd.read_csv(IDENTITY_CANDIDATES_CSV, dtype=str).fillna("")
    if PROMOTED_LINKS_CSV.exists():
        links = pd.read_csv(PROMOTED_LINKS_CSV, dtype=str).fillna("")
        link_fields = [
            "match_status",
            "matched_historical_person_id",
            "matched_historical_person_name",
            "promotion_status",
        ]
        have = [c for c in link_fields if c in links.columns]
        if have:
            links_sub = links[["provisional_identity_id"] + have].drop_duplicates(
                subset=["provisional_identity_id"], keep="first"
            )
            drop_from_cand = [c for c in have if c in cand.columns]
            cand_m = cand.drop(columns=drop_from_cand, errors="ignore")
            promoted_candidates = cand_m.merge(links_sub, on="provisional_identity_id", how="left")
        else:
            promoted_candidates = cand
    else:
        promoted_candidates = cand

    promoted_candidates = promoted_candidates.fillna("")
    for col, default in [
        ("match_status", ""),
        ("matched_historical_person_id", ""),
        ("matched_historical_person_name", ""),
        ("match_rule", ""),
        ("match_score", ""),
        ("candidate_count", ""),
        ("review_needed", ""),
    ]:
        if col not in promoted_candidates.columns:
            promoted_candidates[col] = default

    # Merged above; avoid second merge inside build_provisional_rows.
    return promoted_candidates, pd.DataFrame()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not CANONICAL_PERSONS_CSV.exists():
        raise FileNotFoundError(f"Missing canonical persons file: {CANONICAL_PERSONS_CSV}")

    promoted_candidates, promoted_links = load_promoted_candidates()

    canonical = pd.read_csv(CANONICAL_PERSONS_CSV, dtype=str).fillna("")

    canonical_rows = build_canonical_rows(canonical)
    provisional_rows = build_provisional_rows(promoted_candidates, promoted_links)

    final_df = pd.concat([canonical_rows, provisional_rows], ignore_index=True)

    final_df = final_df.sort_values(
        by=["person_type", "person_name_norm", "master_person_id"],
        ascending=[True, True, True],
        kind="stable",
    ).reset_index(drop=True)

    final_df.to_csv(OUT_CSV, index=False)

    canonical_count = int((final_df["person_type"] == "CANONICAL").sum())
    provisional_count = int((final_df["person_type"] == "PROVISIONAL").sum())
    review_required_count = int((final_df["promotion_status"] == "REVIEW_REQUIRED").sum())
    staged_count = int((final_df["promotion_status"] == "STAGED").sum())

    print(f"Wrote {len(final_df):,} rows to {OUT_CSV}")
    print()
    print("Breakdown:")
    print(f"  canonical persons:      {canonical_count:,}")
    print(f"  provisional persons:    {provisional_count:,}")
    print(f"  review-required rows:   {review_required_count:,}")
    print(f"  staged rows:            {staged_count:,}")


if __name__ == "__main__":
    main()
