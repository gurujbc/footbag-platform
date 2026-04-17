#!/usr/bin/env python3
"""
legacy_data/event_results/scripts/07_build_mvfp_seed_full.py

Build full MVFP seed CSVs from canonical relational CSVs.

Unlike 06_build_mvfp_seed.py, this script does NOT:
- select representative smoke-test events
- apply synthetic status/date overrides
- shrink the dataset to a small subset

It simply validates and exports the full canonical dataset in MVFP seed format.

Inputs (default: ~/projects/footbag-platform/legacy_data/event_results/canonical_input or as provided by --input-dir):
  events.csv
  event_disciplines.csv
  event_results.csv
  event_result_participants.csv
  persons.csv

Outputs (default: legacy_data/event_results/seed/mvfp_full or as provided by --output-dir):
  seed_events.csv
  seed_event_disciplines.csv
  seed_event_results.csv
  seed_event_result_participants.csv
  seed_persons.csv
"""

from __future__ import annotations

import argparse
import re
import uuid
from pathlib import Path
import pandas as pd

# Fixed namespace for auto-assigned person IDs.
# Using a stable UUID so that the same display_name always produces the
# same person_id across every pipeline run, on every machine.
_AUTO_PERSON_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def auto_person_id(display_name: str) -> str:
    """Return a stable UUID5 derived from a normalised display name."""
    return str(uuid.uuid5(_AUTO_PERSON_NS, display_name.strip().lower()))


# ── Person-likeness gate (mirrors export_canonical_platform.py step 5b) ───────
_PL_MOJIBAKE     = re.compile(r"[¶¦±¼¿¸¹º³]")
_PL_EMBED_Q      = re.compile(r"\w\?|\?\w")
_PL_STANDALONE_Q = re.compile(r"(?:^|\s)\?{1,5}(?:\s|$)")
_PL_BAD_CHARS    = re.compile(r"[+=\\|/]")
_PL_SCOREBOARD   = re.compile(r"^[A-Z]{2}\s+\d+$")
_PL_PRIZE        = re.compile(r"\$\d+")
_PL_MATCH_RESULT = re.compile(r"\d+-\d+\s+over\b", re.IGNORECASE)
_PL_BIG_NUMBER   = re.compile(r"\b\d{3,}\b")
_PL_NON_PERSON   = re.compile(
    r"\b(Connection|Dimension|Footbag|Spikehammer|head-to-head|"
    r"being determined|Freestyler|round robin|results|"
    r"Champions|Foot Clan|"
    r"whirlygig|whirlwind|spinning|blender|smear|"
    r"clipper|torque|butterfly|mirage|legbeater|ducking|"
    r"eggbeater|ripwalk|hopover|dropless|scorpion|matador|"
    r"symposium|swirl|drifter|vortex|superfly|"
    r"atomic|blurry|whirl|flux|dimwalk|nemesis|bedwetter|"
    r"pixie|rooted|sailing|diving|ripped|warrior|"
    r"paradon|steping|pdx|mullet|"
    r"Big Add Posse|Aerial Zone|Annual Mountain|Be Announced|"
    r"depending|highest.placed|two footbags)\b",
    re.IGNORECASE,
)
_PL_ALL_CAPS     = re.compile(r"^[A-Z]{2,}[\s-]+[A-Z]{2,}(?:[\s-]+[A-Z]{2,})*$")
_PL_TRAILING_JUNK = re.compile(r"[*]+$")
_PL_ABBREVIATED  = re.compile(r"^[A-Z]\.?\s+\S")
_PL_INCOMPLETE   = re.compile(r"^\S+\s+[A-Z]$")
_PL_INITIALS     = re.compile(r"^[A-Z]\.\s+[A-Z]\.$")
_PL_PRIZE_SUFFIX = re.compile(r"-prizes\b|\bprize\b", re.IGNORECASE)
_PL_TRICK_ARROW  = re.compile(r"[>]|\s:\s")
_PL_LONG_TOKEN   = re.compile(r"\S{21,}")


