#!/usr/bin/env python3
"""
02p5_player_token_cleanup.py

Stage 02.5 — Player token cleanup and Placements_Flat generation.

v1.0 ADDITION:
----------------
Identity-Lock Release Mode.

When --identity_lock_placements_csv is provided, this script:
- DOES NOT perform heuristic identity resolution
- DOES NOT use alias logic
- DOES NOT modify identity
- Generates Placements_Flat.csv directly from authoritative placements
- Preserves all rows (no silent drops)

This satisfies the v1.0 canonical contract.
"""

import argparse
import os
import sys
import pandas as pd


def build_from_identity_lock(args):
    print("[02p5] Identity-lock mode ENABLED")
    print(f"[02p5] Loading authoritative placements: {args.identity_lock_placements_csv}")

    df = pd.read_csv(args.identity_lock_placements_csv)

    required_cols = [
        "event_id",
        "division_canon",
        "place",
        "person_id",
        "person_canon",
    ]

    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise RuntimeError(f"Identity-lock placements missing columns: {missing}")

    # Structural normalization only
    df_flat = df.copy()

    # Strip invisible U+00AD SOFT HYPHEN from division_canon (source artifact in PBP).
    # Accented letters, right quotes, en-dashes are legitimate and preserved.
    if "division_canon" in df_flat.columns:
        df_flat["division_canon"] = df_flat["division_canon"].str.replace("\u00ad", "", regex=False)

    # Override person_canon from PT so PF always reflects PT's authoritative name.
    # PBP canon can lag when PT is updated (e.g. canon corrections, new full-name
    # disambiguation) without a full PBP regeneration.
    if args.persons_truth_csv:
        print(f"[02p5] Applying PT canon override from: {args.persons_truth_csv}")
        pt = pd.read_csv(args.persons_truth_csv, dtype=str, usecols=["effective_person_id", "person_canon"])
        pt = pt.dropna(subset=["effective_person_id", "person_canon"])
        pt_map = pt.set_index("effective_person_id")["person_canon"].to_dict()

        overrides = 0
        def _override_canon(row):
            nonlocal overrides
            pid = str(row["person_id"]).strip() if pd.notna(row["person_id"]) else ""
            pt_canon = pt_map.get(pid)
            if pt_canon and str(row["person_canon"]).strip() != pt_canon.strip():
                overrides += 1
                return pt_canon
            return row["person_canon"]

        df_flat["person_canon"] = df_flat.apply(_override_canon, axis=1)
        print(f"[02p5] PT canon overrides applied: {overrides}")

    # division_raw is not available in locked data; derive deterministically
    if "division_raw" not in df_flat.columns:
        df_flat["division_raw"] = df_flat["division_canon"]

    out_dir = args.out_dir or "out"
    os.makedirs(out_dir, exist_ok=True)

    out_flat = os.path.join(out_dir, "Placements_Flat.csv")
    out_by_person = os.path.join(out_dir, "Placements_ByPerson.csv")

    df_flat.to_csv(out_flat, index=False)
    df.to_csv(out_by_person, index=False)

    print(f"[02p5] Wrote {out_flat}")
    print(f"[02p5] Wrote {out_by_person}")
    print(f"[02p5] Rows preserved: {len(df_flat)}")

    return 0


def main():
    parser = argparse.ArgumentParser(description="Stage 02.5 — Player token cleanup")

    parser.add_argument("--identity_lock_placements_csv")
    parser.add_argument("--persons_truth_csv", default=None,
                        help="Persons_Truth CSV for canon override (recommended: "
                             "inputs/identity_lock/Persons_Truth_Final_vN.csv)")
    parser.add_argument("--out_dir", default="out")

    args, _ = parser.parse_known_args()

    if args.identity_lock_placements_csv:
        return build_from_identity_lock(args)

    print("ERROR: Non-locked (heuristic) mode disabled for v1.0 canonical release.")
    print("Use --identity_lock_placements_csv.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
