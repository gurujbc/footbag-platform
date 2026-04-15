#!/usr/bin/env python3
"""
16_extract_net_matches_from_noise.py

Phase 2 noise extraction: scans unstructured text files for net match candidates
and loads them into net_raw_fragment and net_candidate_match.

IMPORTANT — evidence class constraint:
  All rows inserted here have evidence_class = 'unresolved_candidate'.
  No automatic promotion occurs. Curation is a separate human-driven step.

Extraction guard (mandatory — both conditions must hold for a candidate to be inserted):
  1. Two distinct player or team names are detected in the fragment.
  2. A numeric score (e.g. "15-10") OR an explicit win/loss verb
     (defeated, def., bt, beat, lost to) is present.
Fragments that satisfy only one condition are stored as net_raw_fragment
with parse_status='unparseable'.

Confidence scoring:
  0.90  — win verb + score both present
  0.75  — win verb present, no score
  0.65  — score present, no win verb
  (fragments below 0.65 threshold are not promoted to net_candidate_match)

Person linking:
  Extracted names are matched via case-insensitive exact search against
  historical_persons.person_name. Misses are logged; person_id left NULL.

Row IDs:
  net_raw_fragment  → UUID5(NAMESPACE, "frag|{source_label}|{line_num}|{raw_text[:80]}")
  net_candidate_match → UUID5(NAMESPACE, "cand|{fragment_id}|{player_a}|{player_b}")
  All IDs are deterministic — re-running is idempotent.

Usage:
    cd legacy_data
    python3 event_results/scripts/16_extract_net_matches_from_noise.py \\
        --db ~/projects/footbag-platform/database/footbag.db \\
        --input inputs/OLD_RESULTS.txt \\
        --source-label OLD_RESULTS

    # limit to first N fragments for testing:
    python3 event_results/scripts/16_extract_net_matches_from_noise.py \\
        --db ~/projects/footbag-platform/database/footbag.db \\
        --input inputs/OLD_RESULTS.txt \\
        --source-label OLD_RESULTS --limit 100

Or via run_pipeline.sh which resolves --db automatically.
"""

import argparse
import re
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import uuid
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Shared namespace across all net enrichment scripts
NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')

# Minimum confidence score to promote a fragment to net_candidate_match
MIN_CANDIDATE_CONFIDENCE = 0.65

# Regex patterns for extraction

# Score pattern: two numbers separated by a dash (e.g. "15-10", "11-9", "6-2")
# Must look like a score: bounded by word boundaries or whitespace
SCORE_RE = re.compile(r'\b(\d{1,2})-(\d{1,2})\b')

# Win verbs — explicit match outcome signals
WIN_VERB_RE = re.compile(
    r'\b(defeated|def\.|def\b|beat\b|beats\b|bt\b|bt\.)\b'
    r'|lost\s+to\b',
    re.IGNORECASE,
)

# Year hint: bare 4-digit year
YEAR_RE = re.compile(r'\b(19\d{2}|20[012]\d)\b')

# Name separator — slash or "vs" or "versus" separates two-player names in a pair
NAME_SEP_RE = re.compile(r'\s*/\s*|\s+vs\.?\s+|\s+versus\s+', re.IGNORECASE)

# Placement block pattern: "1st - Name/Name" or "1st: Name/Name" (placement results)
# These become fragment_type='placement_block'
PLACEMENT_BLOCK_RE = re.compile(
    r'\b(?:1st|2nd|3rd|\dth)\s*[-:]\s*(.+?)(?=,\s*\d|$)',
    re.IGNORECASE,
)

# Generic bracket/score line: contains a win verb or score between two name-like tokens
BRACKET_LINE_RE = re.compile(
    r'[A-Z][a-z]+.*(?:' + WIN_VERB_RE.pattern + r'|' + SCORE_RE.pattern + r').*[A-Z][a-z]+',
    re.IGNORECASE,
)

# Minimum and maximum line lengths to consider as candidate fragments
MIN_LINE_LEN = 10
MAX_LINE_LEN = 500


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_fragment_id(source_label: str, line_num: int, raw_text: str) -> str:
    key = f'frag|{source_label}|{line_num}|{raw_text[:80]}'
    return str(uuid.uuid5(NAMESPACE, key))


def make_candidate_id(fragment_id: str, player_a: str, player_b: str) -> str:
    key = f'cand|{fragment_id}|{player_a}|{player_b}'
    return str(uuid.uuid5(NAMESPACE, key))


def now_iso() -> str:
    import datetime
    return datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')


