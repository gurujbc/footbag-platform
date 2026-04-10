#!/usr/bin/env python3
"""
audit_tie_flattening.py

Detects (event_id, division) pairs where Stage 2 canonical data contains
tied placements (e.g., 5,5,5,5) that have been incorrectly sequentialized
in the frozen identity lock file (e.g., 5,6,7,8).

Inputs:
    out/stage2_canonical_events.csv
    inputs/identity_lock/Placements_ByPerson_v97.csv

Outputs:
    out/audit_tie_mismatches_summary.csv
    out/audit_tie_mismatches_detail.csv
"""

import csv
import json
from collections import Counter
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent
STAGE2_CSV  = ROOT / "out" / "stage2_canonical_events.csv"
LOCK_CSV    = ROOT / "inputs" / "identity_lock" / "Placements_ByPerson_v97.csv"
OUT_SUMMARY = ROOT / "out" / "audit_tie_mismatches_summary.csv"
OUT_DETAIL  = ROOT / "out" / "audit_tie_mismatches_detail.csv"

csv.field_size_limit(10_000_000)

# ---------------------------------------------------------------------------
# Step 1 — Load and expand Stage 2 placements_json
# ---------------------------------------------------------------------------
def load_stage2(path: Path) -> pd.DataFrame:
    """
    Read stage2_canonical_events.csv and expand placements_json into one row
    per participant, keyed by (event_id, division_canon).

    Returns DataFrame with columns:
        event_id, event_name, year, division_canon,
        person_id, player_name, place
    """
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for event_row in reader:
            event_id   = str(event_row.get("event_id", "")).strip()
            event_name = event_row.get("event_name", "").strip()
            year       = event_row.get("year", "").strip()
            pj_raw     = event_row.get("placements_json", "").strip()

            if not pj_raw or not pj_raw.startswith("["):
                continue

            try:
                placements = json.loads(pj_raw)
            except json.JSONDecodeError:
                continue

            for entry in placements:
                division = str(entry.get("division_canon", "") or "").strip()
                place_raw = entry.get("place")

                try:
                    place = int(place_raw)
                except (TypeError, ValueError):
                    continue

                person_id   = str(entry.get("player1_id", "") or "").strip()
                player_name = str(entry.get("player1_name", "") or "").strip()

                # For doubles, also emit player2 if present
                # (treat each individual as their own row with same place)
                rows.append({
                    "event_id":     event_id,
                    "event_name":   event_name,
                    "year":         year,
                    "division_canon": division,
                    "person_id":    person_id if person_id else None,
                    "player_name":  player_name,
                    "place":        place,
                })

                p2_id   = str(entry.get("player2_id", "") or "").strip()
                p2_name = str(entry.get("player2_name", "") or "").strip()
                if p2_name:
                    rows.append({
                        "event_id":     event_id,
                        "event_name":   event_name,
                        "year":         year,
                        "division_canon": division,
                        "person_id":    p2_id if p2_id else None,
                        "player_name":  p2_name,
                        "place":        place,
                    })

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["place"] = df["place"].astype(int)
    return df


# ---------------------------------------------------------------------------
# Step 2 — Load identity lock
# ---------------------------------------------------------------------------
def load_lock(path: Path) -> pd.DataFrame:
    """
    Read Placements_ByPerson_v97.csv.

    Returns DataFrame with columns:
        event_id, division_canon, person_id, player_name, place
    """
    df = pd.read_csv(path, dtype=str)
    df.columns = df.columns.str.strip()

    # Normalise column names to what we expect
    rename = {}
    if "person_canon" in df.columns and "player_name" not in df.columns:
        rename["person_canon"] = "player_name"
    if rename:
        df = df.rename(columns=rename)

    df["event_id"]      = df["event_id"].astype(str).str.strip()
    df["division_canon"] = df["division_canon"].astype(str).str.strip()
    df["person_id"]     = df.get("person_id", pd.Series(dtype=str)).astype(str).str.strip()
    df["player_name"]   = df.get("player_name", pd.Series(dtype=str)).astype(str).str.strip()
    df["place"]         = pd.to_numeric(df["place"], errors="coerce")
    df = df.dropna(subset=["place"])
    df["place"] = df["place"].astype(int)

    return df[["event_id", "division_canon", "person_id", "player_name", "place"]]