def _is_person_like(name: str) -> bool:
    """Return False if name is clearly not a canonical person name."""
    s = name.strip()
    if not s:
        return False
    if _PL_MOJIBAKE.search(s):     return False
    if _PL_EMBED_Q.search(s):      return False
    if _PL_STANDALONE_Q.search(s): return False
    if _PL_BAD_CHARS.search(s):    return False
    if _PL_SCOREBOARD.match(s):    return False
    if _PL_PRIZE.search(s):        return False
    if _PL_MATCH_RESULT.search(s): return False
    if _PL_BIG_NUMBER.search(s):   return False
    if _PL_NON_PERSON.search(s):   return False
    if "," in s:                   return False
    if _PL_ALL_CAPS.match(s):      return False
    if _PL_TRAILING_JUNK.search(s) and len(s.split()) >= 2: return False
    if " " not in s and "." not in s: return False
    if _PL_ABBREVIATED.match(s):   return False
    if _PL_INCOMPLETE.match(s):    return False
    if _PL_INITIALS.match(s):      return False
    if _PL_PRIZE_SUFFIX.search(s): return False
    if _PL_TRICK_ARROW.search(s):  return False
    if _PL_LONG_TOKEN.search(s):   return False
    if s[0].islower():             return False
    if re.search(r"\bThe\b", s):   return False
    if '"' in s:                   return False
    if " or " in s.lower():       return False
    return True


def load_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing required input file: {path}")
    return pd.read_csv(path, dtype=str).fillna("")


def ensure_col(df: pd.DataFrame, col: str, default: str = "") -> pd.DataFrame:
    if col not in df.columns:
        df[col] = default
    return df


