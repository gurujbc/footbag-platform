#!/usr/bin/env python3
"""
legacy_data/event_results/scripts/07_build_mvfp_seed_full.py

Build full MVFP seed CSVs from canonical relational CSVs.

Unlike 06_build_mvfp_seed.py, this script does NOT:
- select representative smoke-test events
- apply synthetic status/date overrides
- shrink the dataset to a small subset

It simply validates and exports the full canonical dataset in MVFP seed format.

Inputs (default: ../FOOTBAG_DATA/out/canonical or as provided by --input-dir):
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
    ap.add_argument(
        "--input-dir",
        default="out/canonical",
        help="Directory containing canonical CSVs",
    )
    ap.add_argument(
        "--output-dir",
        default="legacy_data/event_results/seed/mvfp_full",
        help="Directory to write full seed CSVs",
    )
    ap.add_argument(
        "--used-persons-only",
        action="store_true",
        help="Export only persons referenced by event_result_participants",
    )
    args = ap.parse_args()

    in_dir = Path(args.input_dir)
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
                "legacy_member_id",
                "country",
                "first_year",
                "last_year",
                "event_count",
                "placement_count",
                "bap_member",
                "bap_nickname",
                "bap_induction_year",
                "fbhof_member",
                "fbhof_induction_year",
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

    orphan_participants = event_result_participants[
        ~event_result_participants.apply(
            lambda r: (
                str(r["event_key"]),
                str(r["discipline_key"]),
                str(r["placement"]),
            ) in set(
                zip(
                    event_results["event_key"].astype(str),
                    event_results["discipline_key"].astype(str),
                    event_results["placement"].astype(str),
                )
            ),
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
        existing_ids = set(persons["person_id"].str.strip())
        new_rows = []
        seen: set[str] = set()
        for _, row in event_result_participants[missing_mask].iterrows():
            pid = row["person_id"]
            if pid not in existing_ids and pid not in seen:
                seen.add(pid)
                new_rows.append({"person_id": pid, "person_name": row["display_name"]})

        if new_rows:
            persons = pd.concat(
                [persons, pd.DataFrame(new_rows)],
                ignore_index=True,
            )

        print(
            f"  Auto-assigned person_id to {n_missing} participant rows "
            f"({len(new_rows)} new minimal person records created)"
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
            "country",
            "first_year",
            "last_year",
            "event_count",
            "placement_count",
            "bap_member",
            "bap_nickname",
            "bap_induction_year",
            "fbhof_member",
            "fbhof_induction_year",
            "freestyle_sequences",
            "freestyle_max_add",
            "freestyle_unique_tricks",
            "freestyle_diversity_ratio",
            "signature_trick_1",
            "signature_trick_2",
            "signature_trick_3",
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
