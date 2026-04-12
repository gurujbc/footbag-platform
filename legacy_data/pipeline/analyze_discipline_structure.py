#!/usr/bin/env python3
"""
pipeline/analyze_discipline_structure.py

Read-only diagnostic for investigating structural anomalies in a canonical
discipline.  Useful for evaluating whether a reshape_doubles_to_singles fix
in canonical_discipline_fixes.csv would be safe to activate.

Usage:
    python pipeline/analyze_discipline_structure.py \\
        --event-key 2004_jfk \\
        --discipline-key open_singles_net_open_doubles_net

No files are written.  All output goes to stdout.

Exit codes:
    0   analysis complete (does not mean the repair is safe — check output)
    1   discipline not found in canonical CSVs
"""

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "out" / "canonical"

sys.path.insert(0, str(Path(__file__).parent))
from discipline_repair import (
    ANALYSIS_THRESHOLD,
    REPAIR_THRESHOLD,
    has_embedded_ordinal,
    is_clean_competitor,
    is_duplicate_name,
    is_ghost_partner_row,
    is_placeholder,
    reshape_discipline,
    select_competitor,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_csv(name: str) -> list[dict]:
    path = CANONICAL / name
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _anomaly_labels(row: dict) -> list[str]:
    name = row.get("display_name", "").strip()
    labels = []
    if is_ghost_partner_row(row):
        labels.append("GHOST_PARTNER")
    elif is_placeholder(name):
        labels.append("PLACEHOLDER")
    if has_embedded_ordinal(name):
        labels.append("EMBEDDED_ORDINAL")
    if is_duplicate_name(name):
        labels.append("DUPLICATE_NAME")
    return labels


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Diagnose structural discipline anomalies in canonical CSVs."
    )
    parser.add_argument("--event-key", required=True, metavar="KEY",
                        help="e.g. 2004_jfk")
    parser.add_argument("--discipline-key", required=True, metavar="KEY",
                        help="e.g. open_singles_net_open_doubles_net")
    args = parser.parse_args()

    ek = args.event_key.strip()
    dk = args.discipline_key.strip()

    # Load data
    events      = {e["event_key"]: e for e in load_csv("events.csv")}
    all_discs   = {(d["event_key"], d["discipline_key"]): d
                   for d in load_csv("event_disciplines.csv")}
    all_results = [r for r in load_csv("event_results.csv")
                   if r["event_key"] == ek and r["discipline_key"] == dk]
    all_parts   = [p for p in load_csv("event_result_participants.csv")
                   if p["event_key"] == ek and p["discipline_key"] == dk]

    event = events.get(ek)
    disc  = all_discs.get((ek, dk))

    W = 72
    print("=" * W)
    print("  STRUCTURAL DISCIPLINE ANALYSIS")
    print("=" * W)

    # Event header
    if event:
        print(f"  Event:      {event.get('event_name', '')} ({event.get('year', '')})")
        print(f"  event_key:  {ek}")
        loc = ", ".join(filter(None, [event.get("city"), event.get("country")]))
        if loc:
            print(f"  Location:   {loc}")
    else:
        print(f"  event_key:  {ek}  [NOT FOUND in events.csv]")

    # Discipline header
    if disc:
        print(f"  Discipline: {disc.get('discipline_name', '')}")
        print(f"  disc_key:   {dk}")
        print(f"  category:   {disc.get('discipline_category', '')}  "
              f"team_type: {disc.get('team_type', '')}  "
              f"coverage: {disc.get('coverage_flag', '')}")
    else:
        print(f"  disc_key:   {dk}  [NOT FOUND in event_disciplines.csv]")
        print("=" * W)
        sys.exit(1)

    print(f"\n  Result rows:      {len(all_results)}")
    print(f"  Participant rows: {len(all_parts)}")

    if not all_parts:
        print("\n  [ERROR] No participant rows found.")
        print("=" * W)
        sys.exit(1)

    # Group participants by placement
    by_placement: dict[int, list[dict]] = defaultdict(list)
    for p in all_parts:
        try:
            pl = int(p["placement"])
        except (ValueError, KeyError):
            print(f"  [WARN] Non-integer placement: {p}")
            continue
        by_placement[pl].append(p)

    avg = len(all_parts) / len(by_placement) if by_placement else 0
    print(f"  Placements:       {sorted(by_placement.keys())}")
    print(f"  Avg participants/placement: {avg:.2f}")

    # Per-placement detail table
    print()
    print("-" * W)
    print(f"  {'PL':>4}  {'ORD':>3}  {'PID_SHORT':>9}  {'ANOMALY':<22}  NAME")
    print("-" * W)

    for pl in sorted(by_placement.keys()):
        for r in by_placement[pl]:
            name  = r.get("display_name", "").strip()
            pid   = r.get("person_id", "").strip()
            order = r.get("participant_order", "?")
            anomalies = _anomaly_labels(r)
            pid_short = pid[:9] if pid else "—"
            anom_str  = ",".join(anomalies) if anomalies else "—"
            print(f"  {pl:>4}  {order:>3}  {pid_short:>9}  {anom_str:<22}  {name}")

    # Cross-event person_id reuse check
    pid_placements: dict[str, list[int]] = defaultdict(list)
    for pl in sorted(by_placement.keys()):
        for r in by_placement[pl]:
            pid = (r.get("person_id") or "").strip()
            if pid and not is_ghost_partner_row(r):
                pid_placements[pid].append(pl)

    cross_dup = [(pid, pls) for pid, pls in pid_placements.items() if len(pls) > 1]
    if cross_dup:
        print()
        print(f"  [ANOMALY] Same person_id appears at multiple placements:")
        for pid, pls in cross_dup:
            # Look up the name
            sample_name = next(
                (r.get("display_name", "") for pl in pls
                 for r in by_placement[pl] if (r.get("person_id") or "") == pid),
                "?",
            )
            print(f"    pid={pid[:8]}  placements={pls}  name={sample_name!r}")
    else:
        print()
        print("  [OK] No person_id appears at more than one placement.")

    # Heuristic dry-run — use ANALYSIS_THRESHOLD for guidance
    print()
    print("=" * W)
    print("  RESHAPE HEURISTIC DRY-RUN")
    print(f"  (analysis threshold: {ANALYSIS_THRESHOLD:.0%}  |  "
          f"repair threshold: {REPAIR_THRESHOLD:.0%})")
    print("=" * W)

    analysis_result = reshape_discipline(all_parts, threshold=ANALYSIS_THRESHOLD)
    repair_result   = reshape_discipline(all_parts, threshold=REPAIR_THRESHOLD)

    n_resolved     = len(analysis_result["resolved"])
    n_ambiguous    = len(analysis_result["ambiguous"])
    n_unresolvable = len(analysis_result["unresolvable"])
    total_pl       = analysis_result["total_placements"]

    print(f"\n  Resolution rate:        {analysis_result['resolution_rate']:.0%}"
          f"  ({n_resolved}/{total_pl} placements)")
    print(f"  Ambiguous placements:   {n_ambiguous}")
    print(f"  Unresolvable:           {n_unresolvable}")
    print(f"  Passes analysis threshold ({ANALYSIS_THRESHOLD:.0%}): "
          f"{'YES' if analysis_result['passes_threshold'] else 'NO'}")
    print(f"  Passes repair threshold  ({REPAIR_THRESHOLD:.0%}):   "
          f"{'YES' if repair_result['passes_threshold'] else 'NO'}")
    print(f"  Passes duplicate check:  "
          f"{'YES' if repair_result['passes_duplicate_check'] else 'NO  ← BLOCKS REPAIR'}")

    if analysis_result["ambiguous"]:
        print(f"\n  Ambiguous placements:")
        for pl, reason in analysis_result["ambiguous"]:
            print(f"    P{pl:>3}: {reason}")

    if analysis_result["unresolvable"]:
        print(f"\n  Unresolvable placements:")
        for pl, reason in analysis_result["unresolvable"]:
            print(f"    P{pl:>3}: {reason}")

    if repair_result["duplicate_person_placements"]:
        print(f"\n  Duplicate person_id in resolved winners (blocks repair):")
        for pid, pls in repair_result["duplicate_person_placements"]:
            sample_name = next(
                (r.get("display_name", "") for ppl in pls
                 for r in by_placement.get(ppl, [])
                 if (r.get("person_id") or "") == pid),
                "?",
            )
            print(f"    pid={pid[:8]}  placements={pls}  name={sample_name!r}")

    # Per-placement selection summary
    print(f"\n  Per-placement competitor selection:")
    print(f"  {'PL':>4}  {'STATUS':<12}  {'WINNER':<38}  NOTE")
    for pl, winner, discarded, reason in sorted(analysis_result["resolved"], key=lambda x: x[0]):
        w_name = (winner.get("display_name", "") if winner else "[none]")
        w_pid  = (winner.get("person_id", "") if winner else "")
        pid_note = f"pid={w_pid[:8]}" if w_pid else "no_pid"
        print(f"  {pl:>4}  {'resolved':<12}  {w_name[:38]:<38}  {pid_note}")
        if discarded:
            d_name = discarded.get("display_name", "")
            print(f"        {'↳ drop':<12}  {d_name[:38]:<38}  {reason[:50]}")
    for pl, reason in sorted(analysis_result["ambiguous"], key=lambda x: x[0]):
        print(f"  {pl:>4}  {'AMBIGUOUS':<12}  {'—':<38}  {reason[:50]}")
    for pl, reason in sorted(analysis_result["unresolvable"], key=lambda x: x[0]):
        print(f"  {pl:>4}  {'UNRESOLVABLE':<12}  {'—':<38}  {reason[:50]}")

    # Final verdict
    print()
    print("=" * W)
    print("  VERDICT")
    print("=" * W)
    if repair_result["can_apply"]:
        print()
        print("  Repair is structurally safe at the repair threshold.")
        print("  To activate: set active=1 in canonical_discipline_fixes.csv")
        print("  after confirming against the primary source.")
    else:
        print()
        print("  Repair CANNOT be safely applied with current data.")
        reasons = []
        if not repair_result["passes_threshold"]:
            reasons.append(
                f"resolution rate {repair_result['resolution_rate']:.0%} < "
                f"{REPAIR_THRESHOLD:.0%} repair threshold"
            )
        if not repair_result["passes_duplicate_check"]:
            n_dup = len(repair_result["duplicate_person_placements"])
            reasons.append(
                f"{n_dup} person_id(s) appear at multiple placements "
                f"in the resolved winners"
            )
        for r in reasons:
            print(f"    • {r}")
        print()
        print("  DO NOT activate this fix until the above issues are resolved.")
        print("  Source confirmation or data correction is required.")
    print("=" * W)


if __name__ == "__main__":
    main()
