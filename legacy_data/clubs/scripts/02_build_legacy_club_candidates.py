#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]

CLUBS_CSV = REPO_ROOT / "legacy_data" / "seed" / "clubs.csv"
CLUB_MEMBERS_CSV = REPO_ROOT / "legacy_data" / "seed" / "club_members.csv"
PERSON_UNIVERSE_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "persons_enriched_for_clubs.csv"

OUT_DIR = REPO_ROOT / "legacy_data" / "clubs" / "out"
OUT_CSV = OUT_DIR / "legacy_club_candidates.csv"


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def norm_text(x: str) -> str:
    return " ".join(str(x).strip().split())


def norm_name(x: str) -> str:
    return norm_text(x).lower().replace("-", " ")


def infer_club_key(clubs: pd.DataFrame, members: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    # Preferred explicit key pairs
    key_pairs = [
        ("club_id", "club_id"),
        ("club_slug", "club_slug"),
        ("club_key", "club_key"),
        ("legacy_club_key", "legacy_club_key"),
        ("name", "club_name"),
        ("name", "club"),
        ("name", "club_title"),
        ("name", "source_club"),
        ("name", "club_label"),
        ("name", "name"),
    ]

    clubs = clubs.copy()
    members = members.copy()

    for clubs_col, members_col in key_pairs:
        if clubs_col in clubs.columns and members_col in members.columns:
            if clubs_col == "name":
                clubs["_club_key"] = clubs[clubs_col].map(norm_name)
            else:
                clubs["_club_key"] = clubs[clubs_col].map(norm_text)

            if members_col in {"club_name", "club", "club_title", "source_club", "club_label", "name"}:
                members["_club_key"] = members[members_col].map(norm_name)
            else:
                members["_club_key"] = members[members_col].map(norm_text)

            return clubs, members, f"{clubs_col} <-> {members_col}"

    print("\nclubs.csv columns:")
    for c in clubs.columns:
        print(f"  {c}")

    print("\nclub_members.csv columns:")
    for c in members.columns:
        print(f"  {c}")

    raise ValueError(
        "Could not find a shared club key between clubs.csv and club_members.csv. "
        "See printed column lists above and map the correct columns."
    )


def pick_member_name_col(df: pd.DataFrame) -> str:
    for col in ["display_name", "alias", "member_name", "person_name", "name"]:
        if col in df.columns:
            return col
    raise ValueError("club_members.csv needs a member name column such as display_name/alias/member_name/name")


def compute_member_link_stats(club_members: pd.DataFrame, person_universe: pd.DataFrame) -> pd.DataFrame:
    member_name_col = pick_member_name_col(club_members)

    cm = club_members.copy()
    cm["member_name_norm"] = cm[member_name_col].map(norm_name)

    pu = person_universe.copy()
    require_columns(
        pu,
        {"person_name_norm", "linkable_for_clubs"},
        "persons_enriched_for_clubs.csv",
    )

    pu_match = pu[["person_name_norm", "linkable_for_clubs"]].copy()
    pu_match["linkable_for_clubs"] = pd.to_numeric(
        pu_match["linkable_for_clubs"], errors="coerce"
    ).fillna(0).astype(int)

    cm = cm.merge(
        pu_match,
        left_on="member_name_norm",
        right_on="person_name_norm",
        how="left",
    )
    cm = cm.drop(columns=["person_name_norm"], errors="ignore")
    cm["linkable_for_clubs"] = cm["linkable_for_clubs"].fillna(0).astype(int)

    if "mirror_member_id" in cm.columns:
        cm["has_mirror_member_id"] = cm["mirror_member_id"].fillna("").astype(str).str.strip().ne("").astype(int)
    else:
        cm["has_mirror_member_id"] = 0

    grouped = cm.groupby("_club_key", dropna=False).agg(
        member_rows=("member_name_norm", "size"),
        unique_member_names=("member_name_norm", "nunique"),
        mirror_member_id_count=("has_mirror_member_id", "sum"),
        linkable_member_count=("linkable_for_clubs", "sum"),
    ).reset_index()

    return grouped


def score_club(row: pd.Series) -> float:
    score = 0.0

    # baseline: has name + country
    if row["has_name"] and row["has_country"]:
        score += 0.40

    if row["has_city"]:
        score += 0.10
    if row["has_contact_email"]:
        score += 0.15
    if row["has_description"]:
        score += 0.05
    if row["has_external_url"]:
        score += 0.05

    if row["linkable_member_count"] >= 1:
        score += 0.15
    if row["linkable_member_count"] >= 5:
        score += 0.05
    if row["linkable_member_count"] >= 20:
        score += 0.05

    return min(score, 1.0)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not CLUBS_CSV.exists():
        raise FileNotFoundError(f"Missing clubs.csv: {CLUBS_CSV}")
    if not CLUB_MEMBERS_CSV.exists():
        raise FileNotFoundError(f"Missing club_members.csv: {CLUB_MEMBERS_CSV}")
    if not PERSON_UNIVERSE_CSV.exists():
        raise FileNotFoundError(f"Missing person universe: {PERSON_UNIVERSE_CSV}")

    clubs = pd.read_csv(CLUBS_CSV, dtype=str).fillna("")
    club_members = pd.read_csv(CLUB_MEMBERS_CSV, dtype=str).fillna("")
    person_universe = pd.read_csv(PERSON_UNIVERSE_CSV, dtype=str).fillna("")

    require_columns(clubs, {"name", "country"}, "clubs.csv")

    clubs, club_members, key_source = infer_club_key(clubs, club_members)

    member_stats = compute_member_link_stats(club_members, person_universe)

    df = clubs.merge(member_stats, on="_club_key", how="left")

    for col in ["member_rows", "unique_member_names", "mirror_member_id_count", "linkable_member_count"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

    df["has_name"] = df["name"].map(norm_text).ne("")
    df["has_country"] = df["country"].map(norm_text).ne("")
    df["has_city"] = df["city"].map(norm_text).ne("") if "city" in df.columns else False
    df["has_contact_email"] = df["contact_email"].map(norm_text).ne("") if "contact_email" in df.columns else False
    df["has_description"] = df["description"].map(norm_text).ne("") if "description" in df.columns else False
    df["has_external_url"] = df["external_url"].map(norm_text).ne("") if "external_url" in df.columns else False

    df["confidence_score"] = df.apply(score_club, axis=1).round(4)
    df["bootstrap_eligible"] = (
        (df["confidence_score"] >= 0.55) &
        (df["mirror_member_id_count"] >= 1) &
        (df["linkable_member_count"] >= 1)
    ).astype(int)

    # stable output columns
    out_cols = []

    if "club_id" in df.columns:
        out_cols.append("club_id")
    out_cols += [
        "_club_key",
        "name",
    ]
    for optional in ["city", "country", "contact_email", "external_url", "description", "created", "last_updated"]:
        if optional in df.columns:
            out_cols.append(optional)

    out_cols += [
        "member_rows",
        "unique_member_names",
        "mirror_member_id_count",
        "linkable_member_count",
        "confidence_score",
        "bootstrap_eligible",
    ]

    out = df[out_cols].copy()
    out.rename(columns={"_club_key": "club_key"}, inplace=True)

    out.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(out):,} rows to {OUT_CSV}")
    print()
    print("Summary:")
    print(f"  bootstrap eligible: {int(out['bootstrap_eligible'].sum()):,}")
    print(f"  confidence >= 0.55: {int((out['confidence_score'] >= 0.55).sum()):,}")
    print(f"  with mirror_member_id_count >= 1: {int((out['mirror_member_id_count'] >= 1).sum()):,}")
    print(f"  with linkable_member_count >= 1: {int((out['linkable_member_count'] >= 1).sum()):,}")
    print()
    print(f"Club key source: {key_source}")


if __name__ == "__main__":
    main()
