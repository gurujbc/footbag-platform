#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]

CLUB_CANDIDATES_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "legacy_club_candidates.csv"
CLUB_MEMBERS_CSV = REPO_ROOT / "legacy_data" / "seed" / "club_members.csv"
PERSON_UNIVERSE_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "persons_enriched_for_clubs.csv"

OUT_DIR = REPO_ROOT / "legacy_data" / "clubs" / "out"
OUT_CSV = OUT_DIR / "legacy_person_club_affiliations.csv"


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def norm_text(x: str) -> str:
    return " ".join(str(x).strip().split())


def norm_name(x: str) -> str:
    return norm_text(x).lower().replace("-", " ")


def pick_member_name_col(df: pd.DataFrame) -> str:
    for col in ["display_name", "alias", "member_name", "person_name", "name"]:
        if col in df.columns:
            return col
    raise ValueError("club_members.csv needs a member name column such as display_name/alias/member_name/name")


def build_person_index(persons: pd.DataFrame) -> dict[str, list[dict]]:
    idx: dict[str, list[dict]] = {}

    for _, row in persons.iterrows():
        rec = row.to_dict()
        key = rec.get("person_name_norm", "")
        if not key:
            continue
        idx.setdefault(key, []).append(rec)

    return idx


def compute_affiliation_score(has_mirror_member_id: bool, matched_person_id: str) -> float:
    score = 0.50
    if has_mirror_member_id:
        score += 0.20
    if str(matched_person_id).strip():
        score += 0.20
    return min(score, 1.0)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    club_candidates = pd.read_csv(CLUB_CANDIDATES_CSV, dtype=str).fillna("")
    club_members = pd.read_csv(CLUB_MEMBERS_CSV, dtype=str).fillna("")
    persons = pd.read_csv(PERSON_UNIVERSE_CSV, dtype=str).fillna("")

    require_columns(club_candidates, {"club_key", "name"}, "legacy_club_candidates.csv")
    require_columns(persons, {"person_id", "person_name", "person_name_norm", "linkable_for_clubs"}, "persons_enriched_for_clubs.csv")
    require_columns(club_members, {"legacy_club_key"}, "club_members.csv")

    member_name_col = pick_member_name_col(club_members)

    cm = club_members.copy()
    cm["club_key"] = cm["legacy_club_key"].map(norm_text)
    cm["member_name_raw"] = cm[member_name_col].fillna("").astype(str).str.strip()
    cm["member_name_norm"] = cm["member_name_raw"].map(norm_name)

    if "mirror_member_id" not in cm.columns:
        cm["mirror_member_id"] = ""

    person_idx = build_person_index(persons)

    clubs_min = club_candidates[["club_key", "name"]].copy()
    clubs_min.rename(columns={"name": "club_name"}, inplace=True)
    clubs_min["club_key"] = clubs_min["club_key"].map(norm_text)

    rows = []

    for _, row in cm.iterrows():
        member_name_norm = row["member_name_norm"]
        alias_norm = norm_name(row.get("alias", ""))

        candidates = person_idx.get(member_name_norm, [])
        if not candidates and alias_norm:
            candidates = person_idx.get(alias_norm, [])

        matched_person_id = ""
        matched_person_name = ""
        linkable_for_clubs = 0
        match_status = "NO_MATCH"

        if len(candidates) == 1:
            c = candidates[0]
            matched_person_id = c.get("person_id", "")
            matched_person_name = c.get("person_name", "")
            linkable_for_clubs = int(float(c.get("linkable_for_clubs", 0) or 0))
            match_status = "MATCHED"
        elif len(candidates) > 1:
            match_status = "CONFLICT"

        has_mirror_member_id = str(row.get("mirror_member_id", "")).strip() != ""
        score = compute_affiliation_score(has_mirror_member_id, matched_person_id)

        rows.append({
            "club_key": row["club_key"],
            "mirror_member_id": row.get("mirror_member_id", ""),
            "display_name": row.get("display_name", ""),
            "alias": row.get("alias", ""),
            "member_name_raw": row["member_name_raw"],
            "member_name_norm": member_name_norm,
            "matched_person_id": matched_person_id,
            "matched_person_name": matched_person_name,
            "linkable_for_clubs": linkable_for_clubs,
            "match_status": match_status,
            "affiliation_confidence_score": round(score, 4),
            "inferred_role": "member",
        })

    out = pd.DataFrame(rows)
    out = out.merge(clubs_min, on="club_key", how="left")

    out = out[
        [
            "club_key",
            "club_name",
            "mirror_member_id",
            "display_name",
            "alias",
            "member_name_raw",
            "member_name_norm",
            "matched_person_id",
            "matched_person_name",
            "linkable_for_clubs",
            "match_status",
            "affiliation_confidence_score",
            "inferred_role",
        ]
    ].copy()

    out.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(out):,} rows to {OUT_CSV}")
    print()
    print("Summary:")
    print(f"  matched:   {int((out['match_status'] == 'MATCHED').sum()):,}")
    print(f"  conflict:  {int((out['match_status'] == 'CONFLICT').sum()):,}")
    print(f"  no match:  {int((out['match_status'] == 'NO_MATCH').sum()):,}")
    print(f"  linkable:  {int((pd.to_numeric(out['linkable_for_clubs'], errors='coerce').fillna(0) == 1).sum()):,}")


if __name__ == "__main__":
    main()
