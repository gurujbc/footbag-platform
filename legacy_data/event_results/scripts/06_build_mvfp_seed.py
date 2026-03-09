from __future__ import annotations

import argparse
from pathlib import Path
import pandas as pd


PUBLIC_STATUSES = {"published", "registration_full", "closed", "completed"}
UPCOMING_PUBLIC_STATUSES = {"published", "registration_full", "closed"}
NONPUBLIC_STATUSES = {"draft", "pending_approval", "canceled"}


def load_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str).fillna("")


def ensure_col(df: pd.DataFrame, col: str, default="") -> pd.DataFrame:
    if col not in df.columns:
        df[col] = default
    return df


def parse_dates(events: pd.DataFrame) -> pd.DataFrame:
    events = events.copy()
    for c in ["start_date", "end_date"]:
        events = ensure_col(events, c, "")
        events[f"{c}_dt"] = pd.to_datetime(events[c], errors="coerce")
    return events


def choose_first(df: pd.DataFrame, desc: str) -> pd.Series:
    if df.empty:
        raise RuntimeError(f"Could not find required seed case: {desc}")
    return df.iloc[0]


def choose_or_fallback(primary: pd.DataFrame, fallback: pd.DataFrame, desc: str):
    if not primary.empty:
        return primary.iloc[0], False
    if not fallback.empty:
        return fallback.iloc[0], True
    raise RuntimeError(f"Could not find required seed case even with fallback: {desc}")


def exclude_selected(df: pd.DataFrame, selected_keys: list) -> pd.DataFrame:
    if not selected_keys:
        return df
    return df[~df["event_key"].isin(selected_keys)]


