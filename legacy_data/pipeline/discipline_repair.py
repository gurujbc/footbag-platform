"""
pipeline/discipline_repair.py

Shared heuristic for structural discipline repair.

Used by:
  - 05p5_remediate_canonical.py   Fix 0 (reshape_doubles_to_singles)
  - analyze_discipline_structure.py (diagnostic/dry-run)
  - tests/test_reshape_logic.py

This module is read-only with respect to canonical data — it only
provides analysis and selection logic.  All writes are the caller's
responsibility.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Optional

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

# Minimum fraction of placements that must resolve for the REPAIR path.
# 1.0 = every single placement must have a confident winner before the
# fix is allowed to touch canonical data.
REPAIR_THRESHOLD: float = 1.0

# Threshold used in the analysis/dry-run path for guidance display.
# Looser than REPAIR_THRESHOLD — shows whether a repair is "probably OK"
# without being as strict as the production gate.
ANALYSIS_THRESHOLD: float = 0.90

# ---------------------------------------------------------------------------
# Classifiers
# ---------------------------------------------------------------------------

_PLACEHOLDER_NAMES: frozenset[str] = frozenset({
    "__UNKNOWN_PARTNER__",
    "[UNKNOWN PARTNER]",
    "[UNKNOWN]",
    "",
})

# Matches an embedded ordinal in the middle of a name string, e.g.:
#   "Tuomas Kärki 1. Tuomas Kärki"
#   "Jukka Peltola 2. Oskari Forsten"
# Pattern: whitespace + digits + "." + whitespace + uppercase letter
_RE_EMBEDDED_ORDINAL = re.compile(r'\s+\d+\.\s+(?=[A-ZÄÖÜÅÆØÉÀÈÑ])')


def is_placeholder(name: str) -> bool:
    """Return True if name is a ghost/unknown placeholder."""
    return name.strip() in _PLACEHOLDER_NAMES


def is_ghost_partner_row(row: dict) -> bool:
    """Return True if this participant row was inserted as a Fix-5 ghost partner."""
    return (
        row.get("display_name", "").strip() == "__UNKNOWN_PARTNER__"
        and row.get("notes", "") == "auto:ghost_partner"
    )


def has_embedded_ordinal(name: str) -> bool:
    """Return True if name contains a mid-string ordinal artifact like '2. '."""
    return bool(_RE_EMBEDDED_ORDINAL.search(name))


def is_duplicate_name(name: str) -> bool:
    """
    Return True if name is the same string repeated with an ordinal between,
    e.g. "Tuomas Kärki 1. Tuomas Kärki".
    """
    parts = _RE_EMBEDDED_ORDINAL.split(name, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip().lower() == parts[1].strip().lower()
    return False


def is_clean_competitor(name: str) -> bool:
    """Return True if the name looks like a straightforward competitor name."""
    stripped = name.strip()
    if is_placeholder(stripped):
        return False
    if has_embedded_ordinal(stripped):
        return False
    return True


# ---------------------------------------------------------------------------
# Single-placement competitor selection
# ---------------------------------------------------------------------------

def select_competitor(
    slot_rows: list[dict],
) -> tuple[Optional[dict], Optional[dict], str, str]:
    """
    Given the participant rows for one placement in a doubles-shaped discipline,
    select the single best competitor for reshaping to singles.

    Returns:
        (winner_row, discarded_row, status, reason)

    status ∈ {'resolved', 'ambiguous', 'unresolvable'}
    reason is a human-readable string for audit output.

    Selection rules (checked in this order):
      1.  Ghost partner rows (notes='auto:ghost_partner') are never selected.
      2.  Plain placeholder names ([UNKNOWN PARTNER] etc.) are never selected.
      3.  If exactly one non-placeholder remains, select it.
      4.  If exactly one row has a valid person_id, select it.
      5.  If both have person_ids or neither does, use a quality score:
            + 4 for having a person_id
            + 2 for having a clean competitor name (no embedded ordinal)
            + 1 for being a non-placeholder at all
      6.  Higher score wins; equal scores → ambiguous.
    """
    if not slot_rows:
        return None, None, "unresolvable", "no participant rows for this placement"

    # Separate out ghost partner rows first
    non_ghost = [r for r in slot_rows if not is_ghost_partner_row(r)]
    ghost_rows = [r for r in slot_rows if is_ghost_partner_row(r)]

    # All ghost
    if not non_ghost:
        return None, None, "unresolvable", "all rows are ghost partner stubs"

    # After removing ghosts, check for plain placeholders
    non_placeholder = [
        r for r in non_ghost
        if not is_placeholder(r.get("display_name", "").strip())
    ]

    # All ghost or placeholder
    if not non_placeholder:
        return None, None, "unresolvable", "all rows are ghost/placeholder"

    # Exactly one real candidate (possibly alongside a placeholder/ghost)
    if len(non_placeholder) == 1:
        winner = non_placeholder[0]
        others = [r for r in slot_rows if r is not winner]
        discarded = others[0] if others else None
        return winner, discarded, "resolved", "sole non-placeholder participant"

    # Two (or more) candidates remain — work with first two
    c1, c2 = non_placeholder[0], non_placeholder[1]

    def score(r: dict) -> int:
        name = r.get("display_name", "").strip()
        s = 1  # non-placeholder baseline
        if r.get("person_id", "").strip():
            s += 4
        if is_clean_competitor(name):
            s += 2
        return s

    s1, s2 = score(c1), score(c2)

    pid1 = c1.get("person_id", "").strip()
    pid2 = c2.get("person_id", "").strip()

    # Exactly one has person_id — unambiguous preference
    if pid1 and not pid2:
        return c1, c2, "resolved", f"c1 has person_id ({pid1[:8]}), c2 does not"
    if pid2 and not pid1:
        return c2, c1, "resolved", f"c2 has person_id ({pid2[:8]}), c1 does not"

    # Both or neither have person_id — score tiebreak
    if s1 > s2:
        return c1, c2, "resolved", f"c1 quality score ({s1}) > c2 ({s2})"
    if s2 > s1:
        return c2, c1, "resolved", f"c2 quality score ({s2}) > c1 ({s1})"

    # Genuinely ambiguous
    n1 = c1.get("display_name", "")
    n2 = c2.get("display_name", "")
    return None, None, "ambiguous", (
        f"equal scores ({s1}): c1={n1!r}  c2={n2!r}"
    )


# ---------------------------------------------------------------------------
# Full-discipline reshape analysis
# ---------------------------------------------------------------------------

def reshape_discipline(
    participants_for_disc: list[dict],
    threshold: float = REPAIR_THRESHOLD,
) -> dict:
    """
    Run the competitor-selection heuristic over all participant rows for
    a single discipline and return a structured result.

    Args:
        participants_for_disc: participant rows with matching (event_key, discipline_key)
        threshold: fraction of placements that must resolve confidently (default 1.0)

    Returns a dict:
        resolved                  list of (placement, winner_row, discarded_row, reason)
        ambiguous                 list of (placement, reason)
        unresolvable              list of (placement, reason)
        duplicate_person_placements  list of (person_id, [placement, ...])
        resolution_rate           float
        passes_threshold          bool
        passes_duplicate_check    bool
        can_apply                 bool  (passes_threshold AND passes_duplicate_check)
        total_placements          int
    """
    by_placement: dict[int, list[dict]] = defaultdict(list)
    for p in participants_for_disc:
        try:
            pl = int(p["placement"])
        except (ValueError, KeyError):
            continue
        by_placement[pl].append(p)

    resolved: list[tuple] = []
    ambiguous: list[tuple] = []
    unresolvable: list[tuple] = []

    for placement in sorted(by_placement):
        winner, discarded, status, reason = select_competitor(by_placement[placement])
        if status == "resolved":
            resolved.append((placement, winner, discarded, reason))
        elif status == "ambiguous":
            ambiguous.append((placement, reason))
        else:
            unresolvable.append((placement, reason))

    total = len(by_placement)
    confident = len(resolved)
    resolution_rate = confident / total if total > 0 else 0.0
    passes_threshold = resolution_rate >= threshold

    # Duplicate person_id check: same person should not appear at two placements
    pid_to_placements: dict[str, list[int]] = defaultdict(list)
    for pl, winner, _, _ in resolved:
        pid = (winner.get("person_id", "") or "").strip()
        if pid:
            pid_to_placements[pid].append(pl)

    dup_pids = [
        (pid, sorted(pls))
        for pid, pls in pid_to_placements.items()
        if len(pls) > 1
    ]
    passes_duplicate_check = len(dup_pids) == 0

    return {
        "resolved": resolved,
        "ambiguous": ambiguous,
        "unresolvable": unresolvable,
        "duplicate_person_placements": dup_pids,
        "resolution_rate": resolution_rate,
        "passes_threshold": passes_threshold,
        "passes_duplicate_check": passes_duplicate_check,
        "can_apply": passes_threshold and passes_duplicate_check,
        "total_placements": total,
    }
