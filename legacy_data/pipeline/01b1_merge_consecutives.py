#!/usr/bin/env python3
"""
pipeline/01b1_merge_consecutives.py — Merge consecutive kicks reference data

PIPELINE LANE: AUXILIARY / REFERENCE
  Not part of event ingestion. Merges trick-record reference CSVs for the
  Trick Records sheet in the community workbook (stage 04B).
  Run after stage 04 and before stage 04B (see run_pipeline.sh release).

Combines the legacy base file with any append files found in inputs/.
Append files win on sort_order conflicts (they are the authoritative/
improved versions). Normalizes float-exported numbers back to integers.

Reads:
  inputs/consecutives_records.csv              — legacy base data
  inputs/consecutive_findings_append.csv       — current findings append
  inputs/consecutive_findings_append_*.csv     — future append files (01b2 etc.)

Writes:
  out/consecutives_combined.csv                — consumed by 04B

Design:
  - Each append file overrides base rows by sort_order.
  - Append files are processed in filename order; later files win ties.
  - New sort_order values not in base are added at the end.
  - Numeric columns (rank, score, sort_order) are normalized to int where possible.
  - source_ref column is preserved if present in any input file.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INPUT_DIR = REPO / "inputs"
OUT_DIR   = REPO / "out"

BASE_FILE   = INPUT_DIR / "consecutives_records.csv"
APPEND_GLOB = "consecutive_findings_append*.csv"
OUT_FILE    = OUT_DIR / "consecutives_combined.csv"

# Columns in canonical output order (source_ref appended if present in any input)
BASE_COLUMNS = [
    "section", "subsection", "sort_order", "category", "division",
    "year", "rank", "person_or_team", "partner", "score",
    "note", "event_date", "event_name", "location",
]
NUMERIC_COLUMNS = {"sort_order", "rank", "score"}


def _normalize_numeric(val: str) -> str:
    """Convert '1.0' → '1', '63326.0' → '63326'. Leave non-numeric as-is."""
    if not val or not val.strip():
        return val
    try:
        f = float(val)
        if f == int(f):
            return str(int(f))
        return val
    except ValueError:
        return val


def load_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    # Normalize numeric fields
    for row in rows:
        for col in NUMERIC_COLUMNS:
            if col in row:
                row[col] = _normalize_numeric(row[col])
    return rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load base
    base_rows = load_csv(BASE_FILE)
    if not base_rows:
        print(f"WARNING: base file not found: {BASE_FILE}", file=sys.stderr)
    print(f"Base: {len(base_rows)} rows from {BASE_FILE.name}")

    # Index base by sort_order (int)
    merged: dict[int, dict] = {}
    no_sort: list[dict] = []
    for row in base_rows:
        so = row.get("sort_order", "").strip()
        if so:
            merged[int(so)] = row
        else:
            no_sort.append(row)

    # Detect whether any input has source_ref
    has_source_ref = any("source_ref" in row for row in base_rows)

    # Load and apply append files in sorted filename order
    append_files = sorted(INPUT_DIR.glob(APPEND_GLOB))
    for ap in append_files:
        ap_rows = load_csv(ap)
        print(f"Append: {len(ap_rows)} rows from {ap.name}")
        if any("source_ref" in row for row in ap_rows):
            has_source_ref = True
        for row in ap_rows:
            so = row.get("sort_order", "").strip()
            if so:
                merged[int(so)] = row   # append wins on conflict
            else:
                no_sort.append(row)

    # Re-sort by sort_order
    output = [merged[k] for k in sorted(merged)] + no_sort

    # Build final column list
    columns = list(BASE_COLUMNS)
    if has_source_ref:
        columns.append("source_ref")

    print(f"Writing {len(output)} rows → {OUT_FILE.name}")
    with open(OUT_FILE, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(output)

    # Delta summary
    base_sorts = {int(r["sort_order"]) for r in base_rows if r.get("sort_order")}
    new_sorts  = set(merged) - base_sorts
    if new_sorts:
        print(f"  New sort_orders (not in base): {sorted(new_sorts)}")
    override_count = sum(
        1 for r in output
        if r.get("sort_order") and int(r["sort_order"]) in base_sorts
        and any(
            r.get(c) != next((b.get(c) for b in base_rows
                              if b.get("sort_order") == r.get("sort_order")), None)
            for c in BASE_COLUMNS if c != "sort_order"
        )
    )
    print(f"  Overridden rows (append replaced base): {override_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
