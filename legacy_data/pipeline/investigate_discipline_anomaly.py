#!/usr/bin/env python3
"""
pipeline/investigate_discipline_anomaly.py

Forensic investigation script for structural discipline anomalies in canonical CSVs.
Designed to diagnose root causes for anomalies flagged by the reshape_doubles_to_singles
heuristic (duplicate person_id at multiple placements, suspicious placement gaps, etc.).

THIS SCRIPT IS READ-ONLY.  It never modifies canonical outputs, the fix registry,
or any pipeline state.  Output goes to stdout plus optional --output-csv / --output-json.

Default target:
    event_key=2004_jfk
    discipline_key=open_singles_net_open_doubles_net

Usage:
    python pipeline/investigate_discipline_anomaly.py \\
        --event-key 2004_jfk \\
        --discipline-key open_singles_net_open_doubles_net

    python pipeline/investigate_discipline_anomaly.py \\
        --event-key 2004_jfk \\
        --discipline-key open_singles_net_open_doubles_net \\
        --person-id 59947054-0169-5c1c-9c45-2acb21062826 \\
        --output-csv out/investigation_2004_jfk.csv \\
        --output-json out/investigation_2004_jfk.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "out" / "canonical"

sys.path.insert(0, str(Path(__file__).parent))
from discipline_repair import (
    ANALYSIS_THRESHOLD,
    REPAIR_THRESHOLD,
    reshape_discipline,
    select_competitor,
    has_embedded_ordinal,
    is_placeholder,
    is_ghost_partner_row,
)


# ===========================================================================
# Analysis helpers — public so tests can import them directly
# ===========================================================================

def normalize_name(name: str) -> str:
    """
    Strip artifact text from a raw participant name for comparison purposes.

    Removes:
      - embedded ordinal artifacts: "Alice 3. Bob" → "Alice Bob"
      - leading/trailing whitespace
      - runs of internal whitespace → single space

    Does NOT lowercase — callers should .lower() before equality comparison.
    """
    stripped = name.strip()
    cleaned = re.sub(r'\s+\d+\.\s+', ' ', stripped)   # "N. " artifacts
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip()


def compare_names(name1: str, name2: str) -> dict:
    """
    Compare two raw names after normalization.

    Returns:
        raw_1, raw_2            original strings
        normalized_1/2          after artifact stripping
        materially_identical    True if normalized forms match case-insensitively
    """
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    return {
        "raw_1": name1,
        "raw_2": name2,
        "normalized_1": n1,
        "normalized_2": n2,
        "materially_identical": n1.strip().lower() == n2.strip().lower(),
    }


# Cluster-split threshold: a gap larger than this separates placements
# into distinct clusters (potential separate competitive sections).
_CLUSTER_GAP_THRESHOLD = 3


def analyze_placement_structure(placements: list[int]) -> dict:
    """
    Analyse the distribution of placement numbers for structural patterns.

    Returns:
        sorted          sorted unique placement list
        clusters        list of placement groups (each a sorted list)
        gaps            list of (from_pl, to_pl, gap_size) tuples
        max_gap         largest gap
        outliers        single-placement clusters separated by a large gap
        n_clusters      number of distinct clusters
        hypothesis      one of: contiguous | sparse_with_gaps | possible_merged_sets | empty
    """
    if not placements:
        return {
            "sorted": [], "clusters": [], "gaps": [],
            "max_gap": 0, "outliers": [], "n_clusters": 0, "hypothesis": "empty",
        }

    sorted_pl = sorted(set(placements))
    n = len(sorted_pl)

    gaps = [
        (sorted_pl[i], sorted_pl[i + 1], sorted_pl[i + 1] - sorted_pl[i])
        for i in range(n - 1)
    ]
    max_gap = max((g[2] for g in gaps), default=0)

    # Build clusters: split where gap > _CLUSTER_GAP_THRESHOLD
    clusters: list[list[int]] = [[sorted_pl[0]]]
    for i in range(1, n):
        if sorted_pl[i] - sorted_pl[i - 1] <= _CLUSTER_GAP_THRESHOLD:
            clusters[-1].append(sorted_pl[i])
        else:
            clusters.append([sorted_pl[i]])

    # Outliers: single-placement clusters when there are multiple clusters
    outliers = [c[0] for c in clusters if len(c) == 1 and len(clusters) > 1]

    # Hypothesis label
    if len(clusters) >= 2 and max_gap > _CLUSTER_GAP_THRESHOLD:
        hypothesis = "possible_merged_sets"
    elif max_gap > 2:
        hypothesis = "sparse_with_gaps"
    else:
        hypothesis = "contiguous"

    return {
        "sorted": sorted_pl,
        "clusters": clusters,
        "gaps": gaps,
        "max_gap": max_gap,
        "outliers": outliers,
        "n_clusters": len(clusters),
        "hypothesis": hypothesis,
    }


def collect_duplicate_persons(resolved: list[tuple]) -> list[dict]:
    """
    Given the heuristic-resolved winners, return entries where the same
    person_id appears at more than one placement.

    resolved: list of (placement, winner_row, discarded_row, reason)

    Returns list of dicts:
        pid           person_id string
        placements    sorted list of placements where it appears
        raw_names     raw display_name for each appearance (in placement order)
        name_comparison  compare_names result for the first two appearances
    """
    pid_map: dict[str, list[dict]] = defaultdict(list)
    for pl, winner, _, _ in resolved:
        if not winner:
            continue
        pid = (winner.get("person_id") or "").strip()
        if pid:
            pid_map[pid].append({
                "placement": pl,
                "raw_name":  winner.get("display_name", ""),
            })

    result = []
    for pid, entries in pid_map.items():
        if len(entries) < 2:
            continue
        entries_sorted = sorted(entries, key=lambda e: e["placement"])
        raw_names = [e["raw_name"] for e in entries_sorted]
        result.append({
            "pid":       pid,
            "placements": [e["placement"] for e in entries_sorted],
            "raw_names":  raw_names,
            "name_comparison": compare_names(raw_names[0], raw_names[1]),
        })
    return result


def collect_link_inconsistencies(all_participants: list[dict]) -> list[dict]:
    """
    Scan all participant rows for person_id linkage inconsistencies:

    1. same_pid_different_names: one UUID linked to materially different
       normalized names (potential bad linkage).
    2. same_name_different_pids: same normalized name mapped to different
       UUIDs (potential split identity or OCR variant).

    Returns list of issue dicts.
    """
    pid_to_names: dict[str, set[str]] = defaultdict(set)
    name_to_pids: dict[str, set[str]] = defaultdict(set)

    for p in all_participants:
        pid  = (p.get("person_id") or "").strip()
        name = normalize_name(p.get("display_name", "")).lower()
        if pid and name and not is_placeholder(p.get("display_name", "")):
            pid_to_names[pid].add(name)
            name_to_pids[name].add(pid)

    issues = []
    for pid, names in pid_to_names.items():
        if len(names) > 1:
            issues.append({
                "type":      "same_pid_different_names",
                "pid":       pid,
                "raw_names": list(names),
            })
    for name, pids in name_to_pids.items():
        if len(pids) > 1:
            issues.append({
                "type":        "same_name_different_pids",
                "norm_name":   name,
                "person_ids":  list(pids),
            })
    return issues


def generate_verdict(
    structure: dict,
    dup_persons: list[dict],
    link_inconsistencies: list[dict],
) -> tuple[str, list[str]]:
    """
    Produce a heuristic root-cause verdict.

    Returns (verdict_code, [supporting_evidence_strings]).

    verdict_code ∈ {
        LIKELY_MERGED_PLACEMENT_SETS  — two separate competitive sections merged
        LIKELY_BAD_PERSON_LINKAGE     — UUID linked to the wrong participant
        LIKELY_DUPLICATE_CONFLATED_STRING — same name entered twice / OCR artifact
        INCONCLUSIVE                  — insufficient evidence for any specific cause
    }

    THIS VERDICT IS HEURISTIC.  It is a navigational aid, not a data correction.
    """
    scores: dict[str, int] = defaultdict(int)
    evidence: list[str] = []
    outlier_set = set(structure.get("outliers", []))

    # Placement structure signal
    if structure["hypothesis"] == "possible_merged_sets":
        scores["LIKELY_MERGED_PLACEMENT_SETS"] += 2
        evidence.append(
            f"Placement structure: {structure['n_clusters']} cluster(s) separated by "
            f"gap={structure['max_gap']}  (clusters: {structure['clusters']})"
        )

    # Duplicate person signals
    for dup in dup_persons:
        main_pls    = [p for p in dup["placements"] if p not in outlier_set]
        outlier_pls = [p for p in dup["placements"] if p in outlier_set]
        nc = dup["name_comparison"]

        if outlier_pls and main_pls:
            # Same person in main cluster AND isolated outlier section
            scores["LIKELY_MERGED_PLACEMENT_SETS"] += 3
            evidence.append(
                f"pid={dup['pid'][:8]} in main cluster {main_pls} AND "
                f"outlier section {outlier_pls} — consistent with two merged "
                f"competitive sections"
            )
            if nc["materially_identical"]:
                # Identical name → same real person in two sections, not a
                # transcription error that snuck into the same UUID.
                scores["LIKELY_MERGED_PLACEMENT_SETS"] += 1
                evidence.append(
                    f"  Names are identical ('{nc['raw_1']}') → this is the same "
                    f"real person in two sections, not a name-match artifact"
                )
        elif not outlier_pls:
            # Duplicate within the main cluster
            if nc["materially_identical"]:
                scores["LIKELY_DUPLICATE_CONFLATED_STRING"] += 2
                evidence.append(
                    f"pid={dup['pid'][:8]} at placements {dup['placements']} "
                    f"with identical name — possible double-entry or OCR duplication"
                )
            else:
                scores["LIKELY_BAD_PERSON_LINKAGE"] += 2
                evidence.append(
                    f"pid={dup['pid'][:8]} at placements {dup['placements']} "
                    f"with different names {dup['raw_names']} — possible bad linkage"
                )

    # Link inconsistency signals
    for inc in link_inconsistencies:
        if inc["type"] == "same_pid_different_names":
            # Only flag if the normalized names are materially different
            names = inc["raw_names"]
            if len(names) >= 2:
                cmp = compare_names(names[0], names[1])
                if not cmp["materially_identical"]:
                    scores["LIKELY_BAD_PERSON_LINKAGE"] += 2
                    evidence.append(
                        f"pid={inc['pid'][:8]} linked to materially different "
                        f"normalized names: {names}"
                    )

    if not scores:
        return "INCONCLUSIVE", ["No strong signals for any specific root cause."]

    best = max(scores, key=lambda k: scores[k])
    if scores[best] < 2:
        return "INCONCLUSIVE", evidence or ["Evidence below threshold for a definitive hypothesis."]

    return best, evidence


# ===========================================================================
# Data loading helpers
# ===========================================================================

def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def find_cross_event_appearances(
    person_id: str,
    canonical_dir: Path,
    exclude_disc: tuple[str, str] | None = None,
) -> list[dict]:
    """
    Load ALL participant rows and return appearances of person_id outside
    the target discipline.  Results are sorted by event_key.
    """
    rows = load_csv(canonical_dir / "event_result_participants.csv")
    return [
        r for r in rows
        if (r.get("person_id") or "").strip() == person_id
        and (exclude_disc is None or
             (r["event_key"], r["discipline_key"]) != exclude_disc)
    ]


# ===========================================================================
# Report sections
# ===========================================================================

W = 72  # report width


def _hr(char: str = "-") -> str:
    return char * W


def _section(title: str) -> str:
    return f"\n{'=' * W}\n  {title}\n{'=' * W}"


def _print_placement_table(
    by_placement: dict[int, list[dict]],
    resolved_map: dict[int, dict],    # placement → winner_row
) -> None:
    print()
    print(_hr())
    print(f"  {'PL':>4}  {'ORD':>3}  {'SEL':>3}  {'PID':>9}  {'ANOMALY':<22}  NAME")
    print(_hr())

    for pl in sorted(by_placement.keys()):
        for row in by_placement[pl]:
            name  = row.get("display_name", "").strip()
            pid   = (row.get("person_id") or "").strip()
            order = row.get("participant_order", "?")

            # Is this row the heuristic-selected winner?
            winner = resolved_map.get(pl)
            selected = "✓" if (winner is not None and winner is row) else " "

            anomalies = []
            if is_ghost_partner_row(row):
                anomalies.append("GHOST")
            elif is_placeholder(name):
                anomalies.append("PLACEHOLDER")
            if has_embedded_ordinal(name):
                anomalies.append("EMBEDDED_ORD")

            pid_short = pid[:9] if pid else "—"
            anom_str  = ",".join(anomalies) if anomalies else "—"
            print(f"  {pl:>4}  {order:>3}  {selected:>3}  {pid_short:>9}  "
                  f"{anom_str:<22}  {name}")


def _print_placement_structure(structure: dict) -> None:
    print(_section("2. PLACEMENT STRUCTURE"))
    print(f"\n  Placement sequence: {structure['sorted']}")
    print(f"  Total placements:   {len(structure['sorted'])}")
    print(f"  Clusters ({structure['n_clusters']}):")
    for i, cluster in enumerate(structure["clusters"], 1):
        tag = "  ← OUTLIER" if len(cluster) == 1 and structure["n_clusters"] > 1 else ""
        print(f"    [{i}] {cluster}{tag}")
    if structure["gaps"]:
        print(f"\n  Gaps (from → to, size):")
        for a, b, gap in structure["gaps"]:
            flag = " ← LARGE GAP" if gap > _CLUSTER_GAP_THRESHOLD else ""
            print(f"    {a:>4} → {b:<4}  gap={gap}{flag}")
    print(f"\n  Max gap:   {structure['max_gap']}")
    print(f"  Outliers:  {structure['outliers'] or 'none'}")
    print(f"  Hypothesis: {structure['hypothesis'].upper()}")

    hints = _placement_format_hints(structure)
    if hints:
        print(f"\n  Format hints:")
        for h in hints:
            print(f"    • {h}")


def _placement_format_hints(structure: dict) -> list[str]:
    """Non-authoritative heuristic labels for the placement distribution."""
    hints = []
    n = len(structure["sorted"])
    max_pl = max(structure["sorted"]) if structure["sorted"] else 0
    max_gap = structure["max_gap"]

    if structure["hypothesis"] == "contiguous":
        hints.append(f"Sequential 1–{max_pl}: consistent with a single final ranking.")
    elif structure["hypothesis"] == "possible_merged_sets":
        hints.append(
            f"Multiple clusters (gap={max_gap}): consistent with merged result sets "
            f"(e.g. main bracket + consolation, singles + doubles, pool + finals)."
        )
        if structure["outliers"]:
            out = structure["outliers"]
            hints.append(
                f"Isolated outlier(s) at {out}: placement(s) from a separate "
                f"competitive section or consolation bracket."
            )
    elif structure["hypothesis"] == "sparse_with_gaps":
        hints.append(
            f"Sparse with gap={max_gap}: may reflect tie-adjusted ranking "
            f"or partially recorded results."
        )
    return hints


def _print_duplicate_persons(
    dup_persons: list[dict],
    structure: dict,
) -> None:
    print(_section("3. DUPLICATE PERSON ANALYSIS"))

    if not dup_persons:
        print("\n  No duplicate person_ids in the resolved winner list.  No anomaly.")
        return

    outlier_set = set(structure.get("outliers", []))

    for dup in dup_persons:
        pid = dup["pid"]
        print(f"\n  person_id: {pid}")
        print(f"  Appearances at placements: {dup['placements']}")
        for i, (pl, name) in enumerate(zip(dup["placements"], dup["raw_names"])):
            cluster_tag = (
                "  [OUTLIER CLUSTER]" if pl in outlier_set else "  [MAIN CLUSTER]"
            )
            print(f"    P{pl:>3}: '{name}'{cluster_tag}")

        nc = dup["name_comparison"]
        print(f"\n  Raw string comparison:")
        print(f"    Appearance 1  raw:        '{nc['raw_1']}'")
        print(f"    Appearance 1  normalized: '{nc['normalized_1']}'")
        print(f"    Appearance 2  raw:        '{nc['raw_2']}'")
        print(f"    Appearance 2  normalized: '{nc['normalized_2']}'")
        if nc["materially_identical"]:
            print(f"    → Strings are IDENTICAL after normalization.")
            print(f"      This is the same real person, not a transcription variant.")
            print(f"      The duplicate is a structural anomaly, not a name-matching error.")
        else:
            print(f"    → Strings DIFFER after normalization.")
            print(f"      Possible bad person_id linkage or transcription of different names.")


def _print_person_link_audit(
    all_participants: list[dict],
    flagged_pids: list[str],
    link_inconsistencies: list[dict],
) -> None:
    print(_section("4. PERSON-LINK AUDIT (this discipline only)"))

    # Per-PID name consistency within this discipline
    pid_to_rows: dict[str, list[dict]] = defaultdict(list)
    for p in all_participants:
        pid = (p.get("person_id") or "").strip()
        if pid:
            pid_to_rows[pid].append(p)

    print(f"\n  Persons with a person_id: {len(pid_to_rows)}")

    for pid, rows in sorted(pid_to_rows.items()):
        names = sorted({r.get("display_name", "") for r in rows})
        placements = sorted({int(r["placement"]) for r in rows})
        flag = " ← FLAGGED DUPLICATE" if pid in flagged_pids else ""
        print(f"\n  {pid}{flag}")
        print(f"    placements: {placements}")
        print(f"    raw names:  {names}")
        if len(names) > 1:
            print(f"    [INCONSISTENCY] One UUID, multiple names in this discipline.")

    if link_inconsistencies:
        print(f"\n  Cross-row inconsistencies:")
        for inc in link_inconsistencies:
            if inc["type"] == "same_pid_different_names":
                print(f"    same_pid_different_names: pid={inc['pid'][:8]}  "
                      f"names={inc['raw_names']}")
            elif inc["type"] == "same_name_different_pids":
                print(f"    same_name_different_pids: norm='{inc['norm_name']}'  "
                      f"pids={[p[:8] for p in inc['person_ids']]}")
    else:
        print(f"\n  No link inconsistencies detected within this discipline.")


def _print_cross_event_context(
    person_id: str,
    display_name: str,
    cross_rows: list[dict],
    events_index: dict[str, dict],
) -> None:
    print(_section(f"5. CROSS-EVENT CONTEXT  (pid={person_id[:8]})"))
    print(f"\n  Canonical name:  {display_name}")
    print(f"  Other events where this person appears ({len(cross_rows)} rows):")

    if not cross_rows:
        print("    (none)")
        return

    # Group by event
    by_event: dict[str, list[dict]] = defaultdict(list)
    for r in cross_rows:
        by_event[r["event_key"]].append(r)

    for ek in sorted(by_event.keys()):
        ev = events_index.get(ek, {})
        yr = ev.get("year", "?")
        name = ev.get("event_name", ek)
        rows = by_event[ek]
        for r in rows:
            disc = r.get("discipline_key", "")
            tt   = r.get("participant_order", "?")
            pl   = r.get("placement", "?")
            raw  = r.get("display_name", "")
            print(f"    {ek:<35}  P{pl:<4}  ord={tt}  disc={disc}")


def _print_verdict(verdict_code: str, evidence: list[str]) -> None:
    print(_section("6. VERDICT"))
    print(f"\n  Heuristic root-cause hypothesis: {verdict_code}")
    print()
    print("  Supporting evidence:")
    for line in evidence:
        for sub in line.split("\n"):
            print(f"    {sub}")
    print()

    explanations = {
        "LIKELY_MERGED_PLACEMENT_SETS": (
            "  Interpretation: the discipline_key 'open_singles_net_open_doubles_net'\n"
            "  is literally a merge of two competitions.  Placement clusters suggest\n"
            "  two independent result sets were combined into one canonical discipline.\n"
            "  The duplicate person appears in both sets — once as a legitimate\n"
            "  competitor in one section, once as a legitimate competitor in the other.\n"
            "  This is not a bad person link; it is a structural source problem.\n"
            "\n"
            "  Recommended action: locate the original event program or results\n"
            "  to confirm whether P1–9 are from one competition and P15+ from\n"
            "  a separate one.  If so, the discipline should be split or one\n"
            "  placement cluster discarded, not just reshaped."
        ),
        "LIKELY_BAD_PERSON_LINKAGE": (
            "  Interpretation: the same UUID is linked to participants that are\n"
            "  likely different real people.  The person-linking pass may have\n"
            "  conflated two individuals with similar names.\n"
            "\n"
            "  Recommended action: review the identity-lock file for this UUID.\n"
            "  If the link is wrong, correct it in the appropriate lock file version."
        ),
        "LIKELY_DUPLICATE_CONFLATED_STRING": (
            "  Interpretation: the same competitor string appears at two placements,\n"
            "  likely from OCR duplication, copy-paste error, or a parsing artifact\n"
            "  that cloned one result row.\n"
            "\n"
            "  Recommended action: inspect the source document.  If confirmed,\n"
            "  delete or correct the duplicate placement in the source data."
        ),
        "INCONCLUSIVE": (
            "  Interpretation: the evidence is insufficient to confidently assign\n"
            "  a root cause.  Manual inspection of the source document is needed."
        ),
    }
    print(explanations.get(verdict_code, "  No interpretation available."))
    print()
    print("  ACTIVATION RECOMMENDATION:")
    if verdict_code == "LIKELY_MERGED_PLACEMENT_SETS":
        print("  DO NOT activate the reshape_doubles_to_singles fix as-is.")
        print("  Source confirmation is required.  The underlying problem is a")
        print("  merged result set that reshape alone cannot safely resolve.")
    else:
        print("  DO NOT activate without resolving the root cause first.")
    print()
    print("  This verdict is heuristic.  It is a navigational aid, not a data correction.")


# ===========================================================================
# Main
# ===========================================================================

def build_report(ek: str, dk: str, focus_pid: str | None = None) -> dict:
    """
    Build the full investigation report as a structured dict.
    Also prints the human-readable version to stdout.
    """
    # Load data
    events_list = load_csv(CANONICAL / "events.csv")
    events_index = {e["event_key"]: e for e in events_list}

    all_discs  = {(d["event_key"], d["discipline_key"]): d
                  for d in load_csv(CANONICAL / "event_disciplines.csv")}
    all_results = [r for r in load_csv(CANONICAL / "event_results.csv")
                   if r["event_key"] == ek and r["discipline_key"] == dk]
    all_parts  = [p for p in load_csv(CANONICAL / "event_result_participants.csv")
                  if p["event_key"] == ek and p["discipline_key"] == dk]

    event = events_index.get(ek)
    disc  = all_discs.get((ek, dk))

    # ── Header ───────────────────────────────────────────────────────────────
    print(_hr("="))
    print("  DISCIPLINE ANOMALY INVESTIGATION")
    print(_hr("="))
    print(f"\n  event_key:       {ek}")
    if event:
        print(f"  event_name:      {event.get('event_name', '')} ({event.get('year', '')})")
        loc = ", ".join(filter(None, [event.get("city"), event.get("country")]))
        print(f"  location:        {loc}")
    print(f"  discipline_key:  {dk}")
    if disc:
        print(f"  discipline_name: {disc.get('discipline_name', '')}")
        print(f"  team_type:       {disc.get('team_type', '')}  "
              f"category: {disc.get('discipline_category', '')}  "
              f"coverage: {disc.get('coverage_flag', '')}")
    print(f"\n  Result rows:      {len(all_results)}")
    print(f"  Participant rows: {len(all_parts)}")

    if not disc:
        print("\n  [ERROR] Discipline not found in event_disciplines.csv")
        sys.exit(1)
    if not all_parts:
        print("\n  [ERROR] No participant rows found.")
        sys.exit(1)

    # ── Group participants by placement ───────────────────────────────────────
    by_placement: dict[int, list[dict]] = defaultdict(list)
    for p in all_parts:
        try:
            pl = int(p["placement"])
        except (ValueError, KeyError):
            continue
        by_placement[pl].append(p)

    # ── Run heuristic ─────────────────────────────────────────────────────────
    rr = reshape_discipline(all_parts, threshold=ANALYSIS_THRESHOLD)
    resolved_map = {pl: winner for pl, winner, _, _ in rr["resolved"] if winner}

    # ── Section 1: Placement forensic table ──────────────────────────────────
    print(_section("1. PLACEMENT FORENSIC TABLE"))
    avg = len(all_parts) / len(by_placement) if by_placement else 0
    print(f"\n  Placements: {sorted(by_placement.keys())}  "
          f"(avg {avg:.2f} participants/placement)")
    print(f"  Heuristic:  {len(rr['resolved'])} resolved  "
          f"{len(rr['ambiguous'])} ambiguous  "
          f"{len(rr['unresolvable'])} unresolvable  "
          f"threshold={ANALYSIS_THRESHOLD:.0%}")
    print(f"  ✓ = heuristic-selected winner for that placement")
    _print_placement_table(by_placement, resolved_map)

    # ── Section 2: Placement structure ───────────────────────────────────────
    structure = analyze_placement_structure(list(by_placement.keys()))
    _print_placement_structure(structure)

    # ── Section 3: Duplicate person analysis ─────────────────────────────────
    dup_persons = collect_duplicate_persons(rr["resolved"])
    _print_duplicate_persons(dup_persons, structure)

    # ── Section 4: Person-link audit ─────────────────────────────────────────
    link_incons = collect_link_inconsistencies(all_parts)
    flagged_pids = [d["pid"] for d in dup_persons]
    _print_person_link_audit(all_parts, flagged_pids, link_incons)

    # ── Section 5: Cross-event context ───────────────────────────────────────
    pids_to_investigate: list[str] = []
    if focus_pid:
        pids_to_investigate = [focus_pid]
    else:
        pids_to_investigate = flagged_pids[:3]  # limit to first 3 duplicates

    for pid in pids_to_investigate:
        # Find display name for this pid in our discipline
        display_name = next(
            (r.get("display_name", pid)
             for r in all_parts if (r.get("person_id") or "").strip() == pid),
            pid,
        )
        cross_rows = find_cross_event_appearances(
            pid,
            CANONICAL,
            exclude_disc=(ek, dk),
        )
        _print_cross_event_context(pid, display_name, cross_rows, events_index)

    # ── Section 6: Verdict ───────────────────────────────────────────────────
    verdict_code, evidence = generate_verdict(structure, dup_persons, link_incons)
    _print_verdict(verdict_code, evidence)

    # Return structured data for --output-csv / --output-json
    return {
        "event_key":       ek,
        "discipline_key":  dk,
        "structure":       structure,
        "dup_persons":     dup_persons,
        "link_inconsistencies": link_incons,
        "verdict":         verdict_code,
        "evidence":        evidence,
        "heuristic": {
            "resolved":     len(rr["resolved"]),
            "ambiguous":    len(rr["ambiguous"]),
            "unresolvable": len(rr["unresolvable"]),
            "can_apply":    rr["can_apply"],
        },
    }


def write_csv_output(report: dict, path: Path) -> None:
    """Write per-placement rows and verdict to a CSV for further analysis."""
    fieldnames = ["event_key", "discipline_key", "section", "value"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerow({"event_key": report["event_key"],
                    "discipline_key": report["discipline_key"],
                    "section": "verdict",
                    "value": report["verdict"]})
        for ev in report["evidence"]:
            w.writerow({"event_key": report["event_key"],
                        "discipline_key": report["discipline_key"],
                        "section": "evidence",
                        "value": ev})
        for dup in report["dup_persons"]:
            w.writerow({"event_key": report["event_key"],
                        "discipline_key": report["discipline_key"],
                        "section": "duplicate_person",
                        "value": (f"pid={dup['pid']}  "
                                   f"placements={dup['placements']}  "
                                   f"names={dup['raw_names']}")})
    print(f"\n  CSV written: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Forensic investigation of structural discipline anomalies.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--event-key", default="2004_jfk", metavar="KEY",
        help="Event key (default: 2004_jfk)",
    )
    parser.add_argument(
        "--discipline-key",
        default="open_singles_net_open_doubles_net",
        metavar="KEY",
        help="Discipline key (default: open_singles_net_open_doubles_net)",
    )
    parser.add_argument(
        "--person-id", metavar="UUID",
        help="Focus cross-event context on a specific person_id",
    )
    parser.add_argument(
        "--output-csv", metavar="PATH",
        help="Write verdict and evidence to a CSV file",
    )
    parser.add_argument(
        "--output-json", metavar="PATH",
        help="Write full report to a JSON file",
    )
    args = parser.parse_args()

    report = build_report(
        ek=args.event_key.strip(),
        dk=args.discipline_key.strip(),
        focus_pid=args.person_id.strip() if args.person_id else None,
    )

    if args.output_csv:
        write_csv_output(report, Path(args.output_csv))

    if args.output_json:
        out_path = Path(args.output_json)
        with open(out_path, "w", encoding="utf-8") as jf:
            json.dump(report, jf, indent=2, default=str)
        print(f"\n  JSON written: {out_path}")


if __name__ == "__main__":
    main()
