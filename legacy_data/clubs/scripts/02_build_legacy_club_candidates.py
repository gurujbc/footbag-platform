#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]

CLUBS_CSV = REPO_ROOT / "legacy_data" / "seed" / "clubs.csv"
CLUB_MEMBERS_CSV = REPO_ROOT / "legacy_data" / "seed" / "club_members.csv"
PERSON_UNIVERSE_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "persons_enriched_for_clubs.csv"
AFFILIATIONS_CSV = REPO_ROOT / "legacy_data" / "clubs" / "out" / "legacy_person_club_affiliations.csv"
EVENTS_CSV = REPO_ROOT / "legacy_data" / "out" / "canonical" / "events.csv"

OUT_DIR = REPO_ROOT / "legacy_data" / "clubs" / "out"
OUT_CSV = OUT_DIR / "legacy_club_candidates.csv"

# §10.1 classification thresholds. Kept as named constants so the rules
# read the same way they do in MIGRATION_PLAN §10.1.
ACTIVE_PLAYER_YEAR = 2020      # R1, R3, R4, R5, R8
RECENT_EDIT_YEAR = 2016        # R7
NEW_CLUB_YEAR = 2022           # R9
LARGE_MEMBER_COUNT = 10        # R10
KNOWN_PLAYER_COUNT = 3         # R10

# Small alias table for host_club text on events.csv that doesn't
# normalize-equal a clubs.csv name. Keys/values are already-normalized
# strings (via norm_name). Keeping this list tight and explicit so the
# mapping is auditable; only entries with an unambiguous clubs.csv
# counterpart are included. Each comment notes the raw source → target
# pair and why the default normalization misses it.
HOST_CLUB_ALIASES = {
    # "Rien N'est Hacky - RNH Footbag" vs "1. Rien N'est Hacky - RNH Footbag"
    # (clubs.csv prefixes a leading "1. ").
    "rien n'est hacky   rnh footbag":
        "1. rien n'est hacky   rnh footbag",
    # "Sole Purpose Footbag Club" vs "Sole Purpose" (clubs.csv omits suffix).
    "sole purpose footbag club":
        "sole purpose",
    # "Jyväskylän Footbag-klubi" vs "Jyväskylän Footbag-klubi, JFK"
    # (clubs.csv appends an acronym suffix).
    "jyväskylän footbag klubi":
        "jyväskylän footbag klubi, jfk",
    # "Missoula Footbag Alliance" vs "Missoula Footbag Alliance_"
    # (clubs.csv has a trailing underscore, likely a legacy artifact).
    "missoula footbag alliance":
        "missoula footbag alliance_",
    # "Hradec Kralove Footbag Club" vs "Hradec Králové Footbag Club"
    # (diacritic difference: norm_name does not strip accents).
    "hradec kralove footbag club":
        "hradec králové footbag club",
}


