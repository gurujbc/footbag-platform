#!/usr/bin/env python3
"""
generate_alias_candidates.py

Two-step alias insertion tool for overrides/person_aliases.csv.

Step 1 — Generate candidates (operator reviews the output CSV):
    .venv/bin/python pipeline/generate_alias_candidates.py
    .venv/bin/python pipeline/generate_alias_candidates.py --limit 25 --only-high-confidence
    .venv/bin/python pipeline/generate_alias_candidates.py --pattern initial_dot_lastname

Step 2 — Apply reviewed candidates to person_aliases.csv:
    .venv/bin/python pipeline/generate_alias_candidates.py --apply-reviewed \\
        --input-csv out/alias_candidates.csv \\
        --output-csv overrides/person_aliases.csv

Inputs:
    out/unresolved_worklist.csv  (from report_top_unresolved_names.py)
    out/canonical/persons.csv
    overrides/person_aliases.csv (existing aliases)

Outputs:
    out/alias_candidates.csv     (review sheet, step 1)
    overrides/person_aliases.csv (appended rows, step 2)
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # legacy_data/
DEFAULT_WORKLIST = ROOT / "out" / "unresolved_worklist.csv"
DEFAULT_OUTPUT = ROOT / "out" / "alias_candidates.csv"
PERSONS_CSV = ROOT / "out" / "canonical" / "persons.csv"
ALIASES_CSV = ROOT / "overrides" / "person_aliases.csv"

# ---------------------------------------------------------------------------
# Normalization (mirrors pipeline _norm_name)
# ---------------------------------------------------------------------------

_TRANSLITERATE = str.maketrans("łŁøØđĐðÞŋ", "lLoOdDdTn")


def _norm_name(s: str) -> str:
    s = s.replace("\ufffd", "").replace("\u00ad", "")
    s = s.translate(_TRANSLITERATE)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower().strip())


# ---------------------------------------------------------------------------
# Persons index
# ---------------------------------------------------------------------------

def _load_persons_index(
    persons_csv: Path,
) -> tuple[dict[str, tuple[str, str]], dict[str, list[tuple[str, str]]]]:
    """
    Returns:
      norm_to_person: normalized_name -> (person_id, display_name)
      last_to_persons: normalized_last -> [(person_id, display_name), ...]
    """
    norm_to: dict[str, tuple[str, str]] = {}
    last_to: dict[str, list[tuple[str, str]]] = defaultdict(list)

    if not persons_csv.exists():
        return norm_to, last_to

    with open(persons_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = row.get("person_id", "").strip()
            name = row.get("person_name", "").strip()
            if not pid or not name:
                continue
            normed = _norm_name(name)
            norm_to[normed] = (pid, name)
            parts = name.split()
            if len(parts) >= 2:
                last = _norm_name(parts[-1])
                last_to[last].append((pid, name))

    return norm_to, last_to


def _load_existing_aliases(aliases_csv: Path) -> set[str]:
    """Return set of normalized aliases already in person_aliases.csv."""
    existing: set[str] = set()
    if not aliases_csv.exists():
        return existing
    with open(aliases_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            alias = row.get("alias", "").strip()
            if alias:
                existing.add(_norm_name(alias))
    return existing


# ---------------------------------------------------------------------------
# Suggestion logic
# ---------------------------------------------------------------------------

def suggest_match(
    raw_name: str,
    normalized: str,
    category: str,
    norm_to_person: dict[str, tuple[str, str]],
    last_to_persons: dict[str, list[tuple[str, str]]],
    existing_aliases: set[str],
) -> tuple[str, str, str, str]:
    """
    Conservative suggestion for a single unresolved name.

    Returns (person_id, person_canon, method, confidence).
    All empty strings if no suggestion.
    """
    # Skip if already aliased
    if normalized in existing_aliases:
        return ("", "", "already_aliased", "")

    # Rule A: exact normalized match
    if normalized in norm_to_person:
        pid, canon = norm_to_person[normalized]
        return (pid, canon, "exact_norm_match", "high")

    # Rule B: suffix stripping (Jr., Sr., III, IV, etc.)
    stripped = re.sub(r"\s+(jr\.?|sr\.?|iii?|iv|[,\s]+\w{1,3})$", "", normalized).strip()
    if stripped != normalized and stripped in norm_to_person:
        pid, canon = norm_to_person[stripped]
        return (pid, canon, "suffix_stripped", "medium")

    # Rule C: diacritic equivalence is already handled by Rule A
    # (_norm_name strips diacritics, so "Förster" and "Forster" both become "forster")

    # Rule D: initial+lastname (gated to initial_dot_lastname category)
    if category == "initial_dot_lastname":
        m = re.match(r"^([a-z])\.\s+(.+)$", normalized)
        if m:
            initial = m.group(1)
            last = _norm_name(m.group(2))
            if last in last_to_persons:
                matches = [
                    (pid, name) for pid, name in last_to_persons[last]
                    if _norm_name(name.split()[0]).startswith(initial)
                ]
                if len(matches) == 1:
                    pid, canon = matches[0]
                    return (pid, canon, "initial_lastname", "low")

    return ("", "", "", "")


# ---------------------------------------------------------------------------
# Step 1: Generate candidates
# ---------------------------------------------------------------------------

CANDIDATE_HEADER = [
    "raw_name", "normalized_name", "category", "count",
    "first_year", "last_year", "sample_events", "sample_disciplines",
    "suggested_person_id", "suggested_canonical_name",
    "suggestion_method", "suggestion_confidence",
    "operator_decision", "operator_person_id", "operator_notes",
]


def generate_candidates(
    worklist_csv: Path,
    output_csv: Path,
    limit: int,
    pattern: str | None,
    only_high: bool,
) -> None:
    """Read worklist, apply suggestions, write candidate review sheet."""

    norm_to_person, last_to_persons = _load_persons_index(PERSONS_CSV)
    existing_aliases = _load_existing_aliases(ALIASES_CSV)

    # Read worklist
    with open(worklist_csv, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    # Filter
    filtered: list[dict] = []
    for r in rows:
        cat = r.get("category", "")
        if pattern and cat != pattern:
            continue
        if cat in ("excluded", ""):
            continue
        filtered.append(r)

    # Sort by count descending (worklist is already sorted, but be safe)
    filtered.sort(key=lambda r: -int(r.get("count", "0")))

    # Apply suggestions and collect
    candidates: list[dict] = []
    for r in filtered:
        raw = r.get("raw_name", "").strip()
        normed = r.get("normalized_name", "").strip()
        cat = r.get("category", "")

        pid, canon, method, conf = suggest_match(
            raw, normed, cat,
            norm_to_person, last_to_persons, existing_aliases,
        )

        if only_high and conf != "high":
            continue

        candidates.append({
            "raw_name": raw,
            "normalized_name": normed,
            "category": cat,
            "count": r.get("count", ""),
            "first_year": r.get("first_year", ""),
            "last_year": r.get("last_year", ""),
            "sample_events": r.get("sample_events", ""),
            "sample_disciplines": r.get("sample_disciplines", ""),
            "suggested_person_id": pid,
            "suggested_canonical_name": canon,
            "suggestion_method": method,
            "suggestion_confidence": conf,
            "operator_decision": "",
            "operator_person_id": "",
            "operator_notes": "",
        })

        if len(candidates) >= limit:
            break

    # Write output
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CANDIDATE_HEADER)
        writer.writeheader()
        writer.writerows(candidates)

    # Print diagnostics
    high = sum(1 for c in candidates if c["suggestion_confidence"] == "high")
    med = sum(1 for c in candidates if c["suggestion_confidence"] == "medium")
    low = sum(1 for c in candidates if c["suggestion_confidence"] == "low")
    none_ = sum(1 for c in candidates if c["suggestion_confidence"] == "")
    already = sum(1 for c in candidates if c["suggestion_method"] == "already_aliased")
    total_rows_covered = sum(int(c["count"]) for c in candidates if c["count"])

    print(f"Candidates generated: {len(candidates)}")
    print(f"  high confidence:    {high}")
    print(f"  medium confidence:  {med}")
    print(f"  low confidence:     {low}")
    print(f"  no suggestion:      {none_}")
    print(f"  already aliased:    {already}")
    print(f"  total rows covered: {total_rows_covered}")
    print(f"Output: {output_csv}")


# ---------------------------------------------------------------------------
# Step 2: Apply reviewed candidates
# ---------------------------------------------------------------------------

def apply_reviewed(
    input_csv: Path,
    output_csv: Path,
) -> None:
    """
    Read reviewed candidates, emit approved rows into person_aliases.csv.

    Only processes rows where operator_decision = 'approve'.
    Uses operator_person_id if provided, else suggested_person_id.
    Appends to existing file; deduplicates against existing aliases.
    """
    # Load existing aliases
    existing_rows: list[dict] = []
    existing_aliases: set[str] = set()
    fieldnames = ["alias", "person_id", "person_canon", "status", "notes"]

    if output_csv.exists():
        with open(output_csv, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing_rows.append(row)
                existing_aliases.add(_norm_name(row.get("alias", "")))

    # Read reviewed candidates
    with open(input_csv, encoding="utf-8") as f:
        candidates = list(csv.DictReader(f))

    approved = [c for c in candidates if c.get("operator_decision", "").strip().lower() == "approve"]
    rejected = [c for c in candidates if c.get("operator_decision", "").strip().lower() == "reject"]
    deferred = [c for c in candidates if c.get("operator_decision", "").strip().lower() == "defer"]
    unmarked = [c for c in candidates
                if c.get("operator_decision", "").strip().lower() not in ("approve", "reject", "defer")]

    new_rows: list[dict] = []
    skipped_no_pid: list[str] = []
    skipped_duplicate: list[str] = []

    for c in approved:
        raw = c.get("raw_name", "").strip()
        pid = c.get("operator_person_id", "").strip() or c.get("suggested_person_id", "").strip()
        canon = c.get("suggested_canonical_name", "").strip()

        if not pid:
            skipped_no_pid.append(raw)
            continue

        normed = _norm_name(raw)
        if normed in existing_aliases:
            skipped_duplicate.append(raw)
            continue

        method = c.get("suggestion_method", "")
        notes = c.get("operator_notes", "").strip()
        note_parts = [f"via:{method}"] if method else []
        if notes:
            note_parts.append(notes)

        new_rows.append({
            "alias": raw,
            "person_id": pid,
            "person_canon": canon,
            "status": "verified",
            "notes": "; ".join(note_parts),
        })
        existing_aliases.add(normed)

    # Write output (existing + new, sorted by alias)
    all_rows = existing_rows + new_rows
    all_rows.sort(key=lambda r: _norm_name(r.get("alias", "")))

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    # Print summary
    print(f"Apply-reviewed summary:")
    print(f"  Candidates read:    {len(candidates)}")
    print(f"  Approved:           {len(approved)}")
    print(f"  Rejected:           {len(rejected)}")
    print(f"  Deferred:           {len(deferred)}")
    print(f"  Unmarked:           {len(unmarked)}")
    print(f"  New rows written:   {len(new_rows)}")
    if skipped_no_pid:
        print(f"  Skipped (no pid):   {len(skipped_no_pid)}")
        for s in skipped_no_pid[:5]:
            print(f"    WARNING: \"{s}\" approved but no person_id — skipped")
    if skipped_duplicate:
        print(f"  Skipped (dup):      {len(skipped_duplicate)}")
        for s in skipped_duplicate[:5]:
            print(f"    (already in aliases): \"{s}\"")
    print(f"  Total aliases now:  {len(all_rows)}")
    print(f"  Output: {output_csv}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate or apply alias candidates for person_aliases.csv",
    )
    parser.add_argument("--apply-reviewed", action="store_true",
                        help="Apply reviewed candidates to person_aliases.csv")
    parser.add_argument("--input-csv", type=str, default=None,
                        help="Input CSV (worklist for generate, reviewed candidates for apply)")
    parser.add_argument("--output-csv", type=str, default=None,
                        help="Output CSV path")
    parser.add_argument("--limit", type=int, default=50,
                        help="Max candidates to generate (default: 50)")
    parser.add_argument("--pattern", type=str, default=None,
                        help="Filter by category (e.g., initial_dot_lastname)")
    parser.add_argument("--only-high-confidence", action="store_true",
                        help="Include only high-confidence suggestions")
    args = parser.parse_args()

    if args.apply_reviewed:
        input_csv = Path(args.input_csv) if args.input_csv else DEFAULT_OUTPUT
        output_csv = Path(args.output_csv) if args.output_csv else ALIASES_CSV
        if not input_csv.exists():
            print(f"ERROR: {input_csv} not found. Generate candidates first.")
            sys.exit(1)
        apply_reviewed(input_csv, output_csv)
    else:
        input_csv = Path(args.input_csv) if args.input_csv else DEFAULT_WORKLIST
        output_csv = Path(args.output_csv) if args.output_csv else DEFAULT_OUTPUT
        if not input_csv.exists():
            print(f"ERROR: {input_csv} not found. Run report_top_unresolved_names.py first.")
            sys.exit(1)
        generate_candidates(
            worklist_csv=input_csv,
            output_csv=output_csv,
            limit=args.limit,
            pattern=args.pattern,
            only_high=args.only_high_confidence,
        )


if __name__ == "__main__":
    main()