# ---------------------------------------------------------------------------
# Step 3 — Tie detection helpers
# ---------------------------------------------------------------------------
def has_ties(places: list[int]) -> bool:
    """True if any place value appears more than once."""
    counts = Counter(places)
    return any(v > 1 for v in counts.values())


def looks_like_sequentialized(s2_places: list[int], lock_places: list[int]) -> bool:
    """
    Returns True when:
    - Stage 2 has at least one repeated value (a tie)
    - Lock has the same starting value but all values are strictly sequential
      (i.e., no repeats and incrementing by 1)

    Example: s2=[5,5,5,5], lock=[5,6,7,8] → True
             s2=[5,5,5,5], lock=[5,5,5,5] → False (tie preserved)
             s2=[5,5,7,7], lock=[5,6,7,8] → True
    """
    if not has_ties(s2_places):
        return False
    lock_sorted = sorted(lock_places)
    if len(lock_sorted) < 2:
        return False
    # Strictly increasing by 1?
    strictly_sequential = all(
        lock_sorted[i] + 1 == lock_sorted[i + 1]
        for i in range(len(lock_sorted) - 1)
    )
    if not strictly_sequential:
        return False
    # And lock has no repeats
    if len(set(lock_sorted)) != len(lock_sorted):
        return False
    # And the place ranges overlap (sanity check)
    if min(lock_sorted) > max(s2_places) or max(lock_sorted) < min(s2_places):
        return False
    return True


