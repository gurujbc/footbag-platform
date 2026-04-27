#!/usr/bin/env python3
"""Extract legacy_user_id (mirror username, "alias") per member_id.

Source: legacy_data/seed/club_members.csv  (produced by extract_club_members.py).
Each row carries (mirror_member_id, alias). The alias column IS the legacy
username displayed on the legacy site's club-member listings, the same string
that appears as the URL slug in /members/profile/<id>/<username>/.

This script aggregates the (mirror_member_id, alias) pairs across all club
listings, deduplicates, and writes a deterministic mapping. The standalone
/members/profile/<id>/index.html pages are NOT crawled in bulk in this mirror,
so club listings are the authoritative source.

Output:
  legacy_data/out/member_id_enrichment/legacy_user_id_map.csv
  columns: member_id, legacy_user_id, source

Idempotent: skips when the output CSV is newer than its input seed CSV.

Fails fast (non-zero exit) if any legacy_user_id appears for more than one
member_id, or any member_id has more than one distinct legacy_user_id, or any
member_id has both populated and blank alias values across rows. The platform
DB enforces UNIQUE on legacy_members.legacy_user_id, so duplicates would break
the downstream load.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
INPUT_CSV = ROOT / "seed" / "club_members.csv"
OUTPUT_DIR = ROOT / "out" / "member_id_enrichment"
OUTPUT_CSV = OUTPUT_DIR / "legacy_user_id_map.csv"

FIELDNAMES = ["member_id", "legacy_user_id", "source"]
SOURCE_LABEL = "club_members.alias"


def aggregate_pairs(rows: list[dict]) -> dict[str, str]:
    """Aggregate (mirror_member_id, alias) into a member_id → legacy_user_id map.

    Pure function over a list of row dicts. Returns the deduplicated mapping.
    Raises ValueError on conflict (one member_id with two different aliases).
    """
    by_mid: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        mid = r.get("mirror_member_id", "").strip()
        alias = r.get("alias", "").strip()
        if not mid or not alias:
            continue
        by_mid[mid].add(alias)

    conflicts = {mid: aliases for mid, aliases in by_mid.items() if len(aliases) > 1}
    if conflicts:
        details = "\n".join(
            f"  {mid} -> {sorted(aliases)}" for mid, aliases in sorted(conflicts.items())
        )
        raise ValueError(f"member_id has multiple distinct aliases:\n{details}")

    return {mid: next(iter(aliases)) for mid, aliases in by_mid.items()}


def detect_alias_duplicates(mapping: dict[str, str]) -> dict[str, list[str]]:
    """Return {alias: [member_ids]} for aliases that appear on multiple member_ids."""
    by_alias: dict[str, list[str]] = defaultdict(list)
    for mid, alias in mapping.items():
        by_alias[alias].append(mid)
    return {alias: ids for alias, ids in by_alias.items() if len(ids) > 1}


def is_up_to_date() -> bool:
    if not OUTPUT_CSV.exists():
        return False
    if not INPUT_CSV.exists():
        return False
    return OUTPUT_CSV.stat().st_mtime > INPUT_CSV.stat().st_mtime


def main() -> int:
    if not INPUT_CSV.exists():
        print(f"ERROR: input not found: {INPUT_CSV}", file=sys.stderr)
        print(f"Run scripts/extract_club_members.py first.", file=sys.stderr)
        return 1

    if is_up_to_date():
        print(f"{OUTPUT_CSV.name} is up to date, skipping. ({OUTPUT_CSV})")
        return 0

    with open(INPUT_CSV, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    try:
        mapping = aggregate_pairs(rows)
    except ValueError as e:
        print(f"ERROR: aggregation failed: {e}", file=sys.stderr)
        return 1

    duplicates = detect_alias_duplicates(mapping)
    if duplicates:
        print("ERROR: duplicate legacy_user_id values across member_ids:", file=sys.stderr)
        for alias, ids in sorted(duplicates.items()):
            print(f"  {alias!r} -> member_ids {ids}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_rows = [
        {"member_id": mid, "legacy_user_id": alias, "source": SOURCE_LABEL}
        for mid, alias in sorted(mapping.items(), key=lambda p: int(p[0]))
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"Wrote {len(out_rows)} rows to {OUTPUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