def classify_fragment(line: str) -> Optional[str]:
    """Return fragment_type or None if the line should be skipped."""
    if len(line) < MIN_LINE_LEN or len(line) > MAX_LINE_LEN:
        return None
    if PLACEMENT_BLOCK_RE.search(line):
        return 'placement_block'
    if WIN_VERB_RE.search(line):
        return 'match_result'
    if SCORE_RE.search(line) and BRACKET_LINE_RE.search(line):
        return 'bracket_line'
    return None


def extract_year_hint(text: str) -> Optional[int]:
    m = YEAR_RE.search(text)
    return int(m.group(1)) if m else None


def extract_score(text: str) -> Optional[str]:
    m = SCORE_RE.search(text)
    if m:
        return m.group(0)
    return None


def has_win_verb(text: str) -> bool:
    return bool(WIN_VERB_RE.search(text))


def split_name_pair(text: str) -> Optional[tuple[str, str]]:
    """
    Split a text token into two player names using NAME_SEP_RE.
    Returns (name_a, name_b) if exactly one separator is found, else None.
    """
    parts = NAME_SEP_RE.split(text.strip(), maxsplit=1)
    if len(parts) == 2:
        a, b = parts[0].strip(), parts[1].strip()
        if a and b and a != b:
            return a, b
    return None


def extract_players_from_placement_block(line: str) -> Optional[tuple[str, str]]:
    """
    For placement_block lines like '1st - Alice/Bob, 2nd - Carol/Dave,',
    extract the winner pair from the leading placement entry.
    """
    m = PLACEMENT_BLOCK_RE.search(line)
    if not m:
        return None
    candidate_text = m.group(1).strip()
    # Strip trailing comma or similar noise
    candidate_text = re.sub(r',.*$', '', candidate_text).strip()
    return split_name_pair(candidate_text)


def extract_players_from_match_line(line: str) -> Optional[tuple[str, str]]:
    """
    For match_result / bracket_line patterns, look for two name-like tokens
    separated by a win verb or adjacent to a score.
    Returns (name_a, name_b) where name_a is the apparent winner.
    """
    # Strategy: split on win verb, then look for names on either side
    parts = WIN_VERB_RE.split(line, maxsplit=1)
    if len(parts) >= 2:
        left  = parts[0].strip().split()
        right = parts[-1].strip().split()
        # Take the last 2-3 words from the left and first 2-3 words from right
        # as approximate name tokens
        left_name  = ' '.join(left[-2:]).strip().rstrip(',;:') if left else ''
        right_name = ' '.join(right[:2]).strip().rstrip(',;:') if right else ''
        if left_name and right_name and left_name != right_name:
            return left_name, right_name
    return None


