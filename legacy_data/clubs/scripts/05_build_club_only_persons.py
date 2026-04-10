#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]

AFFILIATIONS_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "legacy_person_club_affiliations.csv"
OUT_DIR = REPO_ROOT / "legacy_data" / "clubs" / "out"
OUT_CSV = OUT_DIR / "club_only_persons.csv"


def norm_text(x: str) -> str:
    return " ".join(str(x).strip().split())


def norm_name(x: str) -> str:
    return norm_text(x).lower().replace("-", " ")


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not AFFILIATIONS_CSV.exists():
        raise FileNotFoundError(f"Missing affiliations file: {AFFILIATIONS_CSV}")

    df = pd.read_csv(AFFILIATIONS_CSV, dtype=str).fillna("")

    require_columns(
        df,
        {
            "club_key",
            "member_name_raw",
            "member_name_norm",
            "mirror_member_id",
            "match_status",
            "affiliation_confidence_score",
        },
        "legacy_person_club_affiliations.csv",
    )

    club_only = df[df["match_status"] == "NO_MATCH"].copy()

    if club_only.empty:
        out = pd.DataFrame(
            columns=[
                "club_key",
                "person_name",
                "person_name_norm",
                "mirror_member_id",
                "confidence",
            ]
        )
        out.to_csv(OUT_CSV, index=False)
        print(f"Wrote 0 rows to {OUT_CSV}")
        return

    club_only["club_key"] = club_only["club_key"].map(norm_text)
    club_only["person_name"] = club_only["member_name_raw"].map(norm_text)
    club_only["person_name_norm"] = club_only["member_name_norm"].map(norm_name)
    club_only["mirror_member_id"] = club_only["mirror_member_id"].fillna("").astype(str).map(norm_text)

    club_only = club_only[club_only["person_name_norm"].ne("")].copy()

    club_only["affiliation_confidence_score_num"] = pd.to_numeric(
        club_only["affiliation_confidence_score"], errors="coerce"
    ).fillna(0.0)

    club_only = club_only.sort_values(
        by=["club_key", "person_name_norm", "affiliation_confidence_score_num"],
        ascending=[True, True, False],
        kind="stable",
    )

    club_only = club_only.drop_duplicates(
        subset=["club_key", "person_name_norm"],
        keep="first",
    )

    out = club_only[
        [
            "club_key",
            "person_name",
            "person_name_norm",
            "mirror_member_id",
            "affiliation_confidence_score",
        ]
    ].copy()

    out.rename(
        columns={"affiliation_confidence_score": "confidence"},
        inplace=True,
    )

    out = out.sort_values(
        by=["club_key", "person_name_norm"],
        ascending=[True, True],
        kind="stable",
    ).reset_index(drop=True)

    out.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(out):,} rows to {OUT_CSV}")
    print()
    print("Summary:")
    print(f"  unique club-only persons: {len(out):,}")
    print(f"  clubs represented:        {out['club_key'].nunique():,}")


if __name__ == "__main__":
    main()
