#!/usr/bin/env python3
"""
report_top_unresolved_names.py

Ranked, auditable report of unresolved participant names for manual review
and addition to overrides/person_aliases.csv.

Answers: "Which unresolved names should I add to person_aliases.csv first
to get the biggest payoff?"

Usage (from legacy_data/):
    .venv/bin/python pipeline/report_top_unresolved_names.py
    .venv/bin/python pipeline/report_top_unresolved_names.py --limit 50
    .venv/bin/python pipeline/report_top_unresolved_names.py --output-csv out/unresolved_worklist.csv
    .venv/bin/python pipeline/report_top_unresolved_names.py --include-initial-lastname
    .venv/bin/python pipeline/report_top_unresolved_names.py --pattern initial_dot_lastname

Inputs:
    out/canonical/event_result_participants.csv
    out/canonical/persons.csv
    overrides/person_aliases.csv (optional — for existing alias awareness)

Outputs:
    stdout  — ranked summary
    CSV     — operator-friendly worklist (with --output-csv)
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # legacy_data/
PARTICIPANTS_CSV = ROOT / "out" / "canonical" / "event_result_participants.csv"
PERSONS_CSV = ROOT / "out" / "canonical" / "persons.csv"
ALIASES_CSV = ROOT / "overrides" / "person_aliases.csv"

# ---------------------------------------------------------------------------
# Name normalization — mirrors export_historical_csvs._norm_name()
# ---------------------------------------------------------------------------

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def _norm_name(s: str) -> str:
    """Normalize a player name (mirrors pipeline _norm_name)."""
    s = s.replace("\ufffd", "").replace("\u00ad", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


# ---------------------------------------------------------------------------
# Placeholder / system marker detection
# ---------------------------------------------------------------------------

_EXCLUDE_LOWER = {
    "[unknown partner]",
    "__unknown_partner__",
    "__non_person__",
    "(unknown)",
    "",
}


def _is_excluded(name: str) -> bool:
    """Return True for placeholders, system markers, and ghost partners."""
    n = name.strip().lower()
    return n in _EXCLUDE_LOWER


# ---------------------------------------------------------------------------
# Pattern classification
# ---------------------------------------------------------------------------

def classify_name(name: str) -> str:
    """Classify an unresolved display_name into a pattern bucket."""
    n = name.strip()
    if _is_excluded(n):
        return "excluded"
    if "/" in n:
        return "slash_unsplit"
    if re.match(r"^[A-Z]\.\s+\S", n):
        return "initial_dot_lastname"
    if re.match(r"^[A-Z]{2,3}$", n):
        return "uppercase_initials"
    if " " not in n:
        return "single_token"
    return "full_name_unresolved"


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class NameCandidate:
    raw_name: str
    normalized: str
    category: str
    count: int = 0
    years: list[int] = field(default_factory=list)
    events: list[str] = field(default_factory=list)
    disciplines: list[str] = field(default_factory=list)
    # Suggestion fields (conservative, often blank)
    suggested_person_id: str = ""
    suggested_person_name: str = ""
    suggestion_method: str = ""
    suggestion_confidence: str = ""

    @property
    def first_year(self) -> int | None:
        return min(self.years) if self.years else None

    @property
    def last_year(self) -> int | None:
        return max(self.years) if self.years else None

    @property
    def sample_events(self) -> str:
        unique = list(dict.fromkeys(self.events))
        return "; ".join(unique[:5])

    @property
    def sample_disciplines(self) -> str:
        unique = list(dict.fromkeys(self.disciplines))
        return "; ".join(unique[:5])


# ---------------------------------------------------------------------------
# Known persons index (for conservative suggestions)
# ---------------------------------------------------------------------------

def _build_known_persons_index(
    persons_csv: Path,
    aliases_csv: Path,
) -> tuple[dict[str, tuple[str, str]], dict[str, list[tuple[str, str]]]]:
    """
    Build two indexes from canonical persons + existing aliases:
      norm_name_to_person: normalized_name -> (person_id, display_name)
      last_name_to_persons: normalized_last -> [(person_id, display_name), ...]

    Returns (norm_name_to_person, last_name_to_persons).
    """
    norm_to_person: dict[str, tuple[str, str]] = {}
    last_to_persons: dict[str, list[tuple[str, str]]] = defaultdict(list)

    # Load canonical persons
    if persons_csv.exists():
        with open(persons_csv, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                pid = row.get("person_id", "").strip()
                name = row.get("person_name", "").strip()
                if not pid or not name:
                    continue
                normed = _norm_name(name)
                norm_to_person[normed] = (pid, name)
                parts = name.split()
                if len(parts) >= 2:
                    last = _norm_name(parts[-1])
                    last_to_persons[last].append((pid, name))

    # Load existing aliases (to avoid re-suggesting already-aliased names)
    existing_aliases: set[str] = set()
    if aliases_csv.exists():
        with open(aliases_csv, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                alias = row.get("alias", "").strip()
                if alias:
                    existing_aliases.add(_norm_name(alias))

    return norm_to_person, last_to_persons


# ---------------------------------------------------------------------------
# Conservative suggestion logic
# ---------------------------------------------------------------------------

def _suggest_match(
    candidate: NameCandidate,
    norm_to_person: dict[str, tuple[str, str]],
    last_to_persons: dict[str, list[tuple[str, str]]],
) -> None:
    """
    Attempt conservative suggestion. Only fills candidate.suggested_*
    when the match is unambiguous.

    Rules:
      1. Exact normalized match → suggest (high confidence)
      2. Suffix-stripped match: remove "Jr.", "Sr.", "III" etc. → suggest (medium)
      3. Same last name with single match + first initial match → note (low, not auto)
    """
    normed = candidate.normalized

    # Rule 1: Exact normalized match
    if normed in norm_to_person:
        pid, display = norm_to_person[normed]
        candidate.suggested_person_id = pid
        candidate.suggested_person_name = display
        candidate.suggestion_method = "exact_norm_match"
        candidate.suggestion_confidence = "high"
        return

    # Rule 2: Suffix-stripped match
    stripped = re.sub(r"\s+(jr\.?|sr\.?|iii?|iv|[,\s]+\w{1,3})$", "", normed).strip()
    if stripped != normed and stripped in norm_to_person:
        pid, display = norm_to_person[stripped]
        candidate.suggested_person_id = pid
        candidate.suggested_person_name = display
        candidate.suggestion_method = "suffix_stripped"
        candidate.suggestion_confidence = "medium"
        return

    # Rule 3: initial_dot_lastname → same last name + initial match (note only)
    if candidate.category == "initial_dot_lastname":
        m = re.match(r"^([a-z])\.\s+(.+)$", normed)
        if m:
            initial = m.group(1)
            last = _norm_name(m.group(2))
            if last in last_to_persons:
                matches = [
                    (pid, name) for pid, name in last_to_persons[last]
                    if _norm_name(name.split()[0]).startswith(initial)
                ]
                if len(matches) == 1:
                    pid, display = matches[0]
                    candidate.suggested_person_id = pid
                    candidate.suggested_person_name = display
                    candidate.suggestion_method = "initial_lastname_unique"
                    candidate.suggestion_confidence = "low"
                    return

    # No suggestion
    return


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_candidates(
    include_initial_lastname: bool = True,
    pattern_filter: str | None = None,
) -> list[NameCandidate]:
    """Build ranked list of unresolved name candidates from canonical data."""

    with open(PARTICIPANTS_CSV, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        all_participants = list(reader)

    # Group unresolved names
    name_data: dict[str, NameCandidate] = {}

    for p in all_participants:
        if p["person_id"].strip():
            continue
        raw = p["display_name"].strip()
        if _is_excluded(raw):
            continue

        cat = classify_name(raw)
        if cat == "excluded":
            continue
        if not include_initial_lastname and cat == "initial_dot_lastname":
            continue
        if pattern_filter and cat != pattern_filter:
            continue

        normed = _norm_name(raw)
        key = normed  # group by normalized form

        if key not in name_data:
            name_data[key] = NameCandidate(
                raw_name=raw,
                normalized=normed,
                category=cat,
            )

        cand = name_data[key]
        cand.count += 1

        # Extract year from event_key (first 4 chars)
        ek = p.get("event_key", "")
        year_str = ek[:4]
        if year_str.isdigit():
            cand.years.append(int(year_str))
        cand.events.append(ek)
        cand.disciplines.append(p.get("discipline_key", ""))

    # Sort by count descending
    candidates = sorted(name_data.values(), key=lambda c: (-c.count, c.normalized))

    # Apply conservative suggestions
    norm_to_person, last_to_persons = _build_known_persons_index(
        PERSONS_CSV, ALIASES_CSV,
    )
    for cand in candidates:
        _suggest_match(cand, norm_to_person, last_to_persons)

    return candidates


def write_csv(candidates: list[NameCandidate], path: Path, limit: int | None) -> None:
    """Write operator-friendly CSV worklist."""
    subset = candidates[:limit] if limit else candidates
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "raw_name", "normalized_name", "category", "count",
            "first_year", "last_year",
            "sample_events", "sample_disciplines",
            "suggested_person_id", "suggested_person_name",
            "suggestion_method", "suggestion_confidence",
            "operator_decision", "operator_notes",
        ])
        for c in subset:
            writer.writerow([
                c.raw_name, c.normalized, c.category, c.count,
                c.first_year or "", c.last_year or "",
                c.sample_events, c.sample_disciplines,
                c.suggested_person_id, c.suggested_person_name,
                c.suggestion_method, c.suggestion_confidence,
                "",  # operator_decision — blank for review
                "",  # operator_notes — blank for review
            ])
    print(f"\n  CSV written: {path} ({len(subset)} rows)")


def print_report(candidates: list[NameCandidate], limit: int) -> None:
    """Print stdout summary report."""
    sep = "=" * 72

    print(sep)
    print("  TOP UNRESOLVED NAMES — ALIAS CANDIDATE WORKLIST")
    print(sep)
    print()

    # Category breakdown
    cat_counts: Counter[str] = Counter()
    cat_rows: Counter[str] = Counter()
    for c in candidates:
        cat_counts[c.category] += 1
        cat_rows[c.category] += c.count

    total_names = len(candidates)
    total_rows = sum(c.count for c in candidates)

    print("A. OVERVIEW")
    print("-" * 40)
    print(f"  Unique unresolved names:      {total_names:>6,}")
    print(f"  Total unresolved rows:        {total_rows:>6,}")
    print()
    print("  Category breakdown:")
    print(f"  {'Category':<28s} {'Names':>6s}  {'Rows':>6s}")
    for cat in sorted(cat_counts, key=lambda c: -cat_rows[c]):
        print(f"  {cat:<28s} {cat_counts[cat]:>6,}  {cat_rows[cat]:>6,}")
    print()

    # Suggestion summary
    suggested_high = [c for c in candidates if c.suggestion_confidence == "high"]
    suggested_med = [c for c in candidates if c.suggestion_confidence == "medium"]
    suggested_low = [c for c in candidates if c.suggestion_confidence == "low"]
    suggested_rows_high = sum(c.count for c in suggested_high)
    suggested_rows_med = sum(c.count for c in suggested_med)
    suggested_rows_low = sum(c.count for c in suggested_low)

    print("B. SUGGESTION SUMMARY (conservative, requires operator review)")
    print("-" * 40)
    print(f"  High confidence (exact norm):   {len(suggested_high):>4} names  ({suggested_rows_high:>5,} rows)")
    print(f"  Medium (suffix stripped):       {len(suggested_med):>4} names  ({suggested_rows_med:>5,} rows)")
    print(f"  Low (initial+lastname):         {len(suggested_low):>4} names  ({suggested_rows_low:>5,} rows)")
    print(f"  No suggestion:                  {total_names - len(suggested_high) - len(suggested_med) - len(suggested_low):>4} names")
    print()

    if suggested_high:
        print("  HIGH-confidence suggestions (auto-resolvable with operator confirmation):")
        for c in suggested_high[:10]:
            print(f'    "{c.raw_name}" ({c.count}x) → {c.suggested_person_name}  [{c.suggestion_method}]')
        if len(suggested_high) > 10:
            print(f"    ... and {len(suggested_high) - 10} more")
        print()

    if suggested_med:
        print("  MEDIUM-confidence suggestions (suffix variation):")
        for c in suggested_med[:10]:
            print(f'    "{c.raw_name}" ({c.count}x) → {c.suggested_person_name}  [{c.suggestion_method}]')
        if len(suggested_med) > 10:
            print(f"    ... and {len(suggested_med) - 10} more")
        print()

    # Top N by frequency
    subset = candidates[:limit]
    print(f"C. TOP {limit} UNRESOLVED NAMES BY FREQUENCY")
    print("-" * 40)
    for i, c in enumerate(subset, 1):
        suggestion_tag = ""
        if c.suggestion_confidence:
            suggestion_tag = f"  → {c.suggested_person_name} [{c.suggestion_confidence}]"
        print(
            f"  {i:>3}. ({c.count:>3}x) [{c.category[:12]:>12s}] "
            f'"{c.raw_name}"{suggestion_tag}'
        )
        year_range = ""
        if c.first_year and c.last_year:
            year_range = f"{c.first_year}–{c.last_year}" if c.first_year != c.last_year else str(c.first_year)
        elif c.first_year:
            year_range = str(c.first_year)
        if year_range:
            events_sample = "; ".join(list(dict.fromkeys(c.events))[:3])
            print(f"       years: {year_range}  events: {events_sample}")
    print()

    # Impact estimate
    top25_rows = sum(c.count for c in candidates[:25])
    top50_rows = sum(c.count for c in candidates[:50])
    print("D. IMPACT ESTIMATE")
    print("-" * 40)
    print(f"  Resolving top 25 names would cover:  {top25_rows:>5,} rows  ({100*top25_rows/total_rows:.1f}% of unresolved)")
    print(f"  Resolving top 50 names would cover:  {top50_rows:>5,} rows  ({100*top50_rows/total_rows:.1f}% of unresolved)")

    auto_rows = suggested_rows_high + suggested_rows_med
    auto_names = len(suggested_high) + len(suggested_med)
    if auto_rows > 0:
        print(f"  High+medium suggestions cover:       {auto_rows:>5,} rows  ({auto_names} names, operator confirmation only)")
    print()
    print(sep)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Top unresolved names report for person_aliases.csv triage",
    )
    parser.add_argument("--limit", type=int, default=30,
                        help="Number of top names to show in stdout (default: 30)")
    parser.add_argument("--pattern", type=str, default=None,
                        help="Filter to specific category: full_name_unresolved, initial_dot_lastname, etc.")
    parser.add_argument("--include-initial-lastname", action="store_true", default=True,
                        dest="include_initial_lastname",
                        help="Include initial_dot_lastname patterns (default: True)")
    parser.add_argument("--no-initial-lastname", action="store_false",
                        dest="include_initial_lastname",
                        help="Exclude initial_dot_lastname patterns")
    parser.add_argument("--output-csv", type=str, default=None,
                        help="Path to write CSV worklist")
    args = parser.parse_args()

    if not PARTICIPANTS_CSV.exists():
        print(f"ERROR: {PARTICIPANTS_CSV} not found. Run the pipeline first.")
        sys.exit(1)

    candidates = build_candidates(
        include_initial_lastname=args.include_initial_lastname,
        pattern_filter=args.pattern,
    )

    print_report(candidates, limit=args.limit)

    if args.output_csv:
        write_csv(candidates, Path(args.output_csv), limit=None)


if __name__ == "__main__":
    main()
