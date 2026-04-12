#!/usr/bin/env python3
"""
report_alias_expansion_impact.py

Quantitative impact analysis of event-local alias expansion against the
current canonical dataset.  Reads canonical participants, builds per-event
name indices, and reports what WOULD change if alias expansion were applied.

Usage (from legacy_data/):
    .venv/bin/python pipeline/report_alias_expansion_impact.py

Inputs:
    out/canonical/event_result_participants.csv
    out/canonical/event_disciplines.csv

Outputs:
    stdout  — structured report
"""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Allow imports from pipeline/
sys.path.insert(0, str(Path(__file__).parent))

from event_local_alias import (
    ExpansionDiagnostics,
    build_event_name_index,
    expand_doubles_pair,
    expand_event_local_alias,
)

ROOT = Path(__file__).resolve().parent.parent  # legacy_data/
PARTICIPANTS_CSV = ROOT / "out" / "canonical" / "event_result_participants.csv"
DISCIPLINES_CSV = ROOT / "out" / "canonical" / "event_disciplines.csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_placeholder(name: str) -> bool:
    n = name.strip().lower()
    return n in (
        "[unknown partner]", "__unknown_partner__", "", "(unknown)",
    )


def _classify_unresolved_name(name: str) -> str:
    """Classify an unresolved display_name into a pattern bucket."""
    n = name.strip()
    if _is_placeholder(n):
        return "placeholder"
    if "/" in n:
        return "slash_unsplit"
    # "T. Lewis" or "J. Tikhomirova" pattern
    if re.match(r"^[A-Z]\.\s+\S", n):
        return "initial_dot_lastname"
    # "PT" or "FL" — all uppercase, 2-3 chars
    if re.match(r"^[A-Z]{2,3}$", n):
        return "uppercase_initials"
    # Single word, no spaces
    if " " not in n:
        return "single_token"
    # Multi-word but unresolved (full name that didn't match PT)
    return "full_name_unresolved"


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def main() -> None:
    if not PARTICIPANTS_CSV.exists():
        print(f"ERROR: {PARTICIPANTS_CSV} not found. Run the pipeline first.")
        sys.exit(1)

    # ── Load participants ──────────────────────────────────────────────
    with open(PARTICIPANTS_CSV, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        all_participants = list(reader)

    # ── Load disciplines (for team_type) ───────────────────────────────
    doubles_disc_keys: set[tuple[str, str]] = set()
    if DISCIPLINES_CSV.exists():
        with open(DISCIPLINES_CSV, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("team_type") == "doubles":
                    doubles_disc_keys.add((row["event_key"], row["discipline_key"]))

    # ── Group by event ─────────────────────────────────────────────────
    by_event: dict[str, list[dict]] = defaultdict(list)
    for p in all_participants:
        by_event[p["event_key"]].append(p)

    # ── Baseline metrics ───────────────────────────────────────────────
    total_rows = len(all_participants)
    resolved_rows = sum(1 for p in all_participants if p["person_id"].strip())
    unresolved_rows = total_rows - resolved_rows
    placeholder_count = sum(1 for p in all_participants if _is_placeholder(p["display_name"]))
    ghost_count = sum(1 for p in all_participants
                      if "__UNKNOWN_PARTNER__" in p.get("display_name", ""))

    # Classify unresolved names
    unresolved_pattern_counts: Counter[str] = Counter()
    unresolved_examples: dict[str, list[str]] = defaultdict(list)
    for p in all_participants:
        if not p["person_id"].strip():
            pat = _classify_unresolved_name(p["display_name"])
            unresolved_pattern_counts[pat] += 1
            if len(unresolved_examples[pat]) < 5:
                unresolved_examples[pat].append(
                    f'  {p["event_key"]} | {p["discipline_key"]} | '
                    f'P{p["placement"]}:{p["participant_order"]} | '
                    f'"{p["display_name"]}"'
                )

    # ── Run alias expansion analysis per event ─────────────────────────
    diag = ExpansionDiagnostics()
    expansion_hits: list[dict] = []       # successful expansions
    expansion_misses: list[dict] = []     # attempted but failed
    expansion_ambiguous: list[dict] = []  # ambiguous, correctly left alone

    events_with_potential = 0
    events_analyzed = 0

    for event_key, participants in sorted(by_event.items()):
        events_analyzed += 1

        # Build event-local index from resolved participants
        index = build_event_name_index(participants)

        # Skip events with no resolved names (nothing to expand from)
        if not index.first_name_index:
            continue

        # Find unresolved participants in doubles disciplines
        unresolved_in_doubles = [
            p for p in participants
            if not p["person_id"].strip()
            and not _is_placeholder(p["display_name"])
            and (p["event_key"], p["discipline_key"]) in doubles_disc_keys
        ]

        if not unresolved_in_doubles:
            continue

        events_with_potential += 1

        for p in unresolved_in_doubles:
            name = p["display_name"].strip()
            result = expand_event_local_alias(name, index)
            diag.attempted += 1

            row_info = {
                "event_key": p["event_key"],
                "discipline_key": p["discipline_key"],
                "placement": p["placement"],
                "order": p["participant_order"],
                "original": name,
                "expanded": result.expanded,
                "method": result.method,
            }

            if result.expanded and not result.is_full_name:
                diag.success += 1
                expansion_hits.append(row_info)
            elif result.expanded is None:
                # Check if ambiguous
                token_lower = name.lower()
                found_multi = (
                    len(index.first_name_index.get(token_lower, [])) > 1
                    or len(index.last_name_index.get(token_lower, [])) > 1
                    or len(index.initials_index.get(token_lower, [])) > 1
                )
                if found_multi:
                    diag.ambiguous += 1
                    expansion_ambiguous.append(row_info)
                else:
                    diag.no_match += 1
                    expansion_misses.append(row_info)
            else:
                diag.already_full += 1

    # ── Print report ───────────────────────────────────────────────────
    sep = "=" * 72
    print(sep)
    print("  EVENT-LOCAL ALIAS EXPANSION — IMPACT ANALYSIS")
    print(sep)
    print()

    print("A. BASELINE DATASET METRICS")
    print("-" * 40)
    print(f"  Total participant rows:       {total_rows:>8,}")
    print(f"  Resolved (has person_id):     {resolved_rows:>8,}  ({100*resolved_rows/total_rows:.1f}%)")
    print(f"  Unresolved (no person_id):    {unresolved_rows:>8,}  ({100*unresolved_rows/total_rows:.1f}%)")
    print(f"  Placeholder names:            {placeholder_count:>8,}")
    print(f"  Ghost partner markers:        {ghost_count:>8,}")
    print(f"  Doubles disciplines:          {len(doubles_disc_keys):>8,}")
    print(f"  Events analyzed:              {events_analyzed:>8,}")
    print()

    print("B. UNRESOLVED NAME PATTERNS")
    print("-" * 40)
    for pat, count in unresolved_pattern_counts.most_common():
        print(f"  {pat:<30s} {count:>6,}")
    print()
    print("  Examples per pattern:")
    for pat in unresolved_pattern_counts:
        if unresolved_examples[pat]:
            print(f"  [{pat}]")
            for ex in unresolved_examples[pat]:
                print(f"    {ex}")
    print()

    print("C. ALIAS EXPANSION POTENTIAL (doubles disciplines only)")
    print("-" * 40)
    print(f"  Events with expansion potential: {events_with_potential:>6,}")
    print(f"  Tokens attempted:                {diag.attempted:>6,}")
    print(f"  Expansions successful:           {diag.success:>6,}")
    print(f"  Ambiguous (correctly skipped):   {diag.ambiguous:>6,}")
    print(f"  No match found:                  {diag.no_match:>6,}")
    print(f"  Already full name:               {diag.already_full:>6,}")
    if diag.attempted > 0:
        rate = 100 * diag.success / diag.attempted
        print(f"  Expansion rate:                  {rate:>5.1f}%")
    print()

    print("D. SUCCESSFUL EXPANSION EXAMPLES (up to 15)")
    print("-" * 40)
    if expansion_hits:
        for h in expansion_hits[:15]:
            print(f'  {h["event_key"]} | {h["discipline_key"]}')
            print(f'    P{h["placement"]}:{h["order"]}  "{h["original"]}" → "{h["expanded"]}"  [{h["method"]}]')
    else:
        print("  (none)")
    print()

    print("E. AMBIGUOUS EXAMPLES — CORRECTLY LEFT UNTOUCHED (up to 10)")
    print("-" * 40)
    if expansion_ambiguous:
        for a in expansion_ambiguous[:10]:
            print(f'  {a["event_key"]} | {a["discipline_key"]}')
            print(f'    P{a["placement"]}:{a["order"]}  "{a["original"]}" — multiple candidates, skipped')
    else:
        print("  (none)")
    print()

    print("F. UNRESOLVED — NO MATCH (sample, up to 15)")
    print("-" * 40)
    if expansion_misses:
        for m in expansion_misses[:15]:
            print(f'  {m["event_key"]} | {m["discipline_key"]}')
            print(f'    P{m["placement"]}:{m["order"]}  "{m["original"]}"')
    else:
        print("  (none)")
    print()

    # ── Expansion method breakdown ─────────────────────────────────────
    method_counts: Counter[str] = Counter()
    for h in expansion_hits:
        method_counts[h["method"] or "unknown"] += 1

    print("G. EXPANSION METHOD BREAKDOWN")
    print("-" * 40)
    if method_counts:
        for method, count in method_counts.most_common():
            print(f"  {method:<20s} {count:>6,}")
    else:
        print("  (no expansions)")
    print()

    # ── Risk checks ────────────────────────────────────────────────────
    print("H. RISK / REGRESSION CHECKS")
    print("-" * 40)

    # Check for same-person expansions (both sides of a pair expand to same person)
    same_person_risk = 0
    for h in expansion_hits:
        ek = h["event_key"]
        dk = h["discipline_key"]
        pl = h["placement"]
        # Find all hits for this placement
        same_placement_hits = [
            x for x in expansion_hits
            if x["event_key"] == ek and x["discipline_key"] == dk
            and x["placement"] == pl
        ]
        if len(same_placement_hits) >= 2:
            names = [x["expanded"] for x in same_placement_hits]
            if len(names) != len(set(names)):
                same_person_risk += 1

    print(f"  Same-person-both-sides risk:   {same_person_risk:>6}")
    print(f"  Total expansion candidates:    {diag.success:>6}")
    if diag.success > 0 and same_person_risk > 0:
        print("  *** WARNING: Some expansions may create same-person doubles pairs.")
        print("       These MUST be filtered through validate_reconstructed_doubles_pair().")
    elif diag.success > 0:
        print("  No same-person risks detected in expansion candidates.")
    print()

    # ── Verdict and recommendation ─────────────────────────────────────
    print(sep)
    print("  VERDICT AND RECOMMENDATION")
    print(sep)
    print()

    if diag.success == 0:
        print("  VERDICT: Alias expansion has NO material impact on the current dataset.")
        print()
        print("  The current canonical data does not contain the shorthand patterns")
        print("  (single-token first names, initials-only) that the expansion module")
        print("  targets in doubles disciplines. The unresolved names are primarily:")
        for pat, count in unresolved_pattern_counts.most_common(3):
            print(f"    - {pat}: {count} rows")
        print()
    elif diag.success < 10:
        print(f"  VERDICT: Alias expansion has MINIMAL impact ({diag.success} expansions).")
        print()
    else:
        print(f"  VERDICT: Alias expansion has MATERIAL impact ({diag.success} expansions).")
        print()

    # Recommend next action based on unresolved pattern distribution
    top_pattern = unresolved_pattern_counts.most_common(1)
    if top_pattern:
        pat_name, pat_count = top_pattern[0]
        print(f"  RECOMMENDED NEXT PRIORITY: Address '{pat_name}' pattern ({pat_count} rows)")
        print()
        recommendations = {
            "full_name_unresolved": (
                "  These are multi-word names not matching Persons_Truth. Options:\n"
                "    → Add person_aliases.csv entries for known variant spellings\n"
                "    → Review transliteration/diacritic handling in _norm_name()\n"
                "    → Check for mojibake or encoding issues in source data"
            ),
            "initial_dot_lastname": (
                "  These are 'T. Lewis' / 'J. Tikhomirova' patterns. Options:\n"
                "    → Extend alias expansion to handle initial-dot-lastname matching\n"
                "    → Build event-local 'T. Lewis' → 'Tanya Lewis' resolver\n"
                "    → Requires matching initial + last name against event index"
            ),
            "single_token": (
                "  These are single-word names (first name only, nickname, etc.). Options:\n"
                "    → Event-local alias expansion (the current module) targets these\n"
                "    → If expansion rate is low, the tokens may not match event context\n"
                "    → Consider adding to person_aliases.csv for known individuals"
            ),
            "placeholder": (
                "  These are placeholder markers where partner data is genuinely missing.\n"
                "    → Not addressable by parsing improvements\n"
                "    → Would require source document research"
            ),
            "slash_unsplit": (
                "  These are slash-separated pairs that weren't split by the parser.\n"
                "    → Fix in 02_canonicalize_results.py split_entry() logic\n"
                "    → Low count suggests this is a near-complete category"
            ),
            "uppercase_initials": (
                "  These are 2-3 char uppercase tokens (PT, FL, etc.).\n"
                "    → Event-local alias expansion handles these via initials matching\n"
                "    → If expansion rate is low, check whether event context has matches"
            ),
        }
        print(recommendations.get(pat_name, "  (no specific recommendation for this pattern)"))

    print()
    print(sep)


if __name__ == "__main__":
    main()
