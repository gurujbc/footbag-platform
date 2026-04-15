#!/usr/bin/env python3
"""
13_build_net_teams.py

Builds stable doubles-team entities from canonical net placement data.

Reads canonical tables (read-only):
  event_result_entries, event_result_entry_participants, event_disciplines, events

Writes enrichment tables (additive layer — canonical tables are never modified):
  net_team        — one row per sorted (person_id_a, person_id_b) pair
  net_team_member — two rows per team (enables person→teams index)
  net_team_appearance — one row per (team × event_discipline), best placement kept

Team identity:
  team_id = UUID5(NAMESPACE, f"{person_id_a}|{person_id_b}")
  NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')  ← DO NOT CHANGE
  person_id_a is always lexicographically < person_id_b (guaranteed by sorted())

appearance_count definition:
  count(distinct (event_id, discipline_id)) — not raw entry count.
  A team entering two divisions at the same event counts as 2 appearances.

QC checks and their semantics:
  unknown_team (priority 3)
    Both participants resolve to the shared Unknown sentinel UUID. Entry excluded from
    net_team — no meaningful team identity can be constructed. Expected for pre-1997
    events where player names were not preserved. NOT a data error.

  self_team (priority 1)
    Both participants resolve to the same non-Unknown person_id. Genuine data conflict —
    implies an identity resolution error in the canonical pipeline.

  multi_stage_result (priority 3)
    Same team appears more than once in the same (event, discipline). Consistent with
    pool+bracket tournament formats where both a seeding result and a final placement
    are stored as separate entries. Best placement (lowest number) is kept in
    net_team_appearance; additional entries are logged here for auditability.
    NOT a duplicate ingestion error.

  discipline_team_type_mismatch (priority 2)
    Discipline name contains 'singles' but team_type = 'doubles' in canonical data.
    Likely a canonical data entry error. Does not block team construction.

  wrong_participant_count (priority 2)
    Doubles entry has ≠ 2 participants. Structural issue.

  unlinked_participant (priority 2)
    One or more participants have null historical_person_id. Unresolvable.

  impossible_placement (priority 2)
    Placement ≤ 0 or > 999. Structural issue.

Usage (from legacy_data/):
    python event_results/scripts/13_build_net_teams.py \\
        --db ~/projects/footbag-platform/database/footbag.db

Or via run_pipeline.sh which resolves --db automatically.
"""

import argparse
import os
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone

# Fixed UUID5 namespace — must never change or existing team_ids will orphan appearance FKs.
TEAM_UUID_NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')

# Canonical sentinel for unresolved person identity in the pipeline.
# Both participants resolving to this UUID indicates an unknown team — excluded but not an error.
UNKNOWN_PERSON_ID = '5b822d40-0dbd-57c9-9119-bb02821d0081'

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
SCRIPT_NAME = os.path.basename(__file__)


def make_team_id(pid_a: str, pid_b: str) -> str:
    """Deterministic UUID5 for a sorted (pid_a, pid_b) pair."""
    assert pid_a < pid_b, f"person_id_a must be < person_id_b: {pid_a!r}, {pid_b!r}"
    return str(uuid.uuid5(TEAM_UUID_NAMESPACE, f"{pid_a}|{pid_b}"))


def make_member_id(team_id: str, position: str) -> str:
    return str(uuid.uuid5(TEAM_UUID_NAMESPACE, f"{team_id}|member|{position}"))


def make_appearance_id(team_id: str, result_entry_id: str) -> str:
    return str(uuid.uuid5(TEAM_UUID_NAMESPACE, f"{team_id}|appearance|{result_entry_id}"))


def make_qc_id(check_id: str, context: str) -> str:
    return str(uuid.uuid5(TEAM_UUID_NAMESPACE, f"qc|{check_id}|{context}"))


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def qc_row(
    check_id: str,
    context: str,
    *,
    priority: int,
    event_id: str | None,
    discipline_id: str | None,
    severity: str,
    reason_code: str,
    message: str,
    now: str,
) -> dict:
    return {
        'id': make_qc_id(check_id, context),
        'source_file': SCRIPT_NAME,
        'item_type': 'qc_issue',
        'priority': priority,
        'event_id': event_id,
        'discipline_id': discipline_id,
        'check_id': check_id,
        'severity': severity,
        'reason_code': reason_code,
        'message': message,
        'raw_context': None,
        'review_stage': 'script_13',
        'resolution_status': 'open',
        'resolution_notes': None,
        'resolved_by': None,
        'resolved_at': None,
        'imported_at': now,
    }