def require_cols(df: pd.DataFrame, cols: list[str], name: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise RuntimeError(f"{name} missing required columns: {missing}")


def append_note(existing: str, extra: str) -> str:
    existing = (existing or "").strip()
    if not existing:
        return extra
    return f"{existing} | {extra}"


def main() -> None:
    ap = argparse.ArgumentParser()
    repo_root = Path(__file__).resolve().parents[3]
    default_input_dir = repo_root / "legacy_data/event_results/canonical_input"
    ap.add_argument(
        "--input-dir",
        default=str(default_input_dir),
        help="Directory containing canonical CSVs",
    )
    ap.add_argument(
        "--output-dir",
        default=str(repo_root / "legacy_data/event_results/seed/mvfp_full"),
        help="Directory to write full seed CSVs",
    )
    ap.add_argument(
        "--used-persons-only",
        action="store_true",
        help="Export only persons referenced by event_result_participants",
    )
    args = ap.parse_args()

    in_dir = Path(args.input_dir).expanduser()
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    events = load_csv(in_dir / "events.csv")
    event_disciplines = load_csv(in_dir / "event_disciplines.csv")
    event_results = load_csv(in_dir / "event_results.csv")
    event_result_participants = load_csv(in_dir / "event_result_participants.csv")
    persons = load_csv(in_dir / "persons.csv")

    # ------------------------------------------------------------------
    # Validate required columns
    # ------------------------------------------------------------------
    require_cols(
        events,
        [
            "event_key", "legacy_event_id", "year", "event_name", "event_slug",
            "start_date", "end_date", "city", "region", "country",
            "host_club", "status", "notes", "source",
        ],
        "events.csv",
    )
    require_cols(
        event_disciplines,
        [
            "event_key", "discipline_key", "discipline_name",
            "discipline_category", "team_type", "sort_order",
            "coverage_flag", "notes",
        ],
        "event_disciplines.csv",
    )
    require_cols(
        event_results,
        ["event_key", "discipline_key", "placement", "score_text", "notes", "source"],
        "event_results.csv",
    )
    require_cols(
        event_result_participants,
        [
            "event_key", "discipline_key", "placement",
            "participant_order", "display_name", "person_id", "notes",
        ],
        "event_result_participants.csv",
    )
    require_cols(
        persons,
        ["person_id", "person_name"],
        "persons.csv",
    )

    # ------------------------------------------------------------------
    # Normalize optional text columns
    # ------------------------------------------------------------------
    for df, cols in [
        (events, ["region", "host_club", "notes", "source"]),
        (event_disciplines, ["discipline_category", "team_type", "coverage_flag", "notes"]),
        (event_results, ["score_text", "notes", "source"]),
        (event_result_participants, ["display_name", "person_id", "notes"]),
        (
            persons,
            [
                "aliases",
                "member_id",
                "legacy_member_id",
                "country",
                "first_year",
                "last_year",
                "event_count",
                "placement_count",
                "bap_member",
                "bap_nickname",
                "bap_induction_year",
                "hof_member",
                "hof_induction_year",
                "freestyle_sequences",
                "freestyle_max_add",
                "freestyle_unique_tricks",
                "freestyle_diversity_ratio",
                "signature_trick_1",
                "signature_trick_2",
                "signature_trick_3",
                "notes",
                "source",
            ],
        ),
    ]:
        for col in cols:
            df = ensure_col(df, col, "")

    # ------------------------------------------------------------------
    # Restrict persons to used IDs if requested
    # ------------------------------------------------------------------
    if args.used_persons_only:
        used_person_ids = set(
            event_result_participants["person_id"]
            .astype(str)
            .map(str.strip)
            .loc[lambda s: s.ne("")]
        )
        persons = persons[persons["person_id"].isin(used_person_ids)].copy()

    # ------------------------------------------------------------------
    # Referential integrity checks
    # ------------------------------------------------------------------
    event_keys = set(events["event_key"].astype(str))
    disc_keys = set(
        zip(
            event_disciplines["event_key"].astype(str),
            event_disciplines["discipline_key"].astype(str),
        )
    )

    orphan_disciplines = event_disciplines[
        ~event_disciplines["event_key"].astype(str).isin(event_keys)
    ]
    if not orphan_disciplines.empty:
        raise RuntimeError(
            f"Found {len(orphan_disciplines)} event_disciplines rows with missing event_key references"
        )

    orphan_results = event_results[
        ~event_results.apply(
            lambda r: (str(r["event_key"]), str(r["discipline_key"])) in disc_keys,
            axis=1,
        )
    ]
    if not orphan_results.empty:
        raise RuntimeError(
            f"Found {len(orphan_results)} event_results rows with missing (event_key, discipline_key) references"
        )

    result_keys = set(
        zip(
            event_results["event_key"].astype(str),
            event_results["discipline_key"].astype(str),
            event_results["placement"].astype(str),
        )
    )
    orphan_participants = event_result_participants[
        ~event_result_participants.apply(
            lambda r: (
                str(r["event_key"]),
                str(r["discipline_key"]),
                str(r["placement"]),
            ) in result_keys,
            axis=1,
        )
    ]
    if not orphan_participants.empty:
        raise RuntimeError(
            f"Found {len(orphan_participants)} participant rows with missing result references"
        )

    # ------------------------------------------------------------------
    # Uniqueness checks
    # ------------------------------------------------------------------
    if events["event_key"].duplicated().any():
        dupes = events.loc[events["event_key"].duplicated(), "event_key"].tolist()
        raise RuntimeError(f"Duplicate event_key values in events.csv: {dupes[:10]}")

    if event_disciplines.duplicated(["event_key", "discipline_key"]).any():
        raise RuntimeError("Duplicate (event_key, discipline_key) in event_disciplines.csv")

    if event_results.duplicated(["event_key", "discipline_key", "placement"]).any():
        raise RuntimeError("Duplicate (event_key, discipline_key, placement) in event_results.csv")

    if event_result_participants.duplicated(
        ["event_key", "discipline_key", "placement", "participant_order"]
    ).any():
        raise RuntimeError(
            "Duplicate (event_key, discipline_key, placement, participant_order) "
            "in event_result_participants.csv"
        )

    if persons["person_id"].duplicated().any():
        dupes = persons.loc[persons["person_id"].duplicated(), "person_id"].tolist()
        raise RuntimeError(f"Duplicate person_id values in persons.csv: {dupes[:10]}")

    # ------------------------------------------------------------------
    # Resolve blank display_names using team_person_key partner rows
    # ------------------------------------------------------------------
    if "team_person_key" in event_result_participants.columns:
        tpk = event_result_participants["team_person_key"].str.strip()
        name = event_result_participants["display_name"].str.strip()
        blank_name = name.eq("") & tpk.ne("")
        if blank_name.any():
            key_to_name = (
                event_result_participants[tpk.ne("") & name.ne("")]
                .groupby("team_person_key")["display_name"]
                .first()
            )
            event_result_participants = event_result_participants.copy()
            for idx in event_result_participants[blank_name].index:
                key = event_result_participants.at[idx, "team_person_key"].strip()
                if key in key_to_name:
                    event_result_participants.at[idx, "display_name"] = key_to_name[key]

    # ------------------------------------------------------------------
    # Mark canonical persons (loaded from canonical_input/persons.csv)
    # Auto-assigned minimal records created below get no source_scope.
    # ------------------------------------------------------------------
    persons = persons.copy()
    persons["source_scope"] = "CANONICAL"

    # ------------------------------------------------------------------
    # Normalise display_name to canonical person_name for resolved persons
    # ------------------------------------------------------------------
    pid_to_canonical = dict(
        zip(persons["person_id"].str.strip(), persons["person_name"].str.strip())
    )
    has_pid = event_result_participants["person_id"].str.strip().ne("")
    n_name_fixed = 0
    for idx in event_result_participants[has_pid].index:
        pid = event_result_participants.at[idx, "person_id"].strip()
        canon = pid_to_canonical.get(pid)
        if canon and event_result_participants.at[idx, "display_name"] != canon:
            event_result_participants.at[idx, "display_name"] = canon
            n_name_fixed += 1
    if n_name_fixed:
        print(f"  Canonical name override: {n_name_fixed} participant display_name(s) corrected")

    # ------------------------------------------------------------------
    # Assign stable person_ids to participants that are missing one
    # ------------------------------------------------------------------
    missing_mask = event_result_participants["person_id"].str.strip().eq("")
    n_missing = missing_mask.sum()
    if n_missing:
        event_result_participants = event_result_participants.copy()
        event_result_participants.loc[missing_mask, "person_id"] = (
            event_result_participants.loc[missing_mask, "display_name"]
            .apply(auto_person_id)
        )

        # Create minimal persons records for any newly assigned IDs
        # Skip non-person-like display names (junk, tricks, narrative, etc.)
        # and null their person_id so no dangling FK is created.
        existing_ids = set(persons["person_id"].str.strip())
        new_rows = []
        seen_good: set[str] = set()
        seen_bad: set[str] = set()
        for _, row in event_result_participants[missing_mask].iterrows():
            pid = row["person_id"]
            dn = row["display_name"]
            if pid in existing_ids or pid in seen_good:
                continue
            if pid in seen_bad:
                continue
            if _is_person_like(dn):
                seen_good.add(pid)
                new_rows.append({"person_id": pid, "person_name": dn})
            else:
                seen_bad.add(pid)

        # Null person_id for participants whose display_name failed the gate
        if seen_bad:
            bad_mask = event_result_participants["person_id"].isin(seen_bad)
            event_result_participants = event_result_participants.copy()
            event_result_participants.loc[bad_mask, "person_id"] = ""

        if new_rows:
            persons = pd.concat(
                [persons, pd.DataFrame(new_rows)],
                ignore_index=True,
            )

        print(
            f"  Auto-assigned person_id to {n_missing} participant rows "
            f"({len(new_rows)} new minimal person records created"
            f"{f', {len(seen_bad)} non-person-like nulled' if seen_bad else ''})"
        )

    # ------------------------------------------------------------------
    # Sort for deterministic output
    # ------------------------------------------------------------------
    events = events.sort_values(["year", "event_name", "event_key"], kind="stable").copy()
    event_disciplines = event_disciplines.sort_values(
        ["event_key", "sort_order", "discipline_name", "discipline_key"], kind="stable"
    ).copy()
    event_results = event_results.sort_values(
        ["event_key", "discipline_key", "placement"], kind="stable"
    ).copy()
    event_result_participants = event_result_participants.sort_values(
        ["event_key", "discipline_key", "placement", "participant_order"], kind="stable"
    ).copy()
    persons = persons.sort_values(["person_name", "person_id"], kind="stable").copy()

    # ------------------------------------------------------------------
    # Select final output columns
    # ------------------------------------------------------------------
    seed_events = events[
        [
            "event_key",
            "legacy_event_id",
            "year",
            "event_name",
            "event_slug",
            "start_date",
            "end_date",
            "city",
            "region",
            "country",
            "host_club",
            "status",
            "notes",
            "source",
        ]
    ].copy()

    seed_event_disciplines = event_disciplines[
        [
            "event_key",
            "discipline_key",
            "discipline_name",
            "discipline_category",
            "team_type",
            "sort_order",
            "coverage_flag",
            "notes",
        ]
    ].copy()

    seed_event_results = event_results[
        [
            "event_key",
            "discipline_key",
            "placement",
            "score_text",
            "notes",
            "source",
        ]
    ].copy()

    seed_event_result_participants = event_result_participants[
        [
            "event_key",
            "discipline_key",
            "placement",
            "participant_order",
            "display_name",
            "person_id",
            "notes",
        ]
    ].copy()

    seed_persons = persons[
        [
            "person_id",
            "person_name",
            "member_id",
            "country",
            "first_year",
            "last_year",
            "event_count",
            "placement_count",
            "bap_member",
            "bap_nickname",
            "bap_induction_year",
            "hof_member",
            "hof_induction_year",
            "freestyle_sequences",
            "freestyle_max_add",
            "freestyle_unique_tricks",
            "freestyle_diversity_ratio",
            "signature_trick_1",
            "signature_trick_2",
            "signature_trick_3",
            "source_scope",
        ]
    ].copy()

    # ------------------------------------------------------------------
    # Write outputs
    # ------------------------------------------------------------------
    seed_events.to_csv(out_dir / "seed_events.csv", index=False)
    seed_event_disciplines.to_csv(out_dir / "seed_event_disciplines.csv", index=False)
    seed_event_results.to_csv(out_dir / "seed_event_results.csv", index=False)
    seed_event_result_participants.to_csv(
        out_dir / "seed_event_result_participants.csv",
        index=False,
    )
    seed_persons.to_csv(out_dir / "seed_persons.csv", index=False)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print(f"\nFull MVFP seed set written to: {out_dir}")
    print("\nRow counts:")
    print(f"  seed_events.csv: {len(seed_events):,}")
    print(f"  seed_event_disciplines.csv: {len(seed_event_disciplines):,}")
    print(f"  seed_event_results.csv: {len(seed_event_results):,}")
    print(f"  seed_event_result_participants.csv: {len(seed_event_result_participants):,}")
    print(f"  seed_persons.csv: {len(seed_persons):,}")

    min_year = seed_events["year"].replace("", pd.NA).dropna()
    if not min_year.empty:
        years = pd.to_numeric(min_year, errors="coerce").dropna()
        if not years.empty:
            print(f"\nEvent year range: {int(years.min())}–{int(years.max())}")

    print("\nDone.")


if __name__ == "__main__":
    main()
