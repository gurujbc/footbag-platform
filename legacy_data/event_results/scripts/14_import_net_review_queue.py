#!/usr/bin/env python3
"""
14_import_net_review_queue.py

Imports quarantine events and stage-2 QC issues into net_review_queue.

Reads (read-only):
  legacy_data/inputs/review_quarantine_events.csv   — 9 rows
  legacy_data/out/stage2_qc_issues.jsonl            — ~506 rows

Writes:
  net_review_queue — uses INSERT OR IGNORE so any resolution_notes written by
  script 13's QC pass are preserved.

Priority mapping
  quarantine_event rows:
    review_stage contains 'CRITICAL' → priority 1
    otherwise                        → priority 2
  qc_issue rows (from stage2_qc_issues.jsonl):
    severity CRITICAL                → priority 1
    severity HIGH                    → priority 2
    severity WARN                    → priority 3  (maps to medium)
    severity INFO                    → priority 4  (maps to low)
    unrecognised                     → priority 3

Row IDs are UUID5-deterministic so the script is fully idempotent:
  quarantine  → UUID5(NAMESPACE, "quarantine|{event_id}")
  qc_issue    → UUID5(NAMESPACE, "qcissue|{check_id}|{event_id}")

Re-running drops only unresolved rows; rows with resolution_notes set by script 13
are preserved by INSERT OR IGNORE.

Usage:
    cd legacy_data
    python3 event_results/scripts/14_import_net_review_queue.py \\
        --db ~/projects/footbag-platform/database/footbag.db

Or via run_pipeline.sh which resolves --db automatically.
"""

import argparse
import csv
import json
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import uuid
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Same namespace as script 13 — shared across all net enrichment scripts
NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')

SEVERITY_TO_PRIORITY: dict[str, int] = {
    'CRITICAL': 1,
    'HIGH':     2,
    'WARN':     3,
    'MEDIUM':   3,
    'INFO':     4,
    'LOW':      4,
}

IMPORT_SOURCE = '14_import_net_review_queue.py'
IMPORTED_AT = __import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_id(prefix: str, *parts: str) -> str:
    key = '|'.join([prefix, *parts])
    return str(uuid.uuid5(NAMESPACE, key))


def quarantine_priority(review_stage: str) -> int:
    if 'CRITICAL' in review_stage.upper():
        return 1
    return 2


def qc_priority(severity: str) -> int:
    return SEVERITY_TO_PRIORITY.get(severity.upper(), 3)


# ---------------------------------------------------------------------------
# Import functions
# ---------------------------------------------------------------------------

