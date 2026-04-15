#!/usr/bin/env python3
"""
08_normalize_trick_sequences.py — Sequence Normalization Pass

Runs AFTER 06b extraction and BEFORE final scoring.
Does NOT modify any extraction scripts or frozen lexicon files.

Problem: the 06b miner extracts individual trick tokens. Sometimes a compound
like "ducking butterfly" is parsed from a source line where the modifier and
base trick are adjacent, yielding two separate chain tokens:

    [ducking] → unscored
    [butterfly] → 3 ADD

rather than the correct single token:

    [ducking butterfly] → 4 ADD

This script merges adjacent modifier + base sequences back into recognized
compound tricks using greedy longest-match against the trick dictionary.

Two modes are always computed and written in a single pass:

  CONSERVATIVE (default / always produced):
    A merge is only performed if the joined string is explicitly present in
    trick_dictionary.csv with a confirmed ADD value (direct match or alias).
    Inferred merges are never applied.

  INFERRED (always produced alongside conservative):
    Additionally applies modifier + base merges that are computable via
    modifier decomposition rules but are NOT in the dictionary.
    Safety guard: the base trick must be in the "base" category
    (not a named compound like fog, ripwalk, etc.).
    Inferred merges are marked add_confidence = "inferred".

Tail-dangler modifiers (modifier at chain-end with nothing following) are
never merged in either mode. They represent vestigial source-text context.

Algorithm (greedy longest-match):
    For each chain (group of tokens by chain_id), iterate token by token:
    1. If current token is NOT a known modifier → emit as-is, advance 1
    2. If current token IS a known modifier → try windows from MAX_WINDOW..2:
       a. Join tokens[i:i+w] into candidate string
       b. Direct dict lookup (or alias) → if found: DICT_MATCH merge, emit, advance w
       c. Valid decomposition (all prefix tokens modifiers, base in dict) AND
          base is NOT itself a compound → INFERRED merge, conditionally emit
    3. If no merge possible → emit unresolved modifier, advance 1

Outputs:
    sequence_difficulty_conservative.csv  — chain-level, conservative merges only
    sequence_difficulty_inferred.csv      — chain-level, conservative + inferred merges
    sequence_tricks_conservative.csv      — trick-level, conservative
    sequence_tricks_inferred.csv          — trick-level, inferred
    sequence_merge_log.csv                — QC: all merges performed (both modes)
    sequence_unresolved_residues.csv      — QC: modifiers still unresolved after inferred pass
    sequence_normalization_summary.json   — run stats + delta table
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Optional

import pandas as pd


# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

MAX_WINDOW = 4  # maximum number of tokens to try merging (3 modifiers + 1 base)

# Base tricks where spinning/blurry/swirling add +2 (rotation penalty)
ROTATIONAL_BASES: set[str] = {
    "mirage", "whirl", "torque", "blender", "swirl", "drifter", "eggbeater",
}

# Base-category names — only these can be valid merge targets for inferred merges.
# Named compounds (ripwalk, fog, dimwalk, etc.) are already complete tricks;
# prepending a modifier would produce unrecognised nonsense.
# This set is populated at runtime from tricks_v1.csv category == "base".
BASE_TRICK_CATEGORIES: set[str] = {"base"}


# ─────────────────────────────────────────────
# Load reference tables
# ─────────────────────────────────────────────

def load_trick_dictionary(path: Path) -> dict[str, int]:
    """Returns {trick_canon_lower: adds}. Only entries with a valid integer ADD."""
    d: dict[str, int] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            canon = row["trick_canon"].strip().lower()
            try:
                d[canon] = int(row["adds"])
            except (ValueError, TypeError):
                pass  # modifiers have blank adds — skip
    return d


def load_trick_aliases(path: Path) -> dict[str, str]:
    """Returns {alias_lower: canonical_lower}."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            a = row.get("alias", "").strip().lower()
            c = row.get("trick_canon", "").strip().lower()
            if a and c:
                out[a] = c
    return out