def load_doubles_net_entries(conn: sqlite3.Connection) -> list[dict]:
    """
    Returns one dict per doubles-net result entry, with both participant person_ids
    and the discipline name (for mismatch detection).
    """
    sql = """
        SELECT
            ere.id          AS result_entry_id,
            ere.event_id,
            ere.discipline_id,
            ed.name         AS discipline_name,
            ere.placement,
            ere.score_text,
            CAST(strftime('%Y', e.start_date) AS INTEGER) AS event_year,
            COUNT(erep.id) AS participant_count,
            SUM(CASE WHEN erep.historical_person_id IS NULL THEN 1 ELSE 0 END) AS unlinked_count,
            GROUP_CONCAT(erep.historical_person_id
                ORDER BY erep.participant_order, erep.id) AS pid_csv,
            GROUP_CONCAT(erep.display_name
                ORDER BY erep.participant_order, erep.id) AS name_csv
        FROM event_result_entries ere
        JOIN event_disciplines ed ON ed.id = ere.discipline_id
        JOIN events e ON e.id = ere.event_id
        JOIN event_result_entry_participants erep ON erep.result_entry_id = ere.id
        WHERE ed.discipline_category = 'net'
          AND ed.team_type = 'doubles'
        GROUP BY ere.id
    """
    rows = conn.execute(sql).fetchall()
    return [dict(r) for r in rows]