def import_quarantine_events(
    db: sqlite3.Connection,
    csv_path: Path,
) -> tuple[int, int]:
    """
    Import quarantine_event rows. Returns (inserted, skipped) counts.
    """
    inserted = 0
    skipped = 0

    with open(csv_path, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            event_id   = row['event_id'].strip()
            year       = row['year'].strip()
            event_name = row['event_name'].strip()
            reason     = row['reason'].strip()
            stage      = row['review_stage'].strip()
            notes      = row['notes'].strip()

            row_id   = make_id('quarantine', event_id)
            priority = quarantine_priority(stage)
            message  = f"{event_name} ({year}): {notes}" if notes else f"{event_name} ({year})"

            cursor = db.execute(
                """
                INSERT OR IGNORE INTO net_review_queue (
                    id, source_file, item_type, priority,
                    event_id, check_id,
                    severity, reason_code, message,
                    raw_context, review_stage,
                    resolution_status, imported_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    row_id,
                    IMPORT_SOURCE,
                    'quarantine_event',
                    priority,
                    event_id,
                    None,           # check_id not applicable
                    'HIGH',         # normalised severity
                    reason,
                    message,
                    None,           # no raw_context JSON for quarantine rows
                    stage,
                    'open',
                    IMPORTED_AT,
                ),
            )
            if cursor.rowcount == 1:
                inserted += 1
            else:
                skipped += 1

    return inserted, skipped


def import_qc_issues(
    db: sqlite3.Connection,
    jsonl_path: Path,
) -> tuple[int, int, list[str]]:
    """
    Import qc_issue rows from stage2_qc_issues.jsonl.
    Returns (inserted, skipped, collision_log).

    collision_log entries: any (check_id, event_id) pair that appeared more than
    once in the file — logged but not treated as an error.
    """
    inserted  = 0
    skipped   = 0
    seen_keys: dict[str, int] = {}          # row_id → line number
    collisions: list[str] = []

    with open(jsonl_path, encoding='utf-8') as fh:
        for lineno, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)

            check_id = data.get('check_id', '')
            event_id = data.get('event_id', '')
            severity = data.get('severity', '')
            message  = data.get('message', '')
            context  = data.get('context') or {}
            field    = data.get('field', '')

            row_id = make_id('qcissue', check_id, event_id)
            if row_id in seen_keys:
                collisions.append(
                    f"line {lineno}: duplicate key for check_id={check_id!r} "
                    f"event_id={event_id!r} (first seen line {seen_keys[row_id]})"
                )
            seen_keys[row_id] = lineno

            # Merge field and example_value into context for raw_context blob
            raw_ctx: dict = {}
            if field:
                raw_ctx['field'] = field
            if 'example_value' in data:
                raw_ctx['example_value'] = data['example_value']
            if context:
                raw_ctx.update(context)
            raw_context_json = json.dumps(raw_ctx) if raw_ctx else None

            priority = qc_priority(severity)

            cursor = db.execute(
                """
                INSERT OR IGNORE INTO net_review_queue (
                    id, source_file, item_type, priority,
                    event_id, check_id,
                    severity, reason_code, message,
                    raw_context, review_stage,
                    resolution_status, imported_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    row_id,
                    IMPORT_SOURCE,
                    'qc_issue',
                    priority,
                    event_id or None,
                    check_id or None,
                    severity,
                    check_id or None,   # reason_code mirrors check_id for QC issues
                    message,
                    raw_context_json,
                    None,               # no review_stage for QC issues
                    'open',
                    IMPORTED_AT,
                ),
            )
            if cursor.rowcount == 1:
                inserted += 1
            else:
                skipped += 1

    return inserted, skipped, collisions


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def print_summary(db: sqlite3.Connection) -> None:
    print()
    print('── net_review_queue summary ─────────────────────────────────')
    rows = db.execute(
        'SELECT item_type, priority, COUNT(*) FROM net_review_queue GROUP BY item_type, priority ORDER BY item_type, priority'
    ).fetchall()
    for item_type, priority, count in rows:
        print(f'  [{priority}] {item_type}: {count}')
    total = db.execute('SELECT COUNT(*) FROM net_review_queue').fetchone()[0]
    print(f'  TOTAL: {total}')

    # Priority 1 items — need attention
    p1 = db.execute(
        "SELECT id, item_type, reason_code, message FROM net_review_queue WHERE priority = 1 LIMIT 20"
    ).fetchall()
    if p1:
        print()
        print('── Priority 1 items (action required) ───────────────────────')
        for row in p1:
            print(f"  [{row[1]}] {row[2]}: {row[3][:80]}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, help='Path to footbag.db')
    parser.add_argument(
        '--quarantine-csv',
        default=None,
        help='Path to review_quarantine_events.csv (default: auto-detected from --db location)',
    )
    parser.add_argument(
        '--qc-jsonl',
        default=None,
        help='Path to stage2_qc_issues.jsonl (default: auto-detected)',
    )
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f'ERROR: DB not found: {db_path}')

    # Resolve input paths relative to legacy_data/
    # __file__ is legacy_data/event_results/scripts/14_… so .parent×3 = legacy_data/
    legacy_data = Path(__file__).resolve().parent.parent.parent

    quarantine_csv = Path(args.quarantine_csv) if args.quarantine_csv else (
        legacy_data / 'inputs' / 'review_quarantine_events.csv'
    )
    qc_jsonl = Path(args.qc_jsonl) if args.qc_jsonl else (
        legacy_data / 'out' / 'stage2_qc_issues.jsonl'
    )

    for path, label in [(quarantine_csv, 'quarantine CSV'), (qc_jsonl, 'QC JSONL')]:
        if not path.exists():
            raise SystemExit(f'ERROR: {label} not found: {path}')

    db = sqlite3.connect(db_path)
    db.execute('PRAGMA foreign_keys = ON')

    try:
        db.execute('BEGIN')

        print(f'Importing quarantine events from {quarantine_csv.name} …')
        q_ins, q_skip = import_quarantine_events(db, quarantine_csv)
        print(f'  inserted={q_ins}  skipped(already present)={q_skip}')

        print(f'Importing QC issues from {qc_jsonl.name} …')
        qc_ins, qc_skip, collisions = import_qc_issues(db, qc_jsonl)
        print(f'  inserted={qc_ins}  skipped(already present)={qc_skip}')

        if collisions:
            print(f'  WARN: {len(collisions)} duplicate key collision(s) in JSONL:')
            for c in collisions[:10]:
                print(f'    {c}')
            if len(collisions) > 10:
                print(f'    … and {len(collisions) - 10} more')

        db.execute('COMMIT')
        print_summary(db)

    except Exception:
        db.execute('ROLLBACK')
        raise
    finally:
        db.close()


if __name__ == '__main__':
    main()
