"""
event_local_alias.py

Conservative event-scoped alias expansion for shorthand names in net doubles.

Expands tokens like "Patti", "Flo", "PT" to full names using ONLY names that
appear in the same event (with a resolved person_id). No global nickname
dictionaries, no fuzzy matching, no cross-event inference.

Pipeline placement:
    raw parse -> normalize -> **alias expansion** -> identity match

Usage from the pipeline:
    from event_local_alias import (
        build_event_name_index,
        expand_doubles_pair,
        ExpansionDiagnostics,
    )

    index = build_event_name_index(participants_for_event)
    result = expand_doubles_pair("Patti", "Flo", index)
    if result.applied:
        player1 = result.left.expanded
        player2 = result.right.expanded
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# Minimum prefix length for first-name prefix matching.
# Must be >= 3 to avoid spurious matches ("Al" matching "Alice" AND "Alberto").
# ---------------------------------------------------------------------------
MIN_PREFIX_LEN = 3


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class EventNameIndex:
    """
    Index built from all resolved participants in a single event.

    Only names with a person_id are indexed (we only expand to names we're
    confident about). Keyed by lowercased tokens for case-insensitive lookup.
    """
    # lowered_full_name -> display_name (for "already known" checks)
    full_name_set: set[str] = field(default_factory=set)
    # lowered first name -> [display_name, ...]
    first_name_index: dict[str, list[str]] = field(default_factory=dict)
    # lowered last name -> [display_name, ...]
    last_name_index: dict[str, list[str]] = field(default_factory=dict)
    # lowered initials (e.g. "pt") -> [display_name, ...]
    initials_index: dict[str, list[str]] = field(default_factory=dict)
    # [(lowered_first_name, display_name), ...] for prefix matching
    first_names: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class ExpansionResult:
    """Result of expanding a single name token."""
    original: str
    expanded: Optional[str]           # None if no expansion
    method: Optional[str]             # 'exact_first', 'exact_last', 'initials', 'prefix', 'already_full', None
    is_full_name: bool                # True if original was already a multi-word name


@dataclass
class PairExpansionResult:
    """Result of expanding a doubles pair."""
    left: ExpansionResult
    right: ExpansionResult
    confidence: str                   # 'high', 'medium', 'low'
    applied: bool                     # True only if confidence >= medium


@dataclass
class ExpansionDiagnostics:
    """Tracks expansion attempts and outcomes across a pipeline run."""
    attempted: int = 0
    success: int = 0
    ambiguous: int = 0
    no_match: int = 0
    already_full: int = 0
    pairs_attempted: int = 0
    pairs_applied: int = 0
    pairs_skipped: int = 0


# ---------------------------------------------------------------------------
# Index construction
# ---------------------------------------------------------------------------

def build_event_name_index(participants: list[dict]) -> EventNameIndex:
    """
    Build a name index from all resolved participants in one event.

    Parameters
    ----------
    participants : list[dict]
        Each dict must have at minimum:
          - display_name (str): the canonical display name
          - person_id (str): the resolved person identifier ("" if unresolved)

        Only participants with a non-empty person_id are indexed.

    Returns
    -------
    EventNameIndex
        Lookup structures for alias expansion.
    """
    index = EventNameIndex()
    seen_display_names: set[str] = set()

    for p in participants:
        pid = (p.get("person_id") or "").strip()
        name = (p.get("display_name") or "").strip()
        if not pid or not name:
            continue

        # Deduplicate: same person may appear in multiple disciplines
        if name in seen_display_names:
            continue
        seen_display_names.add(name)

        name_lower = name.lower()
        index.full_name_set.add(name_lower)

        parts = name.split()
        if len(parts) < 2:
            # Single-word names are not useful as expansion targets
            continue

        first = parts[0].lower()
        last = parts[-1].lower()

        # First name index
        index.first_name_index.setdefault(first, []).append(name)

        # Last name index
        index.last_name_index.setdefault(last, []).append(name)

        # Initials index (first letter of each word, lowered)
        initials = "".join(w[0] for w in parts if w).lower()
        if len(initials) >= 2:
            index.initials_index.setdefault(initials, []).append(name)

        # First-names list for prefix matching
        index.first_names.append((first, name))

    return index


# ---------------------------------------------------------------------------
# Single-token expansion
# ---------------------------------------------------------------------------

def _is_full_name(name: str) -> bool:
    """A name is considered 'full' if it has 2+ whitespace-separated words."""
    return len(name.strip().split()) >= 2


def expand_event_local_alias(
    token: str,
    index: EventNameIndex,
) -> ExpansionResult:
    """
    Expand a single name token using the event-local index.

    Rules (applied in priority order):
      1. If already a full name (2+ words) → return unchanged
      2. Exact first name match → expand if unique
      3. Exact last name match → expand if unique
      4. Initials match (case-insensitive) → expand if unique
      5. First-name prefix (>= MIN_PREFIX_LEN chars) → expand if unique
      6. No match → return None

    Parameters
    ----------
    token : str
        The raw name token to expand (e.g. "Patti", "Flo", "PT").
    index : EventNameIndex
        The event-local name index.

    Returns
    -------
    ExpansionResult
    """
    token_stripped = token.strip()
    if not token_stripped:
        return ExpansionResult(
            original=token, expanded=None, method=None, is_full_name=False,
        )

    # Rule 1: already a full name
    if _is_full_name(token_stripped):
        return ExpansionResult(
            original=token,
            expanded=token_stripped,
            method="already_full",
            is_full_name=True,
        )

    token_lower = token_stripped.lower()

    # Rule 2: exact first name match
    candidates = index.first_name_index.get(token_lower, [])
    if len(candidates) == 1:
        return ExpansionResult(
            original=token, expanded=candidates[0],
            method="exact_first", is_full_name=False,
        )

    # Rule 3: exact last name match
    candidates = index.last_name_index.get(token_lower, [])
    if len(candidates) == 1:
        return ExpansionResult(
            original=token, expanded=candidates[0],
            method="exact_last", is_full_name=False,
        )

    # Rule 4: initials match
    candidates = index.initials_index.get(token_lower, [])
    if len(candidates) == 1:
        return ExpansionResult(
            original=token, expanded=candidates[0],
            method="initials", is_full_name=False,
        )

    # Rule 5: first-name prefix (>= MIN_PREFIX_LEN chars)
    if len(token_lower) >= MIN_PREFIX_LEN:
        prefix_matches = [
            full_name
            for first_lower, full_name in index.first_names
            if first_lower.startswith(token_lower) and first_lower != token_lower
        ]
        # Deduplicate (same person from multiple index entries)
        unique_matches = list(dict.fromkeys(prefix_matches))
        if len(unique_matches) == 1:
            return ExpansionResult(
                original=token, expanded=unique_matches[0],
                method="prefix", is_full_name=False,
            )

    # No match
    return ExpansionResult(
        original=token, expanded=None, method=None, is_full_name=False,
    )


# ---------------------------------------------------------------------------
# Doubles pair expansion
# ---------------------------------------------------------------------------

def expand_doubles_pair(
    player1: str,
    player2: str,
    index: EventNameIndex,
    diagnostics: Optional[ExpansionDiagnostics] = None,
) -> PairExpansionResult:
    """
    Expand both sides of a doubles pair using event-local context.

    Confidence rules:
      - 'high':   both sides uniquely expanded (or both already full)
      - 'medium': one side expanded + other already full name
      - 'low':    any side unresolvable → do NOT apply

    Only applies expansion when confidence >= 'medium'.

    Parameters
    ----------
    player1 : str
        Left side of the doubles pair.
    player2 : str
        Right side of the doubles pair.
    index : EventNameIndex
        The event-local name index.
    diagnostics : ExpansionDiagnostics, optional
        Accumulator for pipeline-wide statistics.

    Returns
    -------
    PairExpansionResult
    """
    if diagnostics:
        diagnostics.pairs_attempted += 1

    left = expand_event_local_alias(player1, index)
    right = expand_event_local_alias(player2, index)

    if diagnostics:
        for r in (left, right):
            if r.is_full_name:
                diagnostics.already_full += 1
            elif r.expanded is not None:
                diagnostics.attempted += 1
                diagnostics.success += 1
            elif r.method is None and not r.is_full_name:
                diagnostics.attempted += 1
                # Distinguish ambiguous from no_match:
                # ambiguous = token found multiple candidates (method would be set
                # if unique). We check if the token exists in any index.
                token_lower = r.original.strip().lower()
                found_any = (
                    len(index.first_name_index.get(token_lower, [])) > 1
                    or len(index.last_name_index.get(token_lower, [])) > 1
                    or len(index.initials_index.get(token_lower, [])) > 1
                )
                if found_any:
                    diagnostics.ambiguous += 1
                else:
                    diagnostics.no_match += 1

    left_ok = left.expanded is not None
    right_ok = right.expanded is not None

    if left_ok and right_ok:
        # Both resolved: check if both were tokens (high) or mixed (medium)
        if not left.is_full_name and not right.is_full_name:
            confidence = "high"
        elif left.is_full_name and right.is_full_name:
            confidence = "high"  # both already full, nothing to expand
        else:
            confidence = "medium"

        if diagnostics:
            diagnostics.pairs_applied += 1

        return PairExpansionResult(
            left=left, right=right,
            confidence=confidence, applied=True,
        )

    # One or both sides failed to resolve
    if diagnostics:
        diagnostics.pairs_skipped += 1

    return PairExpansionResult(
        left=left, right=right,
        confidence="low", applied=False,
    )
