#!/usr/bin/env python3
"""
08_score_trick_sequences.py — Sequence Difficulty Scorer

Reads:
  noise_trick_sequences.csv      — ordered trick chains from 06b miner
  trick_dictionary.csv           — canonical ADD values per trick
  trick_aliases.csv              — alias → canonical trick mappings
  trick_modifiers.csv            — modifier ADD bonuses (with rotational variant)

Computes per-chain:
  sequence_add     — sum of ADD values for all scoreable tricks in chain
  avg_add          — sequence_add / chain_length (denominator = all tricks)
  max_add          — highest individual trick ADD in chain
  unscored_count   — tricks whose ADD could not be determined

Outputs:
  sequence_difficulty.csv        — one row per chain
  sequence_trick_adds.csv        — one row per trick in each chain (for debugging)
  sequence_difficulty_summary.json

ADD scoring logic (three-step fallback per trick):
  1. Direct lookup in trick_dictionary (exact match)
  2. Alias lookup → resolve to canonical → direct lookup
  3. Modifier decomposition:
       - Strip leading modifier tokens (from trick_modifiers.csv)
       - Look up the remaining base trick in the dictionary
       - Sum: base_adds + modifier_bonuses
       - Modifier bonus = add_bonus_rotational if base is in ROTATIONAL_BASES
                          else add_bonus
  4. If none of the above succeed: ADD = None (unscored)

ROTATIONAL_BASES — base tricks where spinning/blurry/swirling add +2 instead of +1:
  mirage, whirl, torque, blender, swirl, drifter, eggbeater

Conservative mode (--conservative):
  Any chain with unscored tricks is still emitted, but avg_add is computed
  over scored tricks only, and unscored_count is flagged. Use this to avoid
  silently underestimating difficulty for partially-known chains.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Optional

import pandas as pd


# ─────────────────────────────────────────────
# Rotational base tricks
# (blurry and spinning add +2 instead of +1)
# ─────────────────────────────────────────────

ROTATIONAL_BASES: set[str] = {
    "mirage",
    "whirl",
    "torque",
    "blender",
    "swirl",
    "drifter",
    "eggbeater",
}


# ─────────────────────────────────────────────
# Load reference tables
# ─────────────────────────────────────────────

def load_trick_dictionary(path: Path) -> dict[str, Optional[int]]:
    """Returns {trick_canon: adds} — adds is None for modifier-only entries."""
    d: dict[str, Optional[int]] = {}
    if not path.exists():
        raise FileNotFoundError(f"trick_dictionary not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            canon = row["trick_canon"].strip().lower()
            adds_raw = row.get("adds", "").strip()
            try:
                d[canon] = int(adds_raw)
            except (ValueError, TypeError):
                d[canon] = None
    return d


def load_trick_aliases(path: Path) -> dict[str, str]:
    """Returns {alias_lower: canonical_lower}."""
    aliases: dict[str, str] = {}
    if not path.exists():
        return aliases
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            a = row.get("alias", "").strip().lower()
            c = row.get("trick_canon", "").strip().lower()
            if a and c:
                aliases[a] = c
    return aliases


def load_modifiers(path: Path) -> dict[str, dict]:
    """Returns {modifier_lower: {add_bonus: int, add_bonus_rotational: int}}."""
    mods: dict[str, dict] = {}
    if not path.exists():
        raise FileNotFoundError(f"trick_modifiers not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row["modifier"].strip().lower()
            try:
                bonus = int(row["add_bonus"])
                bonus_rot = int(row["add_bonus_rotational"])
            except (ValueError, KeyError):
                continue
            mods[name] = {"add_bonus": bonus, "add_bonus_rotational": bonus_rot}
    return mods


# ─────────────────────────────────────────────
# ADD lookup (three-step fallback)
# ─────────────────────────────────────────────

def resolve_canonical(trick: str, aliases: dict[str, str]) -> str:
    """Resolve alias → canonical, lower-cased."""
    lower = trick.strip().lower()
    return aliases.get(lower, lower)


def decompose_trick(
    trick_canon: str,
    trick_dict: dict[str, Optional[int]],
    modifiers: dict[str, dict],
) -> tuple[Optional[int], str]:
    """
    Attempt modifier decomposition for a trick not in the dictionary.

    Returns (adds, method_note) where adds is None if decomposition fails.

    Strategy: iterate over all possible prefix lengths (1..N-1 tokens).
    For each prefix, check if every token is a known modifier AND the
    remaining suffix matches a scored entry in the dictionary.
    Accept the first decomposition where base ADD is known.
    """
    words = trick_canon.split()
    if len(words) < 2:
        return None, "no_decomposition_possible"

    for split_point in range(1, len(words)):
        mod_tokens = words[:split_point]
        base_candidate = " ".join(words[split_point:])

        # All prefix tokens must be known modifiers
        if not all(t in modifiers for t in mod_tokens):
            continue

        # Base must be in dictionary with a score
        base_adds = trick_dict.get(base_candidate)
        if base_adds is None:
            # Try alias resolution of base
            continue

        # Base scored — compute total
        is_rotational = base_candidate in ROTATIONAL_BASES
        bonus = 0
        unknown_mod = False
        for mod in mod_tokens:
            m = modifiers.get(mod)
            if m is None:
                unknown_mod = True
                break
            bonus += m["add_bonus_rotational"] if is_rotational else m["add_bonus"]

        if unknown_mod:
            return None, f"unknown_modifier_in_{mod_tokens}"

        total = base_adds + bonus
        return total, f"decomposed:{'+'.join(mod_tokens)}+{base_candidate}({base_adds})+bonus({bonus})"

    return None, "decomposition_failed"


def score_trick(
    trick_raw: str,
    trick_dict: dict[str, Optional[int]],
    aliases: dict[str, str],
    modifiers: dict[str, dict],
) -> tuple[Optional[int], str]:
    """
    Returns (adds, method) for a single trick token.
    method is a string describing how the ADD was obtained.
    """
    lower = trick_raw.strip().lower()

    # Step 1: direct lookup
    if lower in trick_dict and trick_dict[lower] is not None:
        return trick_dict[lower], "direct"

    # Step 2: alias resolution → direct lookup
    canonical = aliases.get(lower)
    if canonical and canonical in trick_dict and trick_dict[canonical] is not None:
        return trick_dict[canonical], f"alias:{canonical}"

    # Step 3: modifier decomposition on original token
    adds, method = decompose_trick(lower, trick_dict, modifiers)
    if adds is not None:
        return adds, method

    # Step 3b: decomposition on alias-resolved canonical (if different)
    if canonical and canonical != lower:
        adds, method = decompose_trick(canonical, trick_dict, modifiers)
        if adds is not None:
            return adds, f"alias_decomposed:{method}"

    return None, "unscored"


# ─────────────────────────────────────────────
# Chain scoring
# ─────────────────────────────────────────────

def score_chain(
    tricks_in_chain: list[str],
    trick_dict: dict[str, Optional[int]],
    aliases: dict[str, str],
    modifiers: dict[str, dict],
) -> dict:
    """Score all tricks in a chain. Returns per-trick and aggregate results."""
    per_trick: list[dict] = []
    for trick in tricks_in_chain:
        adds, method = score_trick(trick, trick_dict, aliases, modifiers)
        per_trick.append({"trick_canon": trick, "adds": adds, "score_method": method})

    scored_adds = [r["adds"] for r in per_trick if r["adds"] is not None]
    n = len(tricks_in_chain)
    unscored = n - len(scored_adds)

    sequence_add = sum(scored_adds) if scored_adds else None
    # avg_add denominator = ALL tricks (not just scored) → honest difficulty estimate
    avg_add = round(sequence_add / n, 3) if sequence_add is not None else None
    max_add = max(scored_adds) if scored_adds else None

    return {
        "sequence_add": sequence_add,
        "avg_add": avg_add,
        "max_add": max_add,
        "sequence_length": n,
        "scored_count": len(scored_adds),
        "unscored_count": unscored,
        "per_trick": per_trick,
    }


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Score trick sequences with ADD difficulty values."
    )
    ap.add_argument("--sequences", required=True,
                    help="noise_trick_sequences.csv from 06b miner")
    ap.add_argument("--trick-dictionary", required=True,
                    help="trick_dictionary.csv")
    ap.add_argument("--trick-aliases", required=True,
                    help="trick_aliases.csv")
    ap.add_argument("--trick-modifiers", required=True,
                    help="trick_modifiers.csv")
    ap.add_argument("--out-dir", required=True,
                    help="Output directory")
    ap.add_argument("--min-length", type=int, default=2,
                    help="Minimum chain length to include (default: 2)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    trick_dict = load_trick_dictionary(Path(args.trick_dictionary))
    aliases = load_trick_aliases(Path(args.trick_aliases))
    modifiers = load_modifiers(Path(args.trick_modifiers))

    seq_df = pd.read_csv(args.sequences, low_memory=False)
    required_cols = {"chain_id", "sequence_index", "trick_canon"}
    missing = required_cols - set(seq_df.columns)
    if missing:
        raise ValueError(f"sequences CSV missing columns: {missing}")

    # Sort for reproducibility
    seq_df = seq_df.sort_values(["chain_id", "sequence_index"])

    chain_rows: list[dict] = []
    trick_rows: list[dict] = []

    for chain_id, group in seq_df.groupby("chain_id", sort=False):
        group = group.sort_values("sequence_index")
        tricks_in_chain = group["trick_canon"].fillna("").tolist()

        if len(tricks_in_chain) < args.min_length:
            continue

        # Pull chain-level metadata from first row
        first = group.iloc[0]
        event_id = first.get("event_id")
        year = first.get("year")
        person_id = first.get("person_id")
        person_canon = first.get("person_canon")
        attribution_confidence = first.get("attribution_confidence")

        result = score_chain(tricks_in_chain, trick_dict, aliases, modifiers)

        chain_rows.append({
            "chain_id": chain_id,
            "event_id": event_id,
            "year": year,
            "person_id": person_id,
            "person_canon": person_canon,
            "match_type": first.get("match_type"),
            "attribution_confidence": attribution_confidence,
            "sequence_length": result["sequence_length"],
            "scored_count": result["scored_count"],
            "unscored_count": result["unscored_count"],
            "sequence_add": result["sequence_add"],
            "avg_add": result["avg_add"],
            "max_add": result["max_add"],
            "tricks": ">".join(tricks_in_chain),
        })

        for seq_idx, (trick, pr) in enumerate(zip(tricks_in_chain, result["per_trick"])):
            trick_rows.append({
                "chain_id": chain_id,
                "event_id": event_id,
                "year": year,
                "person_id": person_id,
                "person_canon": person_canon,
                "attribution_confidence": attribution_confidence,
                "sequence_index": seq_idx,
                "trick_canon": trick,
                "adds": pr["adds"],
                "score_method": pr["score_method"],
            })

    chain_df = pd.DataFrame(chain_rows)
    trick_df = pd.DataFrame(trick_rows)

    # ── Summary stats ─────────────────────────────────────────────────────
    scored_chains = chain_df[chain_df["sequence_add"].notna()] if not chain_df.empty else chain_df
    fully_scored = chain_df[chain_df["unscored_count"] == 0] if not chain_df.empty else chain_df

    method_counts: dict[str, int] = {}
    if not trick_df.empty:
        method_counts = trick_df["score_method"].value_counts().to_dict()

    summary = {
        "total_chains": len(chain_df),
        "chains_with_any_score": int(len(scored_chains)),
        "fully_scored_chains": int(len(fully_scored)),
        "total_tricks_in_sequences": int(len(trick_df)),
        "tricks_scored": int(trick_df["adds"].notna().sum()) if not trick_df.empty else 0,
        "tricks_unscored": int(trick_df["adds"].isna().sum()) if not trick_df.empty else 0,
        "score_method_breakdown": method_counts,
        "avg_sequence_add": round(float(scored_chains["sequence_add"].mean()), 2) if len(scored_chains) else None,
        "avg_chain_length": round(float(chain_df["sequence_length"].mean()), 2) if len(chain_df) else None,
        "top_10_hardest_chains": (
            scored_chains[["chain_id", "person_canon", "year", "sequence_add", "max_add", "tricks"]]
            .sort_values("sequence_add", ascending=False)
            .head(10)
            .to_dict(orient="records")
        ) if len(scored_chains) else [],
    }

    # ── Write outputs ─────────────────────────────────────────────────────
    chain_path = out_dir / "sequence_difficulty.csv"
    trick_path = out_dir / "sequence_trick_adds.csv"
    summary_path = out_dir / "sequence_difficulty_summary.json"

    chain_df.to_csv(chain_path, index=False)
    trick_df.to_csv(trick_path, index=False)
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    print("Wrote:")
    for p in [chain_path, trick_path, summary_path]:
        print(f"  {p}")
    print("\nSummary:")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