def build_teams(
    entries: list[dict],
    now: str,
) -> tuple[dict, list[dict], list[dict]]:
    """
    Process raw entry rows into team, appearance, and QC issue collections.

    Multi-stage handling: when the same team appears more than once in the same
    (event_id, discipline_id), keep only the best (lowest) placement in
    net_team_appearance. Log all displaced entries as multi_stage_result in QC.

    Returns:
      teams       — {team_id: team_dict}
      appearances — {(team_id, event_id, discipline_id): best appearance dict}
      qc_issues   — list of net_review_queue dicts
    """
    teams: dict[str, dict] = {}
    # Keyed by (team_id, event_id, discipline_id) — holds best-placement appearance
    best_appearances: dict[tuple, dict] = {}
    qc_issues: list[dict] = []

    # Track discipline_team_type mismatches (one QC row per discipline, not per entry)
    flagged_discipline_mismatch: set[str] = set()

    for row in entries:
        result_entry_id  = row['result_entry_id']
        event_id         = row['event_id']
        discipline_id    = row['discipline_id']
        discipline_name  = row['discipline_name'] or ''
        placement        = row['placement']
        event_year       = row['event_year']
        participant_count = row['participant_count']
        unlinked_count    = row['unlinked_count']
        pid_csv           = row['pid_csv'] or ''
        pids = [p for p in pid_csv.split(',') if p]

        # QC: discipline name contains 'singles' but team_type is 'doubles'
        if 'singles' in discipline_name.lower() and discipline_id not in flagged_discipline_mismatch:
            flagged_discipline_mismatch.add(discipline_id)
            qc_issues.append(qc_row(
                'discipline_team_type_mismatch', discipline_id,
                priority=2,
                event_id=event_id,
                discipline_id=discipline_id,
                severity='medium',
                reason_code='discipline_team_type_mismatch',
                message=(
                    f"Discipline '{discipline_name}' (id={discipline_id}) has "
                    f"team_type='doubles' but name suggests singles. "
                    f"Likely a canonical data entry error."
                ),
                now=now,
            ))

        # QC: participant count must be exactly 2
        if participant_count != 2 or len(pids) != 2:
            qc_issues.append(qc_row(
                'wrong_participant_count', result_entry_id,
                priority=2,
                event_id=event_id,
                discipline_id=discipline_id,
                severity='high',
                reason_code='participant_count_mismatch',
                message=(
                    f"Doubles entry {result_entry_id} has {participant_count} participant(s), "
                    f"expected 2. PIDs: {pid_csv!r}"
                ),
                now=now,
            ))
            continue

        # QC: all participants must be linked
        if unlinked_count > 0:
            qc_issues.append(qc_row(
                'unlinked_participant', result_entry_id,
                priority=2,
                event_id=event_id,
                discipline_id=discipline_id,
                severity='high',
                reason_code='null_historical_person_id',
                message=(
                    f"Doubles entry {result_entry_id} has {unlinked_count} unlinked participant(s)."
                ),
                now=now,
            ))
            continue

        pid_a, pid_b = sorted(pids)

        # QC: same player on both sides — split by whether both are the Unknown sentinel
        if pid_a == pid_b:
            if pid_a == UNKNOWN_PERSON_ID:
                # Both participants are the Unknown sentinel — expected for entries where
                # player names were not preserved. Not an error; excluded from net_team.
                qc_issues.append(qc_row(
                    'unknown_team', result_entry_id,
                    priority=3,
                    event_id=event_id,
                    discipline_id=discipline_id,
                    severity='low',
                    reason_code='unknown_team',
                    message=(
                        f"Doubles entry {result_entry_id} has two Unknown participants "
                        f"(sentinel UUID {UNKNOWN_PERSON_ID}). Excluded from net_team — "
                        f"no meaningful team identity can be constructed."
                    ),
                    now=now,
                ))
            else:
                # Same non-Unknown person on both sides — genuine identity conflict
                qc_issues.append(qc_row(
                    'same_player_both_sides', result_entry_id,
                    priority=1,
                    event_id=event_id,
                    discipline_id=discipline_id,
                    severity='critical',
                    reason_code='self_team',
                    message=(
                        f"Doubles entry {result_entry_id} has the same non-Unknown "
                        f"person_id on both sides: {pid_a!r}. Likely an identity "
                        f"resolution error in the canonical pipeline."
                    ),
                    now=now,
                ))
            continue

        # QC: impossible placement
        if placement <= 0 or placement > 999:
            qc_issues.append(qc_row(
                'impossible_placement', result_entry_id,
                priority=2,
                event_id=event_id,
                discipline_id=discipline_id,
                severity='high',
                reason_code='placement_out_of_range',
                message=(
                    f"Entry {result_entry_id} has impossible placement {placement}."
                ),
                now=now,
            ))
            continue

        team_id = make_team_id(pid_a, pid_b)

        # Build appearance dict for this entry
        new_appearance = {
            'id': make_appearance_id(team_id, result_entry_id),
            'team_id': team_id,
            'event_id': event_id,
            'discipline_id': discipline_id,
            'result_entry_id': result_entry_id,
            'placement': placement,
            'score_text': row['score_text'],
            'event_year': event_year,
            'evidence_class': 'canonical_only',
            'extracted_at': now,
        }

        # Multi-stage deduplication: keep best (lowest) placement per (team, event, disc)
        key = (team_id, event_id, discipline_id)
        if key in best_appearances:
            existing = best_appearances[key]
            if placement < existing['placement']:
                # New entry is a better result — displace existing, log it as multi_stage
                displaced = existing
                best_appearances[key] = new_appearance
            else:
                # Existing is better — log new entry as multi_stage
                displaced = new_appearance

            qc_issues.append(qc_row(
                'multi_stage_result', f"{team_id}|{displaced['result_entry_id']}",
                priority=3,
                event_id=event_id,
                discipline_id=discipline_id,
                severity='low',
                reason_code='multi_stage_result',
                message=(
                    f"Team {team_id} has multiple entries in event {event_id} "
                    f"discipline {discipline_id}. Consistent with pool+bracket format. "
                    f"Displaced entry {displaced['result_entry_id']} "
                    f"(placement {displaced['placement']}) in favour of best placement "
                    f"{best_appearances[key]['placement']}."
                ),
                now=now,
            ))
            # Still accumulate year stats (both rounds happened)
        else:
            best_appearances[key] = new_appearance

        # Accumulate team stats
        if team_id not in teams:
            teams[team_id] = {
                'team_id': team_id,
                'person_id_a': pid_a,
                'person_id_b': pid_b,
                'first_year': event_year,
                'last_year': event_year,
                'event_disc_set': set(),
                'created_at': now,
                'updated_at': now,
            }
        else:
            t = teams[team_id]
            if event_year is not None:
                if t['first_year'] is None or event_year < t['first_year']:
                    t['first_year'] = event_year
                if t['last_year'] is None or event_year > t['last_year']:
                    t['last_year'] = event_year

        teams[team_id]['event_disc_set'].add((event_id, discipline_id))

    # Finalize appearance_count from distinct (event_id, discipline_id) pairs
    for t in teams.values():
        t['appearance_count'] = len(t.pop('event_disc_set'))

    return teams, list(best_appearances.values()), qc_issues


def detect_position_flips(conn: sqlite3.Connection, teams: dict) -> None:
    """
    Warn when participant_order of a team's members differs across events —
    a data quality signal (non-blocking; position field is non-semantic).
    """
    flip_count = 0
    for team_id, t in teams.items():
        pid_a, pid_b = t['person_id_a'], t['person_id_b']
        rows = conn.execute("""
            SELECT erep.result_entry_id,
                   MIN(CASE WHEN erep.historical_person_id = ? THEN erep.participant_order END) AS order_a,
                   MIN(CASE WHEN erep.historical_person_id = ? THEN erep.participant_order END) AS order_b
            FROM event_result_entry_participants erep
            JOIN event_result_entries ere ON ere.id = erep.result_entry_id
            JOIN event_disciplines ed ON ed.id = ere.discipline_id
            WHERE ed.discipline_category = 'net'
              AND ed.team_type = 'doubles'
              AND erep.historical_person_id IN (?, ?)
            GROUP BY erep.result_entry_id
        """, (pid_a, pid_b, pid_a, pid_b)).fetchall()

        orders_a = [r['order_a'] for r in rows if r['order_a'] is not None]
        orders_b = [r['order_b'] for r in rows if r['order_b'] is not None]
        if orders_a and orders_b:
            if (min(orders_a) != max(orders_a)) or (min(orders_b) != max(orders_b)):
                flip_count += 1

    if flip_count:
        print(f"  {flip_count} team(s) with participant_order flips (non-blocking; position field is non-semantic)")