def append_note(existing: str, extra: str) -> str:
    existing = (existing or "").strip()
    if not existing:
        return extra
    return f"{existing} | {extra}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir", default="out/canonical", help="Directory containing canonical CSVs")
    ap.add_argument("--output-dir", default="out/mvfp_seed", help="Directory to write seed CSVs")
    args = ap.parse_args()

    in_dir = Path(args.input_dir)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    events = load_csv(in_dir / "events.csv")
    event_disciplines = load_csv(in_dir / "event_disciplines.csv")
    event_results = load_csv(in_dir / "event_results.csv")
    event_result_participants = load_csv(in_dir / "event_result_participants.csv")
    persons = load_csv(in_dir / "persons.csv")

    for df, cols, name in [
        (events, ["event_key", "status", "notes"], "events.csv"),
        (event_disciplines, ["event_key"], "event_disciplines.csv"),
        (event_results, ["event_key", "discipline_key", "placement"], "event_results.csv"),
        (event_result_participants, ["event_key", "discipline_key", "placement", "participant_order"], "event_result_participants.csv"),
    ]:
        missing = [c for c in cols if c not in df.columns]
        if missing:
            raise RuntimeError(f"{name} missing required columns: {missing}")

    events = ensure_col(events, "event_name", "")
    events = ensure_col(events, "event_slug", "")
    events = ensure_col(events, "start_date", "")
    events = ensure_col(events, "end_date", "")
    events = ensure_col(events, "notes", "")
    events = parse_dates(events)

    today = pd.Timestamp.today().normalize()

    # Derived flags
    result_event_keys = set(event_results["event_key"].astype(str))

    discipline_counts = (
        event_disciplines.groupby("event_key", as_index=False)
        .size()
        .rename(columns={"size": "discipline_count"})
    )
    events = events.merge(discipline_counts, on="event_key", how="left")
    events["discipline_count"] = events["discipline_count"].fillna(0).astype(int)
    events["has_results"] = events["event_key"].isin(result_event_keys)

    slot_counts = (
        event_result_participants.groupby(
            ["event_key", "discipline_key", "placement"], as_index=False
        )
        .size()
        .rename(columns={"size": "participant_count"})
    )
    multi_participant_event_keys = set(
        slot_counts.loc[slot_counts["participant_count"] > 1, "event_key"].astype(str)
    )

    # ---------- Choose seed roles ----------

    role_rows = {}
    role_synthetic = {}

    selected_core = []

    # 1) upcoming public event
    upcoming_public = events[
        events["status"].isin(UPCOMING_PUBLIC_STATUSES)
        & events["start_date_dt"].notna()
        & (events["start_date_dt"] >= today)
    ].sort_values(["start_date_dt", "event_key"])

    fallback_public = events[
        events["status"].isin(PUBLIC_STATUSES)
    ].sort_values(["event_key"])

    ev, synthetic = choose_or_fallback(upcoming_public, fallback_public, "upcoming public event")
    role_rows["upcoming_public"] = ev
    role_synthetic["upcoming_public"] = synthetic
    selected_core.append(str(ev["event_key"]).strip())

    # 2) completed public event with no results
    completed_no_results = events[
        (events["status"] == "completed") & (~events["has_results"])
    ].sort_values(["end_date_dt", "event_key"], ascending=[False, True])

    fallback_completed_no_results = events[
        ~events["has_results"]
    ].sort_values(["event_key"])

    completed_no_results = exclude_selected(completed_no_results, selected_core)
    fallback_completed_no_results = exclude_selected(fallback_completed_no_results, selected_core)
    ev, synthetic = choose_or_fallback(
        completed_no_results, fallback_completed_no_results,
        "completed public event with no result rows"
    )
    role_rows["completed_no_results"] = ev
    role_synthetic["completed_no_results"] = synthetic
    selected_core.append(str(ev["event_key"]).strip())

    # 3) completed public event with results
    completed_with_results = events[
        (events["status"] == "completed") & (events["has_results"])
    ].sort_values(["discipline_count", "event_key"], ascending=[False, True])

    fallback_completed_with_results = events[
        events["has_results"]
    ].sort_values(["discipline_count", "event_key"], ascending=[False, True])

    completed_with_results = exclude_selected(completed_with_results, selected_core)
    fallback_completed_with_results = exclude_selected(fallback_completed_with_results, selected_core)
    ev, synthetic = choose_or_fallback(
        completed_with_results, fallback_completed_with_results,
        "completed public event with result rows"
    )
    role_rows["completed_with_results"] = ev
    role_synthetic["completed_with_results"] = synthetic
    selected_core.append(str(ev["event_key"]).strip())

    # 4) non-public event
    nonpublic = events[
        events["status"].isin(NONPUBLIC_STATUSES)
    ].sort_values(["start_date_dt", "event_key"], ascending=[False, True])

    fallback_nonpublic = events.sort_values(["event_key"])

    nonpublic = exclude_selected(nonpublic, selected_core)
    fallback_nonpublic = exclude_selected(fallback_nonpublic, selected_core)
    ev, synthetic = choose_or_fallback(
        nonpublic, fallback_nonpublic, "non-public event"
    )
    role_rows["non_public"] = ev
    role_synthetic["non_public"] = synthetic
    selected_core.append(str(ev["event_key"]).strip())

    # 5) multi-discipline example
    multi_discipline = events[
        events["discipline_count"] > 1
    ].sort_values(["discipline_count", "event_key"], ascending=[False, True])

    ev = choose_first(multi_discipline, "multi-discipline example")
    role_rows["multi_discipline"] = ev
    role_synthetic["multi_discipline"] = False

    # 6) multi-participant result example
    multi_participant = events[
        events["event_key"].isin(multi_participant_event_keys)
    ].sort_values(["event_key"])

    ev = choose_first(multi_participant, "multi-participant result example")
    role_rows["multi_participant"] = ev
    role_synthetic["multi_participant"] = False

    # ---------- Final selected event keys ----------
    selected_keys = []
    for role in [
        "upcoming_public",
        "completed_no_results",
        "completed_with_results",
        "non_public",
        "multi_discipline",
        "multi_participant",
    ]:
        k = str(role_rows[role]["event_key"]).strip()
        if k and k not in selected_keys:
            selected_keys.append(k)

    # ---------- Filter outputs ----------
    seed_events = events[events["event_key"].isin(selected_keys)].copy()
    seed_event_disciplines = event_disciplines[event_disciplines["event_key"].isin(selected_keys)].copy()
    seed_event_results = event_results[event_results["event_key"].isin(selected_keys)].copy()
    seed_event_result_participants = event_result_participants[
        event_result_participants["event_key"].isin(selected_keys)
    ].copy()

    # persons subset if available
    if "person_id" in seed_event_result_participants.columns and "person_id" in persons.columns:
        used_person_ids = set(
            seed_event_result_participants["person_id"]
            .astype(str)
            .map(str.strip)
            .loc[lambda s: s.ne("")]
        )
        seed_persons = persons[persons["person_id"].isin(used_person_ids)].copy()
    else:
        seed_persons = persons.iloc[0:0].copy()

    # ---------- Seed roles + override notes ----------
    seed_events["seed_roles"] = ""

    role_to_key = {
        role: str(row["event_key"]).strip()
        for role, row in role_rows.items()
    }

    # Attach role labels
    for role, event_key in role_to_key.items():
        mask = seed_events["event_key"] == event_key
        existing = seed_events.loc[mask, "seed_roles"].astype(str)
        seed_events.loc[mask, "seed_roles"] = existing.apply(
            lambda x: f"{x}|{role}".strip("|") if x else role
        )

    # ---------- Apply seed-only overrides ----------
    # upcoming_public fallback
    if role_synthetic["upcoming_public"]:
        k = role_to_key["upcoming_public"]
        mask = seed_events["event_key"] == k
        future_start = (today + pd.Timedelta(days=30)).strftime("%Y-%m-%d")
        future_end = (today + pd.Timedelta(days=32)).strftime("%Y-%m-%d")
        seed_events.loc[mask, "status"] = "published"
        seed_events.loc[mask, "start_date"] = future_start
        seed_events.loc[mask, "end_date"] = future_end
        seed_events.loc[mask, "notes"] = seed_events.loc[mask, "notes"].apply(
            lambda x: append_note(x, "MVFP seed override: synthetic upcoming public event")
        )

    # completed_no_results fallback
    if role_synthetic["completed_no_results"]:
        k = role_to_key["completed_no_results"]
        mask = seed_events["event_key"] == k
        past_start = (today - pd.Timedelta(days=90)).strftime("%Y-%m-%d")
        past_end = (today - pd.Timedelta(days=88)).strftime("%Y-%m-%d")
        seed_events.loc[mask, "status"] = "completed"
        seed_events.loc[mask, "start_date"] = past_start
        seed_events.loc[mask, "end_date"] = past_end
        seed_events.loc[mask, "notes"] = seed_events.loc[mask, "notes"].apply(
            lambda x: append_note(x, "MVFP seed override: synthetic completed public event with no results")
        )

    # completed_with_results fallback
    if role_synthetic["completed_with_results"]:
        k = role_to_key["completed_with_results"]
        mask = seed_events["event_key"] == k
        past_start = (today - pd.Timedelta(days=120)).strftime("%Y-%m-%d")
        past_end = (today - pd.Timedelta(days=118)).strftime("%Y-%m-%d")
        seed_events.loc[mask, "status"] = "completed"
        seed_events.loc[mask, "start_date"] = past_start
        seed_events.loc[mask, "end_date"] = past_end
        seed_events.loc[mask, "notes"] = seed_events.loc[mask, "notes"].apply(
            lambda x: append_note(x, "MVFP seed override: synthetic completed public event with results")
        )

    # non_public fallback
    if role_synthetic["non_public"]:
        k = role_to_key["non_public"]
        mask = seed_events["event_key"] == k
        seed_events.loc[mask, "status"] = "draft"
        seed_events.loc[mask, "notes"] = seed_events.loc[mask, "notes"].apply(
            lambda x: append_note(x, "MVFP seed override: synthetic non-public event")
        )

    # ---------- Write outputs ----------
    # After role overrides, before selecting/writing final columns: fill missing dates only where blank.
    # Collect updates then apply (modifying during iterrows() can fail to persist).
    date_fill_updates: list[tuple[int, str, str, str]] = []
    for idx in seed_events.index:
        row = seed_events.loc[idx]
        start = str(row.get("start_date", "")).strip()
        end = str(row.get("end_date", "")).strip()
        status = str(row.get("status", "")).strip()
        roles = str(row.get("seed_roles", "")).strip()
        try:
            year = int(row.get("year", "") or 0)
        except (TypeError, ValueError):
            year = today.year
        if start and end:
            continue
        notes = str(row.get("notes", "")).strip()

        # upcoming public seed case -> future dates
        if "upcoming_public" in roles:
            new_start = (today + pd.Timedelta(days=30)).strftime("%Y-%m-%d") if not start else start
            new_end = (today + pd.Timedelta(days=32)).strftime("%Y-%m-%d") if not end else end
            date_fill_updates.append((idx, new_start, new_end, append_note(notes, "MVFP seed fallback: filled missing upcoming dates")))
            continue

        # completed events -> plausible historical fallback in same year
        if status == "completed" or "completed_with_results" in roles or "completed_no_results" in roles:
            new_start = f"{year}-07-01" if not start else start
            new_end = f"{year}-07-03" if not end else end
            date_fill_updates.append((idx, new_start, new_end, append_note(notes, "MVFP seed fallback: filled missing completed dates")))
            continue

    for idx, new_start, new_end, new_notes in date_fill_updates:
        seed_events.loc[idx, "start_date"] = new_start
        seed_events.loc[idx, "end_date"] = new_end
        seed_events.loc[idx, "notes"] = new_notes

    seed_events = seed_events[
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
    ]

    # ------------------------------------------------------------------
    # Clean NaNs from seed event metadata
    # ------------------------------------------------------------------

    # fill text columns
    for col in ["notes", "host_club", "region"]:
        if col in seed_events.columns:
            seed_events[col] = seed_events[col].fillna("")

    # ensure dates exist
    for idx, row in seed_events.iterrows():
        start = str(row.get("start_date", "")).strip()
        end = str(row.get("end_date", "")).strip()
        year = int(row["year"])

        if not start:
            seed_events.at[idx, "start_date"] = f"{year}-07-01"

        if not end:
            seed_events.at[idx, "end_date"] = f"{year}-07-05"

    seed_events.to_csv(out_dir / "seed_events.csv", index=False)
    seed_event_disciplines.to_csv(out_dir / "seed_event_disciplines.csv", index=False)
    seed_event_results.to_csv(out_dir / "seed_event_results.csv", index=False)
    seed_event_result_participants.to_csv(out_dir / "seed_event_result_participants.csv", index=False)
    seed_persons.to_csv(out_dir / "seed_persons.csv", index=False)

    # ---------- Print exact smoke-test event keys ----------
    print("\nMVFP seed set written to:", out_dir)
    print("\nSmoke-test roles and event keys:")
    for role in [
        "upcoming_public",
        "completed_no_results",
        "completed_with_results",
        "non_public",
        "multi_discipline",
        "multi_participant",
    ]:
        row = role_rows[role]
        synthetic = role_synthetic[role]
        print(
            f"- {role}: {row['event_key']}"
            f"{' [seed override]' if synthetic else ''}"
        )

    print("\nUnique smoke-test event keys:")
    for k in selected_keys:
        print(f"- {k}")

    print("\nSeed row counts:")
    print(f"  seed_events.csv: {len(seed_events):,}")
    print(f"  seed_event_disciplines.csv: {len(seed_event_disciplines):,}")
    print(f"  seed_event_results.csv: {len(seed_event_results):,}")
    print(f"  seed_event_result_participants.csv: {len(seed_event_result_participants):,}")
    print(f"  seed_persons.csv: {len(seed_persons):,}")

    print("\nSelected seed events:")
    display_cols = [c for c in [
        "event_key", "event_name", "status", "start_date", "end_date", "seed_roles", "notes"
    ] if c in seed_events.columns]
    print(seed_events[display_cols].sort_values(["event_key"]).to_string(index=False))


if __name__ == "__main__":
    main()