def load_modifiers(path: Path) -> dict[str, dict]:
    """Returns {modifier_lower: {add_bonus, add_bonus_rotational}}."""
    out: dict[str, dict] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row["modifier"].strip().lower()
            try:
                out[name] = {
                    "add_bonus": int(row["add_bonus"]),
                    "add_bonus_rotational": int(row["add_bonus_rotational"]),
                }
            except (ValueError, KeyError):
                pass
    return out


def load_base_tricks(tricks_v1_path: Path) -> set[str]:
    """Returns lower-cased trick_canon values where category == 'base'."""
    bases: set[str] = set()
    if not tricks_v1_path.exists():
        return bases
    with open(tricks_v1_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("category", "").strip().lower() == "base":
                bases.add(row["trick_canon"].strip().lower())
    return bases


# ─────────────────────────────────────────────
# Merge logic
# ─────────────────────────────────────────────

def resolve_trick(
    token: str,
    trick_dict: dict[str, int],
    aliases: dict[str, str],
) -> tuple[Optional[int], Optional[str]]:
    """
    Try direct lookup then alias for a single token.
    Returns (adds, canonical_name) or (None, None).
    """
    lower = token.strip().lower()
    if lower in trick_dict:
        return trick_dict[lower], lower
    canon = aliases.get(lower)
    if canon and canon in trick_dict:
        return trick_dict[canon], canon
    return None, None


def compute_decomposed_adds(
    modifier_tokens: list[str],
    base_token: str,
    trick_dict: dict[str, int],
    modifiers: dict[str, dict],
) -> Optional[int]:
    """
    Compute ADD value for (modifiers + base) via modifier bonus rules.
    Returns None if any modifier is unknown or base is not in dict.
    """
    base_adds = trick_dict.get(base_token)
    if base_adds is None:
        return None
    is_rotational = base_token in ROTATIONAL_BASES
    bonus = 0
    for mod in modifier_tokens:
        m = modifiers.get(mod)
        if m is None:
            return None
        bonus += m["add_bonus_rotational"] if is_rotational else m["add_bonus"]
    return base_adds + bonus


def try_merge_at(
    tokens: list[str],
    start: int,
    trick_dict: dict[str, int],
    aliases: dict[str, str],
    modifiers: dict[str, dict],
    base_tricks: set[str],
    max_window: int,
    include_inferred: bool,
) -> tuple[str, int, int, str]:
    """
    Attempt to merge tokens starting at `start` into the longest recognised compound.

    Returns:
        merged_token  — the resulting trick name
        window        — how many original tokens were consumed
        adds          — ADD value of the merged trick (or of the single token if not merged)
        method        — "dict_match" | "alias_match" | "inferred" | "no_merge"
    """
    end_bound = min(start + max_window, len(tokens))

    for window in range(end_bound - start, 1, -1):
        candidate_tokens = tokens[start : start + window]
        candidate = " ".join(t.strip().lower() for t in candidate_tokens)

        # ── Criterion A: direct dictionary match ─────────────────────────
        if candidate in trick_dict:
            return candidate, window, trick_dict[candidate], "dict_match"

        # ── Criterion A via alias ─────────────────────────────────────────
        resolved = aliases.get(candidate)
        if resolved and resolved in trick_dict:
            return resolved, window, trick_dict[resolved], "alias_match"

        # ── Criterion B: modifier decomposition (optional) ───────────────
        if include_inferred and window >= 2:
            prefix_tokens = [t.strip().lower() for t in candidate_tokens[:-1]]
            base_token    = candidate_tokens[-1].strip().lower()

            # All prefix tokens must be known modifiers
            if not all(t in modifiers for t in prefix_tokens):
                continue

            # Base must be in the dictionary with a real ADD value
            base_adds = trick_dict.get(base_token)
            if base_adds is None:
                continue

            # Base must be a pure base-category trick (not a named compound)
            # Safety: this prevents "atomic fog" type nonsense merges
            if base_token not in base_tricks:
                continue

            computed = compute_decomposed_adds(prefix_tokens, base_token, trick_dict, modifiers)
            if computed is not None:
                return candidate, window, computed, "inferred"

    # No merge possible
    return tokens[start].strip().lower(), 1, None, "no_merge"


def normalize_chain(
    tokens: list[str],
    trick_dict: dict[str, int],
    aliases: dict[str, str],
    modifiers: dict[str, dict],
    base_tricks: set[str],
    max_window: int,
    include_inferred: bool,
) -> list[dict]:
    """
    Normalize one chain using greedy longest-match.

    Returns list of dicts — one per normalized token:
        normalized_trick  — result (may equal original if no merge)
        original_tokens   — list of original tokens consumed
        window            — number of original tokens consumed
        adds              — ADD value (may be None for unresolved modifiers)
        merge_method      — "dict_match" | "alias_match" | "inferred" | "no_merge" | "direct"
    """
    result: list[dict] = []
    i = 0

    while i < len(tokens):
        token_lower = tokens[i].strip().lower()

        if token_lower in modifiers:
            # This token is a modifier — attempt merge with following tokens
            merged, window, adds, method = try_merge_at(
                tokens, i, trick_dict, aliases, modifiers,
                base_tricks, max_window, include_inferred,
            )
            if window == 1 and method == "no_merge":
                # Unresolved modifier — score it directly in case it has an ADD
                # (it won't for pure modifiers, but check anyway for forward compat)
                direct_adds, _ = resolve_trick(token_lower, trick_dict, aliases)
                result.append({
                    "normalized_trick": token_lower,
                    "original_tokens": [tokens[i]],
                    "window": 1,
                    "adds": direct_adds,
                    "merge_method": "unresolved_modifier",
                })
            else:
                result.append({
                    "normalized_trick": merged,
                    "original_tokens": tokens[i : i + window],
                    "window": window,
                    "adds": adds,
                    "merge_method": method,
                })
            i += window
        else:
            # Not a modifier — score directly, no merge attempt
            direct_adds, resolved_name = resolve_trick(token_lower, trick_dict, aliases)
            result.append({
                "normalized_trick": resolved_name or token_lower,
                "original_tokens": [tokens[i]],
                "window": 1,
                "adds": direct_adds,
                "merge_method": "direct" if direct_adds is not None else "unscored",
            })
            i += 1

    return result


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def _build_chain_stats(
    chain_id: str,
    meta: dict,
    tokens: list[str],
    normalized: list[dict],
) -> tuple[dict, list[dict], list[dict], list[dict]]:
    """
    Build chain-level row, trick-level rows, merge-log rows, and residue rows
    from one normalization result.

    Returns (chain_row, trick_rows, merge_rows, residue_rows).
    """
    trick_rows: list[dict] = []
    merge_rows: list[dict] = []
    residue_rows: list[dict] = []

    for seq_idx, entry in enumerate(normalized):
        was_merged = entry["window"] > 1
        trick_rows.append({
            **meta,
            "sequence_index":   seq_idx,
            "normalized_trick": entry["normalized_trick"],
            "original_tokens":  "|".join(entry["original_tokens"]),
            "merge_window":     entry["window"],
            "was_merged":       was_merged,
            "adds":             entry["adds"],
            "merge_method":     entry["merge_method"],
        })

        if was_merged:
            merge_rows.append({
                **meta,
                "sequence_index":   seq_idx,
                "original_tokens":  "|".join(entry["original_tokens"]),
                "merged_to":        entry["normalized_trick"],
                "merge_method":     entry["merge_method"],
                "adds":             entry["adds"],
            })

        if entry["merge_method"] == "unresolved_modifier":
            orig_tokens = entry["original_tokens"]
            orig_i = tokens.index(orig_tokens[0]) if orig_tokens[0] in tokens else -1
            residue_rows.append({
                **meta,
                "position":         seq_idx,
                "modifier_token":   entry["normalized_trick"],
                "prev_token":       tokens[orig_i - 1] if orig_i > 0 else "",
                "next_token":       tokens[orig_i + 1] if orig_i < len(tokens) - 1 else "",
                "note":             "tail_dangler" if orig_i == len(tokens) - 1 else
                                    "head_modifier" if orig_i == 0 else "mid_chain",
            })

    scored_adds = [e["adds"] for e in normalized if e["adds"] is not None]
    n_norm      = len(normalized)
    n_merges    = sum(1 for e in normalized if e["window"] > 1)
    unscored    = n_norm - len(scored_adds)
    seq_add     = sum(scored_adds) if scored_adds else None
    avg_add     = round(seq_add / n_norm, 3) if seq_add is not None else None
    max_add     = max(scored_adds) if scored_adds else None

    chain_row = {
        **meta,
        "original_length":            len(tokens),
        "normalized_length":          n_norm,
        "tokens_consumed_by_merges":  len(tokens) - n_norm,
        "merges_performed":           n_merges,
        "scored_count":               len(scored_adds),
        "unscored_count":             unscored,
        "sequence_add":               seq_add,
        "avg_add":                    avg_add,
        "max_add":                    max_add,
        "tricks_normalized":          ">".join(e["normalized_trick"] for e in normalized),
    }

    return chain_row, trick_rows, merge_rows, residue_rows


def _make_summary(
    mode: str,
    seq_df_len: int,
    trick_df: "pd.DataFrame",
    chain_df: "pd.DataFrame",
    resid_df: "pd.DataFrame",
    max_window: int,
) -> dict:
    """Build a summary dict for one normalization mode."""
    scored_chains = chain_df[chain_df["sequence_add"].notna()] if not chain_df.empty else chain_df
    fully_scored  = chain_df[chain_df["unscored_count"] == 0]  if not chain_df.empty else chain_df

    method_counts: dict = {}
    if not trick_df.empty:
        method_counts = trick_df["merge_method"].value_counts().to_dict()

    residue_mods: dict = {}
    residue_ctx:  dict = {}
    if not resid_df.empty:
        residue_mods = resid_df["modifier_token"].value_counts().to_dict()
        if "note" in resid_df.columns:
            residue_ctx = resid_df["note"].value_counts().to_dict()

    return {
        "mode":                       mode,
        "total_chains":               int(len(chain_df)),
        "chains_with_score":          int(len(scored_chains)),
        "fully_scored_chains":        int(len(fully_scored)),
        "total_input_tricks":         seq_df_len,
        "total_output_tricks":        int(len(trick_df)),
        "tokens_consumed_by_merges":  seq_df_len - int(len(trick_df)),
        "merges_performed":           int(trick_df["was_merged"].sum()) if not trick_df.empty else 0,
        "unresolved_modifiers":       int((trick_df["merge_method"] == "unresolved_modifier").sum())
                                      if not trick_df.empty else 0,
        "max_window":                 max_window,
        "merge_method_breakdown":     method_counts,
        "unresolved_modifier_breakdown": residue_mods,
        "residue_context_breakdown":  residue_ctx,
        "avg_sequence_add":           round(float(scored_chains["sequence_add"].mean()), 2)
                                      if len(scored_chains) else None,
        "avg_avg_add":                round(float(scored_chains["avg_add"].mean()), 3)
                                      if len(scored_chains) and "avg_add" in scored_chains else None,
        "avg_max_add":                round(float(scored_chains["max_add"].mean()), 2)
                                      if len(scored_chains) and "max_add" in scored_chains else None,
        "top_10_hardest_chains": (
            scored_chains[["chain_id", "person_canon", "year",
                           "sequence_add", "max_add", "tricks_normalized"]]
            .sort_values("sequence_add", ascending=False)
            .head(10)
            .to_dict(orient="records")
        ) if len(scored_chains) else [],
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description=(
            "Normalize trick sequences by merging adjacent modifier+base tokens. "
            "Always produces both conservative and inferred outputs."
        )
    )
    ap.add_argument("--sequences",        required=True, help="noise_trick_sequences.csv")
    ap.add_argument("--trick-dictionary", required=True, help="trick_dictionary.csv")
    ap.add_argument("--trick-aliases",    required=True, help="trick_aliases.csv")
    ap.add_argument("--trick-modifiers",  required=True, help="trick_modifiers.csv")
    ap.add_argument("--tricks-v1",        required=True, help="tricks_v1.csv (provides base-category set)")
    ap.add_argument("--out-dir",          required=True, help="Output directory")
    ap.add_argument("--max-window", type=int, default=MAX_WINDOW,
                    help=f"Max merge window size (default {MAX_WINDOW})")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    trick_dict  = load_trick_dictionary(Path(args.trick_dictionary))
    aliases     = load_trick_aliases(Path(args.trick_aliases))
    modifiers   = load_modifiers(Path(args.trick_modifiers))
    base_tricks = load_base_tricks(Path(args.tricks_v1))

    seq_df = pd.read_csv(args.sequences, low_memory=False)
    seq_df = seq_df.sort_values(["chain_id", "sequence_index"])

    # Parallel accumulators for conservative and inferred modes
    con_trick_rows:  list[dict] = []
    con_chain_rows:  list[dict] = []
    con_merge_rows:  list[dict] = []
    con_resid_rows:  list[dict] = []

    inf_trick_rows:  list[dict] = []
    inf_chain_rows:  list[dict] = []
    inf_merge_rows:  list[dict] = []
    inf_resid_rows:  list[dict] = []

    for chain_id, group in seq_df.groupby("chain_id", sort=False):
        group  = group.sort_values("sequence_index")
        tokens = group["trick_canon"].fillna("").tolist()
        first  = group.iloc[0]

        meta = {
            "chain_id":               chain_id,
            "event_id":               first.get("event_id"),
            "year":                   first.get("year"),
            "person_id":              first.get("person_id"),
            "person_canon":           first.get("person_canon"),
            "match_type":             first.get("match_type"),
            "attribution_confidence": first.get("attribution_confidence"),
        }

        # ── Conservative pass ─────────────────────────────────────────────
        norm_con = normalize_chain(
            tokens, trick_dict, aliases, modifiers, base_tricks,
            args.max_window, include_inferred=False,
        )
        cr, tr, mr, rr = _build_chain_stats(chain_id, meta, tokens, norm_con)
        con_chain_rows.append(cr)
        con_trick_rows.extend(tr)
        con_merge_rows.extend(mr)
        con_resid_rows.extend(rr)

        # ── Inferred pass ─────────────────────────────────────────────────
        norm_inf = normalize_chain(
            tokens, trick_dict, aliases, modifiers, base_tricks,
            args.max_window, include_inferred=True,
        )
        cr2, tr2, mr2, rr2 = _build_chain_stats(chain_id, meta, tokens, norm_inf)
        inf_chain_rows.append(cr2)
        inf_trick_rows.extend(tr2)
        inf_merge_rows.extend(mr2)
        inf_resid_rows.extend(rr2)

    # ── Build DataFrames ──────────────────────────────────────────────────
    con_trick_df = pd.DataFrame(con_trick_rows)
    con_chain_df = pd.DataFrame(con_chain_rows)
    con_merge_df = pd.DataFrame(con_merge_rows)
    con_resid_df = pd.DataFrame(con_resid_rows)

    inf_trick_df = pd.DataFrame(inf_trick_rows)
    inf_chain_df = pd.DataFrame(inf_chain_rows)
    inf_merge_df = pd.DataFrame(inf_merge_rows)
    inf_resid_df = pd.DataFrame(inf_resid_rows)

    seq_df_len = len(seq_df)

    # ── Summaries ─────────────────────────────────────────────────────────
    con_summary = _make_summary("conservative", seq_df_len,
                                con_trick_df, con_chain_df, con_resid_df, args.max_window)
    inf_summary = _make_summary("inferred",     seq_df_len,
                                inf_trick_df, inf_chain_df, inf_resid_df, args.max_window)

    # ── Delta table ───────────────────────────────────────────────────────
    def _delta(a, b):
        if a is None or b is None:
            return None
        try:
            d = round(b - a, 3)
            return f"{'+' if d > 0 else ''}{d}"
        except TypeError:
            return None

    delta = {
        "fully_scored_chains": {
            "conservative": con_summary["fully_scored_chains"],
            "inferred":     inf_summary["fully_scored_chains"],
            "delta":        _delta(con_summary["fully_scored_chains"],
                                   inf_summary["fully_scored_chains"]),
        },
        "chains_with_score": {
            "conservative": con_summary["chains_with_score"],
            "inferred":     inf_summary["chains_with_score"],
            "delta":        _delta(con_summary["chains_with_score"],
                                   inf_summary["chains_with_score"]),
        },
        "unresolved_modifiers": {
            "conservative": con_summary["unresolved_modifiers"],
            "inferred":     inf_summary["unresolved_modifiers"],
            "delta":        _delta(con_summary["unresolved_modifiers"],
                                   inf_summary["unresolved_modifiers"]),
        },
        "merges_performed": {
            "conservative": con_summary["merges_performed"],
            "inferred":     inf_summary["merges_performed"],
            "delta":        _delta(con_summary["merges_performed"],
                                   inf_summary["merges_performed"]),
        },
        "avg_sequence_add": {
            "conservative": con_summary["avg_sequence_add"],
            "inferred":     inf_summary["avg_sequence_add"],
            "delta":        _delta(con_summary["avg_sequence_add"],
                                   inf_summary["avg_sequence_add"]),
        },
        "avg_max_add": {
            "conservative": con_summary["avg_max_add"],
            "inferred":     inf_summary["avg_max_add"],
            "delta":        _delta(con_summary["avg_max_add"],
                                   inf_summary["avg_max_add"]),
        },
    }

    # ── Inferred-only merges (those added beyond conservative) ────────────
    inferred_only_merges = (
        inf_merge_df[inf_merge_df["merge_method"] == "inferred"]
        if not inf_merge_df.empty else pd.DataFrame()
    )

    # ── Write outputs ─────────────────────────────────────────────────────
    outputs: dict[str, "pd.DataFrame"] = {
        "sequence_difficulty_conservative.csv": con_chain_df,
        "sequence_difficulty_inferred.csv":     inf_chain_df,
        "sequence_tricks_conservative.csv":     con_trick_df,
        "sequence_tricks_inferred.csv":         inf_trick_df,
        "sequence_merge_log_conservative.csv":  con_merge_df,
        "sequence_merge_log_inferred.csv":      inf_merge_df,
        "sequence_unresolved_residues.csv":     inf_resid_df,   # residues after inferred pass
        "sequence_inferred_only_merges.csv":    inferred_only_merges,
        # keep legacy names pointing at conservative output for backward compat
        "sequence_difficulty_normalized.csv":   con_chain_df,
        "sequence_tricks_normalized.csv":       con_trick_df,
        "sequence_merge_log.csv":               con_merge_df,
    }

    print("Wrote:")
    for fname, df in outputs.items():
        p = out_dir / fname
        df.to_csv(p, index=False)
        print(f"  {p}  ({len(df)} rows)")

    combined_summary = {
        "conservative": con_summary,
        "inferred":     inf_summary,
        "delta":        delta,
    }
    summary_path = out_dir / "sequence_normalization_summary.json"
    summary_path.write_text(
        json.dumps(combined_summary, indent=2, default=str), encoding="utf-8"
    )
    print(f"  {summary_path}")

    # ── Print delta report ────────────────────────────────────────────────
    print("\n" + "═" * 60)
    print("  NORMALIZATION DELTA: conservative → inferred")
    print("═" * 60)
    rows = [
        ("fully scored chains",   delta["fully_scored_chains"]),
        ("chains with any score", delta["chains_with_score"]),
        ("merges performed",      delta["merges_performed"]),
        ("unresolved modifiers",  delta["unresolved_modifiers"]),
        ("avg sequence ADD",      delta["avg_sequence_add"]),
        ("avg max ADD per chain", delta["avg_max_add"]),
    ]
    for label, d in rows:
        print(f"  {label:<28}  {d['conservative']:>6}  →  {d['inferred']:>6}  ({d['delta']})")
    print("═" * 60)

    if not inferred_only_merges.empty:
        print(f"\n  Inferred-only merges ({len(inferred_only_merges)} total):")
        breakdown = inferred_only_merges["merged_to"].value_counts().head(20)
        for trick, count in breakdown.items():
            print(f"    {count:>4}×  {trick}")


if __name__ == "__main__":
    main()
