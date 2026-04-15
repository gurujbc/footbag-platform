#!/usr/bin/env python3
"""
12_build_net_discipline_groups.py

Maps ~2,220 net discipline rows to 13 canonical group labels and populates
net_stat_policy (4 evidence-class rows).

Reads canonical tables (read-only):
  event_disciplines

Writes enrichment tables (canonical tables are never modified):
  net_discipline_group  — one row per net discipline_id
  net_stat_policy       — 4 rows (evidence-class registry)

Canonical groups:
  open_doubles | mixed_doubles | womens_doubles | intermediate_doubles |
  novice_doubles | masters_doubles | other_doubles |
  open_singles | womens_singles | intermediate_singles |
  novice_singles | masters_singles | other_singles |
  uncategorized

Mapping strategy (priority order — first match wins per discipline):
  1. Level patterns (most specific): novice, intermediate, masters, other (pro/adv/amateur)
  2. Gender/type patterns: womens, mixed
  3. Open pattern: explicit 'open' keyword or 'men'
  4. Fallback: team_type-appropriate open group

conflict_flag=1 is set when more than one non-fallback pattern matches the discipline name.
  These rows must be reviewed before their canonical_group is trusted.
  The service layer must use the raw discipline name when conflict_flag=1.

review_needed=1 is set for:
  - conflict_flag=1
  - match_method='fallback' with a vague/unknown name
  - names in ALWAYS_REVIEW set

SAFETY: This table NEVER overrides canonical event_disciplines data.
  It only annotates for grouping and display — it does not change team_type or discipline_category.

Usage (from legacy_data/):
    python event_results/scripts/12_build_net_discipline_groups.py \\
        --db ~/projects/footbag-platform/database/footbag.db

Or via run_pipeline.sh which resolves --db automatically.
"""

import argparse
import os
import re
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
SCRIPT_NAME = os.path.basename(__file__)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


# ---------------------------------------------------------------------------
# Pattern definitions
# ---------------------------------------------------------------------------

# Priority-ordered list: (regex_pattern, level_key)
# level_key maps to a group prefix; team_type suffix is added later.
# Applied case-insensitively. First match sets canonical_level; additional
# matches at lower priority set conflict_flag.
#
# Priority: novice/intermediate/masters > womens/mixed > other > open
LEVEL_PATTERNS: list[tuple[str, str]] = [
    # Level qualifiers (highest priority — override gender/open)
    (r'\bnovice\b|\bbeginner',                         'novice'),
    (r'\bintermediate\b|\binterm\b|interméd',          'intermediate'),
    (r'\bmaster',                                      'masters'),
    # Pro/advanced/amateur — treated as "other" (elite or non-standard tier)
    (r'\bpro\b',                                       'other'),
    (r'\badvanced\b|\badvance\b|\bamateur\b|\bultra\b','other'),
    # Gender / type
    (r"women'?s?\b|womens?\b|féminin",                 'womens'),
    (r'\bmixed?\b|\bmixte\b|\bmix\b',                  'mixed'),
    # Open / default level
    (r'\bopen\b|\bmen\'?s?\s+open|\bopen\s+men',       'open'),
]

# Names that should always get review_needed=1 regardless of match — too vague to trust
ALWAYS_REVIEW: set[str] = {
    'unknown', 'net', 'doubles', 'singles', 'mixed', 'intermediate',
    'footbag net', 'net doubles', 'net singles', 'net jam', 'mixed net',
    'open mixed', 'open', 'last man standing net',
}


# ---------------------------------------------------------------------------
# Stat policy rows
# ---------------------------------------------------------------------------

STAT_POLICY_ROWS = [
    {
        'evidence_class': 'canonical_only',
        'display_label': 'Official Placement',
        'may_show_public': 1,
        'requires_disclaimer': 0,
        'disclaimer_text': None,
        'may_use_in_stats': 1,
    },
    {
        'evidence_class': 'curated_enrichment',
        'display_label': 'Curated Data',
        'may_show_public': 1,
        'requires_disclaimer': 1,
        'disclaimer_text': 'This information has been manually curated and may not reflect official records.',
        'may_use_in_stats': 1,
    },
    {
        'evidence_class': 'inferred_partial',
        'display_label': 'Inferred (Partial)',
        'may_show_public': 0,
        'requires_disclaimer': 1,
        'disclaimer_text': (
            'This data is computationally derived from placement ordering and has not been '
            'verified. It may not reflect actual match outcomes.'
        ),
        'may_use_in_stats': 0,
    },
    {
        'evidence_class': 'unresolved_candidate',
        'display_label': 'Unresolved Candidate',
        'may_show_public': 0,
        'requires_disclaimer': 1,
        'disclaimer_text': 'This data has not been reviewed or linked to canonical records.',
        'may_use_in_stats': 0,
    },
]


# ---------------------------------------------------------------------------
# Mapping logic
# ---------------------------------------------------------------------------