def require_columns(df: pd.DataFrame, required: set[str], label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing required columns: {sorted(missing)}")


def norm_text(x: str) -> str:
    return " ".join(str(x).strip().split())


def norm_name(x: str) -> str:
    return norm_text(x).lower().replace("-", " ")


def extract_year(timestamp_text: str) -> int | None:
    """
    Pull a 4-digit year out of a mirror CMS timestamp like
    "Sun Jan 15 10:16:52 2012". Returns None when no year is present.
    """
    if not timestamp_text:
        return None
    m = re.search(r"\b(19\d{2}|20\d{2})\b", str(timestamp_text))
    return int(m.group(1)) if m else None


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


def compute_hosted_events_by_club(events: pd.DataFrame, club_name_keys: pd.Series) -> pd.DataFrame:
    """
    Join canonical events.csv host_club text onto normalized club NAMES.
    Returns one row per _name_key with hosted_event_count, ever_hosted,
    and last_hosted_year.

    NOTE: events.csv carries host_club as raw text ("Bilbao Footbag Club",
    "WFA"). It has no legacy_club_key or numeric mirror club ID.
    infer_club_key() in this script may pick legacy_club_key (numeric)
    as the main join key when clubs.csv and club_members.csv share it,
    so we keep a separate name-based key (_name_key) just for this
    join. Hosts that are federations rather than physical clubs (WFA,
    NHSA) simply fail to match any clubs.csv row.
    """
    require_columns(events, {"host_club", "year"}, "events.csv")

    e = events[events["host_club"].map(norm_text).ne("")].copy()
    e["_name_key"] = e["host_club"].map(norm_name).replace(HOST_CLUB_ALIASES)
    e["year_int"] = pd.to_numeric(e["year"], errors="coerce")
    e = e.dropna(subset=["year_int"])
    e["year_int"] = e["year_int"].astype(int)

    agg = e.groupby("_name_key", dropna=False).agg(
        hosted_event_count=("year_int", "size"),
        last_hosted_year=("year_int", "max"),
    ).reset_index()

    # Outer join so clubs with zero hosted events appear as 0 / NaN.
    base = pd.DataFrame({"_name_key": club_name_keys.unique()})
    out = base.merge(agg, on="_name_key", how="left")
    out["hosted_event_count"] = out["hosted_event_count"].fillna(0).astype(int)
    out["ever_hosted"] = (out["hosted_event_count"] > 0).astype(int)
    # last_hosted_year stays nullable; pandas Int64 keeps NaN semantics.
    out["last_hosted_year"] = out["last_hosted_year"].astype("Int64")
    return out


def compute_max_affiliated_last_year(
    affiliations: pd.DataFrame,
    person_universe: pd.DataFrame,
) -> pd.DataFrame:
    """
    For each club_key in legacy_person_club_affiliations, join matched
    historical-person rows and return the highest last_year observed.

    Rows with match_status != 'MATCHED' (e.g. NO_MATCH / UNRESOLVED) are
    skipped because they have no historical_persons link and therefore no
    last_year signal.
    """
    require_columns(
        affiliations,
        {"club_key", "matched_person_id", "match_status"},
        "legacy_person_club_affiliations.csv",
    )
    require_columns(person_universe, {"person_id", "last_year"}, "persons_enriched_for_clubs.csv")

    matched = affiliations[affiliations["match_status"].str.upper().eq("MATCHED")].copy()
    matched["club_key"] = matched["club_key"].map(norm_text)
    matched["matched_person_id"] = matched["matched_person_id"].map(norm_text)

    pu = person_universe[["person_id", "last_year"]].copy()
    pu["person_id"] = pu["person_id"].map(norm_text)
    pu["last_year_int"] = pd.to_numeric(pu["last_year"], errors="coerce")
    pu = pu.dropna(subset=["last_year_int"])
    pu["last_year_int"] = pu["last_year_int"].astype(int)

    j = matched.merge(
        pu[["person_id", "last_year_int"]],
        left_on="matched_person_id",
        right_on="person_id",
        how="inner",
    )

    if j.empty:
        return pd.DataFrame({"_club_key": [], "max_affiliated_member_last_year": []})

    agg = j.groupby("club_key", dropna=False).agg(
        max_affiliated_member_last_year=("last_year_int", "max"),
    ).reset_index()
    agg = agg.rename(columns={"club_key": "_club_key"})
    agg["max_affiliated_member_last_year"] = agg["max_affiliated_member_last_year"].astype("Int64")
    return agg


def score_club(row: pd.Series) -> float:
    """
    Retained scalar confidence score for audit/debug. No longer drives
    bootstrap eligibility; that responsibility moves to the deterministic
    §10.1 rule evaluation in classify_row().
    """
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


def classify_row(row: pd.Series) -> dict:
    """
    Evaluate §10.1 rules R1–R10 for a single club row and assign a
    category. Rules are evaluated independently; the category is chosen
    by first-match over the grouped pre_populate / onboarding_visible
    predicates.

    Contact-signal substitute:
      §10.1 R3/R4/R5 ask "did the CLUB CONTACT compete in 2020 or later".
      extract_clubs.py does not currently capture the contact's mirror
      member ID (only contact_email), so we cannot isolate the contact
      from the broader member list. We substitute "any affiliated member
      with last_year >= 2020" (the same predicate as R8) and flag each
      affected row via contact_signal_substitute_applied. When real
      contact-member-ID extraction lands upstream, swap the predicate
      inside this function without touching callers.
    """
    last_hosted_year = row.get("last_hosted_year")
    max_aff_last_year = row.get("max_affiliated_member_last_year")
    created_year = row.get("created_year")
    last_updated_year = row.get("last_updated_year")

    ever_hosted = bool(row.get("ever_hosted", 0))
    hosted_2020_plus = (
        pd.notna(last_hosted_year) and int(last_hosted_year) >= ACTIVE_PLAYER_YEAR
    )
    page_updated_2020_plus = (
        pd.notna(last_updated_year) and int(last_updated_year) >= ACTIVE_PLAYER_YEAR
    )
    any_member_active_2020_plus = (
        pd.notna(max_aff_last_year) and int(max_aff_last_year) >= ACTIVE_PLAYER_YEAR
    )
    page_edited_2016_plus = (
        pd.notna(last_updated_year) and int(last_updated_year) >= RECENT_EDIT_YEAR
    )
    edited_after_creation = (
        pd.notna(last_updated_year)
        and pd.notna(created_year)
        and int(last_updated_year) > int(created_year)
    )
    created_2022_plus = pd.notna(created_year) and int(created_year) >= NEW_CLUB_YEAR

    unique_members = int(row.get("unique_member_names", 0) or 0)
    linkable_members = int(row.get("linkable_member_count", 0) or 0)
    has_description = bool(row.get("has_description", False))

    # Contact substitute — see function docstring.
    contact_competed_2020_plus = any_member_active_2020_plus

    # Pre-populate rules (any match → pre_populate).
    R1 = hosted_2020_plus
    R2 = page_updated_2020_plus and ever_hosted
    R3 = page_updated_2020_plus and contact_competed_2020_plus
    R4 = contact_competed_2020_plus and ever_hosted

    # Onboarding-visible rules (any match → onboarding_visible, unless
    # already pre_populate above).
    R5 = contact_competed_2020_plus
    R6 = ever_hosted
    R7 = page_edited_2016_plus and edited_after_creation
    R8 = any_member_active_2020_plus
    R9 = created_2022_plus
    R10 = (unique_members >= LARGE_MEMBER_COUNT) or (linkable_members >= KNOWN_PLAYER_COUNT)

    # Flag whether any pre_populate / onboarding rule that fired here
    # relied on the contact substitute (so later auditing can isolate
    # how much the substitute moved the classification).
    contact_rules_used = (R3 or R4 or R5)

    if R1 or R2 or R3 or R4:
        category = "pre_populate"
    elif R5 or R6 or R7 or R8 or R9 or R10:
        category = "onboarding_visible"
    elif has_description:
        # §10.1: "Has a description (so not junk)".
        category = "dormant"
    else:
        # Clubs with no description that fail every other rule. §10.1
        # junk definition lists six AND-ed criteria; four of them
        # (never hosted, no member competed 2020+, created <2022, no
        # description) are implied by falling through to this branch.
        # The remaining two (never edited after creation, contact did
        # not compete 2020+) are either already enforced via R7 / the
        # contact substitute or add no new information here, so "no
        # description + all rules failed" is treated as junk.
        category = "junk"

    return {
        "R1": int(R1), "R2": int(R2), "R3": int(R3), "R4": int(R4), "R5": int(R5),
        "R6": int(R6), "R7": int(R7), "R8": int(R8), "R9": int(R9), "R10": int(R10),
        "category": category,
        "contact_signal_substitute_applied": int(contact_rules_used),
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not CLUBS_CSV.exists():
        raise FileNotFoundError(f"Missing clubs.csv: {CLUBS_CSV}")
    if not CLUB_MEMBERS_CSV.exists():
        raise FileNotFoundError(f"Missing club_members.csv: {CLUB_MEMBERS_CSV}")
    if not PERSON_UNIVERSE_CSV.exists():
        raise FileNotFoundError(f"Missing person universe: {PERSON_UNIVERSE_CSV}")
    if not AFFILIATIONS_CSV.exists():
        raise FileNotFoundError(f"Missing affiliations file: {AFFILIATIONS_CSV}")
    if not EVENTS_CSV.exists():
        raise FileNotFoundError(f"Missing canonical events file: {EVENTS_CSV}")

    clubs = pd.read_csv(CLUBS_CSV, dtype=str).fillna("")
    club_members = pd.read_csv(CLUB_MEMBERS_CSV, dtype=str).fillna("")
    person_universe = pd.read_csv(PERSON_UNIVERSE_CSV, dtype=str).fillna("")
    affiliations = pd.read_csv(AFFILIATIONS_CSV, dtype=str).fillna("")
    events = pd.read_csv(EVENTS_CSV, dtype=str).fillna("")

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

    # Hosted-event signal from canonical events.csv. events.csv stores
    # host_club as raw text, so we join on a normalized-name key rather
    # than on the main _club_key (which may be the numeric
    # legacy_club_key). Events whose host_club is a federation label
    # (e.g. "WFA", "NHSA") simply fail to match and contribute no
    # hosted-event credit to any club row.
    df["_name_key"] = df["name"].map(norm_name)
    hosted = compute_hosted_events_by_club(events, df["_name_key"])
    df = df.merge(hosted, on="_name_key", how="left")
    df["hosted_event_count"] = df["hosted_event_count"].fillna(0).astype(int)
    df["ever_hosted"] = df["ever_hosted"].fillna(0).astype(int)
    if "last_hosted_year" in df.columns:
        df["last_hosted_year"] = df["last_hosted_year"].astype("Int64")

    # Affiliated-member activity signal.
    aff_last_year = compute_max_affiliated_last_year(affiliations, person_universe)
    df = df.merge(aff_last_year, on="_club_key", how="left")
    df["max_affiliated_member_last_year"] = df["max_affiliated_member_last_year"].astype("Int64")

    # Parse year fields from the mirror CMS timestamp strings.
    df["created_year"] = df["created"].map(extract_year).astype("Int64") if "created" in df.columns else pd.Series([pd.NA] * len(df), dtype="Int64")
    df["last_updated_year"] = df["last_updated"].map(extract_year).astype("Int64") if "last_updated" in df.columns else pd.Series([pd.NA] * len(df), dtype="Int64")

    # Retained audit score (no longer gates eligibility).
    df["confidence_score"] = df.apply(score_club, axis=1).round(4)

    # Deterministic §10.1 classification.
    classification = df.apply(classify_row, axis=1, result_type="expand")
    df = pd.concat([df, classification], axis=1)

    df["bootstrap_eligible"] = (df["category"] == "pre_populate").astype(int)

    # Stable output columns.
    out_cols = []
    if "club_id" in df.columns:
        out_cols.append("club_id")
    out_cols += ["_club_key", "name"]
    for optional in ["city", "country", "contact_email", "external_url", "description", "created", "last_updated"]:
        if optional in df.columns:
            out_cols.append(optional)

    out_cols += [
        "member_rows",
        "unique_member_names",
        "mirror_member_id_count",
        "linkable_member_count",
        "hosted_event_count",
        "ever_hosted",
        "last_hosted_year",
        "max_affiliated_member_last_year",
        "created_year",
        "last_updated_year",
        "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10",
        "contact_signal_substitute_applied",
        "category",
        "confidence_score",
        "bootstrap_eligible",
    ]

    out = df[out_cols].copy()
    out.rename(columns={"_club_key": "club_key"}, inplace=True)

    out.to_csv(OUT_CSV, index=False)

    cat_counts = out["category"].value_counts().to_dict()
    rule_counts = {f"R{i}": int(out[f"R{i}"].sum()) for i in range(1, 11)}

    print(f"Wrote {len(out):,} rows to {OUT_CSV}")
    print()
    print("Category distribution:")
    for cat in ["pre_populate", "onboarding_visible", "dormant", "junk"]:
        print(f"  {cat:<20} {cat_counts.get(cat, 0):>5}")
    print()
    print("Rule firing counts (independent; sum exceeds club count):")
    for r in [f"R{i}" for i in range(1, 11)]:
        print(f"  {r:<4} {rule_counts[r]:>5}")
    print()
    print(f"bootstrap_eligible:                      {int(out['bootstrap_eligible'].sum()):,}")
    print(f"contact_signal_substitute_applied:       {int(out['contact_signal_substitute_applied'].sum()):,}")
    print(f"ever_hosted:                             {int(out['ever_hosted'].sum()):,}")
    print()
    print(f"Club key source: {key_source}")


if __name__ == "__main__":
    main()
