#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]

CLUB_CANDIDATES_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "legacy_club_candidates.csv"
AFFILIATIONS_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "legacy_person_club_affiliations.csv"

OUT_DIR = REPO_ROOT / "legacy_data" / "clubs" / "out"
OUT_CSV = OUT_DIR / "club_bootstrap_leaders.csv"


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def norm_text(x: str) -> str:
    return " ".join(str(x).strip().split())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    clubs = pd.read_csv(CLUB_CANDIDATES_CSV, dtype=str).fillna("")
    aff = pd.read_csv(AFFILIATIONS_CSV, dtype=str).fillna("")

    require_columns(
        clubs,
        {"club_key", "name", "bootstrap_eligible", "confidence_score"},
        "legacy_club_candidates.csv",
    )
    require_columns(
        aff,
        {
            "club_key",
            "matched_person_id",
            "matched_person_name",
            "mirror_member_id",
            "match_status",
            "linkable_for_clubs",
            "affiliation_confidence_score",
        },
        "legacy_person_club_affiliations.csv",
    )

    clubs = clubs.copy()
    clubs["club_key"] = clubs["club_key"].map(norm_text)
    clubs["bootstrap_eligible"] = pd.to_numeric(clubs["bootstrap_eligible"], errors="coerce").fillna(0).astype(int)
    clubs["confidence_score"] = pd.to_numeric(clubs["confidence_score"], errors="coerce").fillna(0.0)

    aff = aff.copy()
    aff["club_key"] = aff["club_key"].map(norm_text)
    aff["linkable_for_clubs"] = pd.to_numeric(aff["linkable_for_clubs"], errors="coerce").fillna(0).astype(int)
    aff["affiliation_confidence_score"] = pd.to_numeric(
        aff["affiliation_confidence_score"], errors="coerce"
    ).fillna(0.0)
    aff["has_mirror_member_id"] = aff["mirror_member_id"].astype(str).str.strip().ne("").astype(int)

    eligible_clubs = clubs[clubs["bootstrap_eligible"] == 1].copy()
    eligible_keys = set(eligible_clubs["club_key"])

    aff = aff[
        aff["club_key"].isin(eligible_keys)
        & (aff["match_status"] == "MATCHED")
        & (aff["linkable_for_clubs"] == 1)
        & aff["matched_person_id"].astype(str).str.strip().ne("")
    ].copy()

    if aff.empty:
        out = pd.DataFrame(
            columns=[
                "club_key",
                "club_name",
                "person_id",
                "person_name",
                "mirror_member_id",
                "role",
                "status",
                "affiliation_confidence_score",
                "club_confidence_score",
                "selection_rank",
                "selection_reason",
            ]
        )
        out.to_csv(OUT_CSV, index=False)
        print(f"Wrote 0 rows to {OUT_CSV}")
        return

    club_meta = eligible_clubs[["club_key", "name", "confidence_score"]].copy()
    club_meta.rename(columns={"name": "club_name", "confidence_score": "club_confidence_score"}, inplace=True)

    # legacy_person_club_affiliations.csv already has club_name; merging club_meta would
    # duplicate the column and pandas renames to club_name_x / club_name_y.
    aff = aff.drop(columns=["club_name"], errors="ignore")
    aff = aff.merge(club_meta, on="club_key", how="left")

    # Count matched+linkable candidate rows per club for co-leader eligibility
    candidate_counts = (
        aff.groupby("club_key", dropna=False)
        .size()
        .reset_index(name="matched_linkable_candidate_count")
    )
    aff = aff.merge(candidate_counts, on="club_key", how="left")

    # Rank candidates within club
    aff = aff.sort_values(
        by=[
            "club_key",
            "affiliation_confidence_score",
            "has_mirror_member_id",
            "matched_person_name",
            "matched_person_id",
        ],
        ascending=[True, False, False, True, True],
        kind="stable",
    ).reset_index(drop=True)

    rows = []

    for club_key, group in aff.groupby("club_key", sort=False):
        group = group.reset_index(drop=True)
        top = group.iloc[0]

        rows.append({
            "club_key": club_key,
            "club_name": top["club_name"],
            "person_id": top["matched_person_id"],
            "person_name": top["matched_person_name"],
            "mirror_member_id": top["mirror_member_id"],
            "role": "leader",
            "status": "provisional",
            "affiliation_confidence_score": round(float(top["affiliation_confidence_score"]), 4),
            "club_confidence_score": round(float(top["club_confidence_score"]), 4),
            "selection_rank": 1,
            "selection_reason": "top_matched_linkable_affiliation",
        })

        # Optional co-leader rule
        if len(group) >= 2:
            second = group.iloc[1]
            enough_candidates = int(top["matched_linkable_candidate_count"]) >= 5
            tied_top_score = float(second["affiliation_confidence_score"]) == float(top["affiliation_confidence_score"])

            if enough_candidates and tied_top_score:
                rows.append({
                    "club_key": club_key,
                    "club_name": second["club_name"],
                    "person_id": second["matched_person_id"],
                    "person_name": second["matched_person_name"],
                    "mirror_member_id": second["mirror_member_id"],
                    "role": "co_leader",
                    "status": "provisional",
                    "affiliation_confidence_score": round(float(second["affiliation_confidence_score"]), 4),
                    "club_confidence_score": round(float(second["club_confidence_score"]), 4),
                    "selection_rank": 2,
                    "selection_reason": "tied_top_score_with_sufficient_depth",
                })

    out = pd.DataFrame(rows)

    out = out.sort_values(
        by=["club_key", "selection_rank", "person_name", "person_id"],
        ascending=[True, True, True, True],
        kind="stable",
    ).reset_index(drop=True)

    out.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(out):,} rows to {OUT_CSV}")
    print()
    print("Summary:")
    print(f"  clubs with leaders:      {out['club_key'].nunique():,}")
    print(f"  leader rows:             {(out['role'] == 'leader').sum():,}")
    print(f"  co_leader rows:          {(out['role'] == 'co_leader').sum():,}")
    print(f"  provisional assignments: {(out['status'] == 'provisional').sum():,}")


if __name__ == "__main__":
    main()