def classify_discipline(name: str, team_type: str) -> tuple[str, str, int, int]:
    """
    Returns (canonical_group, match_method, review_needed, conflict_flag).

    canonical_group: one of the 14 canonical group values
    match_method:    'exact' | 'pattern' | 'fallback'
    review_needed:   0 or 1
    conflict_flag:   0 or 1
    """
    name_lower = name.lower().strip()

    # Determine team_type suffix; fall back to doubles for ambiguous/unknown
    type_suffix = 'doubles' if team_type == 'doubles' else 'singles'

    # Check if name is in the always-review set (strip trailing punctuation/numbers first)
    bare_name = re.sub(r'[\s\d:.,\-/]+$', '', name_lower).strip()
    always_review = bare_name in ALWAYS_REVIEW or name_lower in ALWAYS_REVIEW

    # Apply pattern matching — collect all matching levels
    matched_levels: list[str] = []
    for pattern, level in LEVEL_PATTERNS:
        if re.search(pattern, name_lower, re.IGNORECASE):
            if level not in matched_levels:
                matched_levels.append(level)

    if not matched_levels:
        # No keyword matched — fallback
        # Genuinely generic names → uncategorized
        if always_review or name_lower in ('unknown', 'net', 'doubles', 'singles'):
            return 'uncategorized', 'fallback', 1, 0
        return f'open_{type_suffix}', 'fallback', 0, 0

    # Take the first (highest priority) match as the canonical level
    canonical_level = matched_levels[0]
    conflict_flag = 1 if len(matched_levels) > 1 else 0

    # Resolve group from level + team_type
    if canonical_level == 'mixed':
        # mixed only meaningful for doubles; singles teams can't be "mixed" in this context
        if type_suffix == 'singles':
            # Likely a data entry quirk — flag it
            canonical_group = 'uncategorized'
            conflict_flag = 1
        else:
            canonical_group = 'mixed_doubles'
    elif canonical_level == 'womens':
        canonical_group = f'womens_{type_suffix}'
    elif canonical_level == 'open':
        canonical_group = f'open_{type_suffix}'
    elif canonical_level == 'novice':
        canonical_group = f'novice_{type_suffix}'
    elif canonical_level == 'intermediate':
        canonical_group = f'intermediate_{type_suffix}'
    elif canonical_level == 'masters':
        canonical_group = f'masters_{type_suffix}'
    elif canonical_level == 'other':
        canonical_group = f'other_{type_suffix}'
    else:
        canonical_group = 'uncategorized'
        conflict_flag = 1

    match_method = 'pattern'
    review_needed = 1 if (conflict_flag or always_review) else 0

    return canonical_group, match_method, review_needed, conflict_flag


def build_mappings(conn: sqlite3.Connection, now: str) -> list[dict]:
    """
    Load all net disciplines and classify each one. Returns rows ready for insert.
    """
    rows = conn.execute("""
        SELECT id AS discipline_id, name, team_type
        FROM event_disciplines
        WHERE discipline_category = 'net'
        ORDER BY name
    """).fetchall()

    mappings = []
    for row in rows:
        disc_id   = row['discipline_id']
        name      = row['name'] or ''
        team_type = row['team_type'] or 'singles'

        canonical_group, match_method, review_needed, conflict_flag = classify_discipline(
            name, team_type
        )
        mappings.append({
            'discipline_id':   disc_id,
            'canonical_group': canonical_group,
            'match_method':    match_method,
            'review_needed':   review_needed,
            'conflict_flag':   conflict_flag,
            'mapped_at':       now,
            'mapped_by':       SCRIPT_NAME,
        })

    return mappings


def write_results(conn: sqlite3.Connection, mappings: list[dict], now: str) -> None:
    """Idempotent write: DELETE + INSERT OR REPLACE."""
    with conn:
        conn.execute("DELETE FROM net_discipline_group")
        conn.execute("DELETE FROM net_stat_policy")

        conn.executemany("""
            INSERT INTO net_discipline_group
              (discipline_id, canonical_group, match_method, review_needed, conflict_flag,
               mapped_at, mapped_by)
            VALUES
              (:discipline_id, :canonical_group, :match_method, :review_needed, :conflict_flag,
               :mapped_at, :mapped_by)
        """, mappings)

        for policy in STAT_POLICY_ROWS:
            conn.execute("""
                INSERT INTO net_stat_policy
                  (evidence_class, display_label, may_show_public, requires_disclaimer,
                   disclaimer_text, may_use_in_stats, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                policy['evidence_class'], policy['display_label'],
                policy['may_show_public'], policy['requires_disclaimer'],
                policy['disclaimer_text'], policy['may_use_in_stats'],
                now,
            ))


def print_summary(mappings: list[dict]) -> None:
    print(f"\n=== Script 12 summary ===")
    print(f"  Total disciplines mapped: {len(mappings):,}")

    by_group: dict[str, int] = defaultdict(int)
    for m in mappings:
        by_group[m['canonical_group']] += 1
    print("\n  By canonical_group:")
    for group in sorted(by_group):
        print(f"    {group:<30} {by_group[group]:>4}")

    review_count   = sum(1 for m in mappings if m['review_needed'])
    conflict_count = sum(1 for m in mappings if m['conflict_flag'])
    fallback_count = sum(1 for m in mappings if m['match_method'] == 'fallback')
    print(f"\n  review_needed=1:  {review_count}")
    print(f"  conflict_flag=1:  {conflict_count}")
    print(f"  fallback matches: {fallback_count}")

    if conflict_count:
        print("\n  Disciplines with conflict_flag=1 (sample, first 20):")
        seen = 0
        for m in mappings:
            if m['conflict_flag'] and seen < 20:
                print(f"    discipline_id={m['discipline_id']!r}  group={m['canonical_group']}")
                seen += 1

    if review_count:
        print(f"\n  Run to inspect:")
        print(f"    SELECT discipline_id, canonical_group, conflict_flag, review_needed")
        print(f"    FROM net_discipline_group WHERE review_needed=1 ORDER BY canonical_group;")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, help='Path to footbag.db')
    args = parser.parse_args()

    if not os.path.exists(args.db):
        print(f"ERROR: database not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")

    now = now_iso()

    print("Loading net disciplines from canonical tables...")
    mappings = build_mappings(conn, now)
    print(f"  {len(mappings):,} net disciplines loaded")

    print("Writing results...")
    write_results(conn, mappings, now)

    print_summary(mappings)
    print("\nDone.")
    conn.close()


if __name__ == '__main__':
    main()