# ---------------------------------------------------------------------------
# Step 4 — Main audit
# ---------------------------------------------------------------------------
def main() -> None:
    print("Loading Stage 2 data …")
    s2 = load_stage2(STAGE2_CSV)
    print(f"  {len(s2):,} Stage 2 participant rows loaded")

    print("Loading identity lock …")
    lock = load_lock(LOCK_CSV)
    print(f"  {len(lock):,} lock rows loaded")

    # Build group keys
    s2_groups   = s2.groupby(["event_id", "division_canon"])
    lock_groups = lock.groupby(["event_id", "division_canon"])

    all_keys      = set(s2_groups.groups.keys())
    lock_keys     = set(lock_groups.groups.keys())
    common_keys   = all_keys & lock_keys

    total_evaluated     = 0
    groups_with_ties    = 0
    ties_preserved      = 0
    ties_flattened      = 0
    skipped_count_mismatch = 0

    summary_rows = []
    detail_rows  = []

    for key in sorted(common_keys):
        event_id, division = key

        s2_grp   = s2_groups.get_group(key).copy()
        lock_grp = lock_groups.get_group(key).copy()

        # Require equal row counts
        if len(s2_grp) != len(lock_grp):
            skipped_count_mismatch += 1
            continue

        total_evaluated += 1

        s2_places   = sorted(s2_grp["place"].tolist())
        lock_places = sorted(lock_grp["place"].tolist())

        if not has_ties(s2_places):
            continue

        groups_with_ties += 1

        if s2_places == lock_places:
            ties_preserved += 1
            continue

        if not looks_like_sequentialized(s2_places, lock_places):
            # Places differ but not due to sequentialization — skip
            continue

        ties_flattened += 1

        # Metadata from Stage 2 group
        event_name = s2_grp["event_name"].iloc[0]
        year       = s2_grp["year"].iloc[0]
        tie_values = sorted(set(p for p, c in Counter(s2_places).items() if c > 1))

        summary_rows.append({
            "event_id":           event_id,
            "event_name":         event_name,
            "year":               year,
            "division":           division,
            "stage2_row_count":   len(s2_grp),
            "lock_row_count":     len(lock_grp),
            "stage2_places":      "|".join(str(p) for p in s2_places),
            "lock_places":        "|".join(str(p) for p in lock_places),
            "tie_values_stage2":  "|".join(str(v) for v in tie_values),
            "status":             "tie_flattened_in_lock",
        })

        # ── Detail rows ──────────────────────────────────────────────────────
        # Match s2 ↔ lock by person_id where possible, else by player_name,
        # else fall back to sorted-order comparison only.
        s2_grp   = s2_grp.sort_values("place").reset_index(drop=True)
        lock_grp = lock_grp.sort_values("place").reset_index(drop=True)

        # Attempt person_id join
        s2_has_ids   = s2_grp["person_id"].notna() & (s2_grp["person_id"] != "")
        lock_has_ids = lock_grp["person_id"].notna() & (lock_grp["person_id"] != "")

        if s2_has_ids.any() and lock_has_ids.any():
            merged = pd.merge(
                s2_grp[["person_id", "player_name", "place"]].rename(columns={"place": "stage2_place"}),
                lock_grp[["person_id", "place"]].rename(columns={"place": "lock_place"}),
                on="person_id",
                how="outer",
            )
            merged["match_method"] = "person_id"
        else:
            # Fallback: player_name join
            s2_named   = s2_grp["player_name"].notna() & (s2_grp["player_name"] != "")
            lock_named = lock_grp["player_name"].notna() & (lock_grp["player_name"] != "")
            if s2_named.any() and lock_named.any():
                merged = pd.merge(
                    s2_grp[["player_name", "place"]].rename(columns={"place": "stage2_place"}),
                    lock_grp[["player_name", "place"]].rename(columns={"place": "lock_place"}),
                    on="player_name",
                    how="outer",
                )
                merged["person_id"]    = None
                merged["match_method"] = "player_name"
            else:
                # Last resort: positional (sorted order)
                merged = pd.DataFrame({
                    "person_id":    [None] * len(s2_grp),
                    "player_name":  s2_grp["player_name"].tolist(),
                    "stage2_place": s2_grp["place"].tolist(),
                    "lock_place":   lock_grp["place"].tolist(),
                    "match_method": "positional",
                })

        for _, drow in merged.iterrows():
            s2_p   = drow.get("stage2_place")
            lock_p = drow.get("lock_place")
            try:
                delta   = int(lock_p) - int(s2_p)
                suspect = delta != 0
            except (TypeError, ValueError):
                delta   = None
                suspect = True

            detail_rows.append({
                "event_id":    event_id,
                "event_name":  event_name,
                "division":    division,
                "person_id":   drow.get("person_id", ""),
                "player_name": drow.get("player_name", ""),
                "stage2_place": s2_p,
                "lock_place":   lock_p,
                "delta":        delta,
                "suspect":      suspect,
            })

    # ---------------------------------------------------------------------------
    # Write outputs
    # ---------------------------------------------------------------------------
    OUT_SUMMARY.parent.mkdir(parents=True, exist_ok=True)

    pd.DataFrame(summary_rows).to_csv(OUT_SUMMARY, index=False)
    pd.DataFrame(detail_rows).to_csv(OUT_DETAIL,  index=False)

    # ---------------------------------------------------------------------------
    # Console summary
    # ---------------------------------------------------------------------------
    print()
    print("=" * 60)
    print("TIE FLATTENING AUDIT RESULTS")
    print("=" * 60)
    print(f"  Total groups evaluated:          {total_evaluated:>6,}")
    print(f"  Groups with ties in Stage 2:     {groups_with_ties:>6,}")
    print(f"  Ties preserved in lock:          {ties_preserved:>6,}")
    print(f"  Ties flattened (flagged):        {ties_flattened:>6,}")
    print(f"  Skipped (row count mismatch):    {skipped_count_mismatch:>6,}")
    print("=" * 60)
    print(f"  Summary → {OUT_SUMMARY}")
    print(f"  Detail  → {OUT_DETAIL}")
    print("=" * 60)

    if ties_flattened == 0:
        print("\n  No tie-flattening mismatches detected.")
    else:
        print(f"\n  {ties_flattened} (event_id, division) pair(s) flagged.")
        if summary_rows:
            print("\n  Flagged events:")
            for r in summary_rows[:20]:
                print(f"    [{r['year']}] {r['event_name']} — {r['division']}")
                print(f"      Stage2: {r['stage2_places']}  →  Lock: {r['lock_places']}")
            if len(summary_rows) > 20:
                print(f"    … and {len(summary_rows) - 20} more (see CSV)")


if __name__ == "__main__":
    main()