def lookup_person(db: sqlite3.Connection, name: str) -> Optional[str]:
    """Case-insensitive exact name lookup in historical_persons."""
    row = db.execute(
        'SELECT person_id FROM historical_persons WHERE LOWER(person_name) = LOWER(?)',
        (name,),
    ).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def process_file(
    db: sqlite3.Connection,
    source_path: Path,
    source_label: str,
    limit: Optional[int],
    year_hint_override: Optional[int],
    event_id_filter: Optional[str],
) -> dict:
    """
    Read source_path, extract fragments and candidates.
    Returns summary dict.
    """
    ts = now_iso()
    stats = {
        'lines_read':      0,
        'fragments':       0,
        'candidates':      0,
        'unparseable':     0,
        'skipped':         0,
        'person_links':    0,
        'person_misses':   0,
        'parse_errors':    0,
    }

    # Read lines — try utf-8 first, fall back to latin-1 for binary/legacy files
    try:
        lines = source_path.read_text(encoding='utf-8', errors='replace').splitlines()
    except Exception:
        lines = source_path.read_bytes().decode('latin-1', errors='replace').splitlines()

    if limit is not None:
        lines = lines[:limit]

    stats['lines_read'] = len(lines)

    frag_insert = '''
        INSERT OR IGNORE INTO net_raw_fragment
          (id, source_file, source_line, raw_text, fragment_type,
           event_hint, year_hint, parse_status, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    '''

    cand_insert = '''
        INSERT OR IGNORE INTO net_candidate_match
          (candidate_id, fragment_id, event_id, discipline_id,
           player_a_raw_name, player_b_raw_name,
           player_a_person_id, player_b_person_id,
           raw_text, extracted_score, round_hint, year_hint,
           confidence_score, evidence_class, review_status, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved_candidate', 'pending', ?)
    '''

    with db:
        for line_num, raw_line in enumerate(lines, start=1):
            line = raw_line.strip()
            if not line:
                continue

            fragment_type = classify_fragment(line)
            if fragment_type is None:
                stats['skipped'] += 1
                continue

            frag_id    = make_fragment_id(source_label, line_num, line)
            year_hint  = year_hint_override or extract_year_hint(line)
            has_verb   = has_win_verb(line)
            score      = extract_score(line)

            # Attempt player extraction based on fragment type
            players: Optional[tuple[str, str]] = None
            if fragment_type == 'placement_block':
                players = extract_players_from_placement_block(line)
            else:
                players = extract_players_from_match_line(line)

            # Determine parse_status and whether to promote to candidate
            two_players = players is not None
            has_score   = score is not None
            extraction_signal = has_verb or has_score

            if two_players and extraction_signal:
                parse_status = 'parsed'
            elif two_players or extraction_signal:
                # Only one condition met — store fragment but do not promote
                parse_status = 'unparseable'
                stats['unparseable'] += 1
            else:
                parse_status = 'unparseable'
                stats['unparseable'] += 1

            # Insert fragment
            db.execute(frag_insert, (
                frag_id,
                str(source_path.name),
                line_num,
                line,
                fragment_type,
                event_id_filter,     # event_hint — operator-supplied event context
                year_hint,
                parse_status,
                ts,
            ))
            stats['fragments'] += 1

            # Only promote to candidate if extraction guard passed
            if parse_status != 'parsed':
                continue

            assert players is not None
            player_a_raw, player_b_raw = players

            # Confidence scoring
            if has_verb and has_score:
                confidence = 0.90
            elif has_verb:
                confidence = 0.75
            else:
                confidence = 0.65

            if confidence < MIN_CANDIDATE_CONFIDENCE:
                continue

            # Person linking
            pid_a = lookup_person(db, player_a_raw)
            pid_b = lookup_person(db, player_b_raw)
            if pid_a:
                stats['person_links'] += 1
            else:
                stats['person_misses'] += 1
            if pid_b:
                stats['person_links'] += 1
            else:
                stats['person_misses'] += 1

            cand_id = make_candidate_id(frag_id, player_a_raw, player_b_raw)

            db.execute(cand_insert, (
                cand_id,
                frag_id,
                event_id_filter,     # event_id — operator-supplied, nullable
                None,                # discipline_id — not inferred at extraction time
                player_a_raw,
                player_b_raw,
                pid_a,
                pid_b,
                line,
                score,
                None,                # round_hint — not inferred at extraction time
                year_hint,
                confidence,
                ts,
            ))
            stats['candidates'] += 1

    return stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description='Extract net match candidates from unstructured noise sources.',
    )
    parser.add_argument(
        '--db', required=True, type=Path,
        help='Path to footbag.db SQLite database',
    )
    parser.add_argument(
        '--input', required=True, type=Path,
        help='Path to the noise source file to process',
    )
    parser.add_argument(
        '--source-label', required=True,
        help='Short label for this source (e.g. OLD_RESULTS). Used in fragment IDs.',
    )
    parser.add_argument(
        '--limit', type=int, default=None,
        help='Only process the first N lines (for testing)',
    )
    parser.add_argument(
        '--event', type=str, default=None,
        help='Optional event_id context hint — stored as event_hint on fragments '
             'and event_id on candidates. Does not filter input; it annotates output.',
    )
    parser.add_argument(
        '--year', type=int, default=None,
        help='Optional year override — stored as year_hint on all rows from this run.',
    )
    args = parser.parse_args()

    if not args.db.exists():
        raise SystemExit(f'ERROR: database not found: {args.db}')
    if not args.input.exists():
        raise SystemExit(f'ERROR: input file not found: {args.input}')

    db = sqlite3.connect(str(args.db))
    db.execute('PRAGMA foreign_keys = ON')
    db.execute('PRAGMA journal_mode = WAL')

    print(f'Processing: {args.input} (source_label={args.source_label})')

    stats = process_file(
        db=db,
        source_path=args.input,
        source_label=args.source_label,
        limit=args.limit,
        year_hint_override=args.year,
        event_id_filter=args.event,
    )

    db.close()

    print()
    print('── Extraction summary ──────────────────────────────────────────────')
    print(f"  Lines read          : {stats['lines_read']}")
    print(f"  Fragments inserted  : {stats['fragments']}")
    print(f"    parsed            : {stats['candidates']}")
    print(f"    unparseable       : {stats['unparseable']}")
    print(f"    skipped (no match): {stats['skipped']}")
    print(f"  Candidates inserted : {stats['candidates']}")
    print(f"  Person links        : {stats['person_links']}")
    print(f"  Person misses       : {stats['person_misses']}")
    print('────────────────────────────────────────────────────────────────────')

    if stats['candidates'] == 0:
        print()
        print('NOTE: 0 candidates extracted. This is expected if the source file')
        print('contains only placement-level data (no scores or win verbs).')
        print('Fragments are still stored for future re-processing.')


if __name__ == '__main__':
    main()