def write_results(
    conn: sqlite3.Connection,
    teams: dict,
    appearances: list[dict],
    qc_issues: list[dict],
    now: str,
) -> None:
    """
    Writes all output in a single transaction. Deletes existing net enrichment
    rows first (idempotent re-run). Preserves net_review_queue rows that already
    have resolution_notes (INSERT OR IGNORE).
    """
    with conn:
        # Clear previous script-13 output (cascade order)
        conn.execute("DELETE FROM net_team_appearance WHERE evidence_class = 'canonical_only'")
        conn.execute("DELETE FROM net_team_member")
        conn.execute("DELETE FROM net_team")
        # Clear only unresolved script-13 QC rows so manual resolutions survive
        conn.execute(
            "DELETE FROM net_review_queue WHERE source_file = ? AND resolution_status = 'open'",
            (SCRIPT_NAME,)
        )

        # Insert teams
        conn.executemany("""
            INSERT INTO net_team
              (team_id, person_id_a, person_id_b, first_year, last_year,
               appearance_count, created_at, updated_at)
            VALUES
              (:team_id, :person_id_a, :person_id_b, :first_year, :last_year,
               :appearance_count, :created_at, :updated_at)
        """, teams.values())

        # Insert members (2 per team)
        members = []
        for t in teams.values():
            members.append({
                'id': make_member_id(t['team_id'], 'a'),
                'team_id': t['team_id'],
                'person_id': t['person_id_a'],
                'position': 'a',
            })
            members.append({
                'id': make_member_id(t['team_id'], 'b'),
                'team_id': t['team_id'],
                'person_id': t['person_id_b'],
                'position': 'b',
            })
        conn.executemany("""
            INSERT INTO net_team_member (id, team_id, person_id, position)
            VALUES (:id, :team_id, :person_id, :position)
        """, members)

        # Insert appearances
        conn.executemany("""
            INSERT INTO net_team_appearance
              (id, team_id, event_id, discipline_id, result_entry_id,
               placement, score_text, event_year, evidence_class, extracted_at)
            VALUES
              (:id, :team_id, :event_id, :discipline_id, :result_entry_id,
               :placement, :score_text, :event_year, :evidence_class, :extracted_at)
        """, appearances)

        # Insert QC issues (OR IGNORE — preserve any existing manual resolutions)
        conn.executemany("""
            INSERT OR IGNORE INTO net_review_queue
              (id, source_file, item_type, priority, event_id, discipline_id,
               check_id, severity, reason_code, message, raw_context,
               review_stage, resolution_status, resolution_notes,
               resolved_by, resolved_at, imported_at)
            VALUES
              (:id, :source_file, :item_type, :priority, :event_id, :discipline_id,
               :check_id, :severity, :reason_code, :message, :raw_context,
               :review_stage, :resolution_status, :resolution_notes,
               :resolved_by, :resolved_at, :imported_at)
        """, qc_issues)


def print_summary(teams: dict, appearances: list[dict], qc_issues: list[dict]) -> None:
    print(f"\n=== Script 13 summary ===")
    print(f"  Teams:              {len(teams):>6,}")
    print(f"  Members:            {len(teams) * 2:>6,}")
    print(f"  Appearances:        {len(appearances):>6,}")
    print(f"  QC issues logged:   {len(qc_issues):>6,}")

    by_check: dict[str, int] = defaultdict(int)
    for q in qc_issues:
        by_check[q['check_id']] += 1
    for check_id in sorted(by_check):
        p = next(q['priority'] for q in qc_issues if q['check_id'] == check_id)
        print(f"    [{p}] {check_id}: {by_check[check_id]}")


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

    print("Loading doubles net entries from canonical tables...")
    entries = load_doubles_net_entries(conn)
    print(f"  {len(entries):,} doubles net result entries")

    print("Building teams...")
    teams, appearances, qc_issues = build_teams(entries, now)

    print("Checking for participant_order flips (data quality signal)...")
    detect_position_flips(conn, teams)

    print("Writing results...")
    write_results(conn, teams, appearances, qc_issues, now)

    print_summary(teams, appearances, qc_issues)
    print("\nDone.")
    conn.close()


if __name__ == '__main__':
    main()
