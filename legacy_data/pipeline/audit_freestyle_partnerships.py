#!/usr/bin/env python3
"""
audit_freestyle_partnerships.py

Audits freestyle doubles results and extracts clean partnership data.

Usage (from legacy_data/):
    .venv/bin/python pipeline/audit_freestyle_partnerships.py

Outputs:
    out/freestyle_partnerships_summary.csv
    out/freestyle_partnerships_events.csv
    stdout: audit report
"""

from __future__ import annotations

import csv
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT.parent / "database" / "footbag.db"
OUT = ROOT / "out"

# Discipline name patterns to EXCLUDE from freestyle doubles partnerships.
# These are individual trick/shred/circle contests that happen to be tagged
# team_type=doubles but are not actually partnership routines.
_EXCLUDE_PATTERNS = {
    "sick", "big trick", "huge", "combo", "rewind", "ironman",
    "battle", "circle", "shred", "30 second", "timed consecutive",
    "5-minute",
}


def is_freestyle_doubles_routine(name: str) -> bool:
    """Include all freestyle doubles EXCEPT trick/shred/circle contests."""
    lower = name.lower()
    return not any(ex in lower for ex in _EXCLUDE_PATTERNS)


def main() -> None:
    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # ── Step 1: Identify freestyle doubles disciplines ─────────────────
    all_discs = conn.execute("""
        SELECT ed.id, ed.name, ed.team_type, ed.discipline_category,
               ed.event_id, e.title AS event_title,
               CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER) AS event_year
        FROM event_disciplines ed
        JOIN events e ON e.id = ed.event_id
        WHERE ed.discipline_category = 'freestyle' AND ed.team_type = 'doubles'
    """).fetchall()

    included = []
    excluded = []
    for d in all_discs:
        if is_freestyle_doubles_routine(d["name"]):
            included.append(d)
        else:
            excluded.append(d)

    disc_ids = {d["id"] for d in included}

    # ── Step 2: Extract raw doubles entries ─────────────────────────────
    entries = conn.execute("""
        SELECT
            re.id AS entry_id,
            re.event_id,
            e.title AS event_title,
            CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER) AS event_year,
            re.discipline_id,
            ed.name AS discipline_name,
            re.placement
        FROM event_result_entries re
        JOIN event_disciplines ed ON ed.id = re.discipline_id
        JOIN events e ON e.id = re.event_id
        WHERE ed.discipline_category = 'freestyle'
          AND ed.team_type = 'doubles'
          AND ed.id IN ({})
    """.format(",".join(f"'{d}'" for d in disc_ids))).fetchall()

    # Load participants for these entries
    entry_ids = {e["entry_id"] for e in entries}
    participants = conn.execute("""
        SELECT p.result_entry_id, p.participant_order,
               p.display_name, p.historical_person_id,
               hp.person_name AS canonical_name
        FROM event_result_entry_participants p
        LEFT JOIN historical_persons hp ON hp.person_id = p.historical_person_id
        WHERE p.result_entry_id IN ({})
        ORDER BY p.result_entry_id, p.participant_order
    """.format(",".join(f"'{eid}'" for eid in entry_ids))).fetchall()

    parts_by_entry = defaultdict(list)
    for p in participants:
        parts_by_entry[p["result_entry_id"]].append(p)

    # ── Step 3: Audit data quality ──────────────────────────────────────
    broken_lt2 = []
    broken_gt2 = []
    missing_pid = []
    duplicate_in_pair = []

    for entry in entries:
        eid = entry["entry_id"]
        ps = parts_by_entry.get(eid, [])
        if len(ps) < 2:
            broken_lt2.append((entry, ps))
        elif len(ps) > 2:
            broken_gt2.append((entry, ps))
        else:
            pids = [p["historical_person_id"] for p in ps if p["historical_person_id"]]
            if len(pids) < 2:
                missing_pid.append((entry, ps))
            elif pids[0] == pids[1]:
                duplicate_in_pair.append((entry, ps))

    # ── Step 4: Build canonical partnerships ────────────────────────────
    partnerships = defaultdict(lambda: {
        "name_a": "", "name_b": "",
        "appearances": 0, "wins": 0, "podiums": 0,
        "years": set(), "event_ids": [],
    })

    events_out = []
    skipped_no_pid = 0

    for entry in entries:
        eid = entry["entry_id"]
        ps = parts_by_entry.get(eid, [])
        if len(ps) != 2:
            continue
        pid_a = ps[0]["historical_person_id"]
        pid_b = ps[1]["historical_person_id"]
        if not pid_a or not pid_b:
            skipped_no_pid += 1
            continue

        # Canonical ordering: min/max for stable key
        if pid_a > pid_b:
            pid_a, pid_b = pid_b, pid_a
            ps = [ps[1], ps[0]]

        key = (pid_a, pid_b)
        p = partnerships[key]
        p["name_a"] = ps[0]["canonical_name"] or ps[0]["display_name"]
        p["name_b"] = ps[1]["canonical_name"] or ps[1]["display_name"]
        p["appearances"] += 1
        placement = entry["placement"]
        if placement == 1:
            p["wins"] += 1
        if placement <= 3:
            p["podiums"] += 1
        yr = entry["event_year"]
        if yr:
            p["years"].add(yr)
        p["event_ids"].append(entry["event_id"])

        events_out.append({
            "partner_a_id": pid_a,
            "partner_a_name": p["name_a"],
            "partner_b_id": pid_b,
            "partner_b_name": p["name_b"],
            "event_id": entry["event_id"],
            "event_title": entry["event_title"],
            "event_year": yr,
            "discipline_name": entry["discipline_name"],
            "placement": placement,
        })

    conn.close()

    # ── Step 5: Write outputs ───────────────────────────────────────────
    summary_rows = []
    for (pid_a, pid_b), p in sorted(
        partnerships.items(), key=lambda kv: -kv[1]["appearances"]
    ):
        years = sorted(p["years"])
        summary_rows.append({
            "partner_a_id": pid_a,
            "partner_a_name": p["name_a"],
            "partner_b_id": pid_b,
            "partner_b_name": p["name_b"],
            "appearances": p["appearances"],
            "wins": p["wins"],
            "podiums": p["podiums"],
            "first_year": years[0] if years else "",
            "last_year": years[-1] if years else "",
            "year_span": (years[-1] - years[0]) if len(years) > 1 else 0,
        })

    # Summary CSV
    with open(OUT / "freestyle_partnerships_summary.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "partner_a_id", "partner_a_name", "partner_b_id", "partner_b_name",
            "appearances", "wins", "podiums", "first_year", "last_year", "year_span",
        ])
        writer.writeheader()
        writer.writerows(summary_rows)

    # Events CSV
    events_out.sort(key=lambda r: (r["partner_a_name"], r["partner_b_name"], r["event_year"]))
    with open(OUT / "freestyle_partnerships_events.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "partner_a_id", "partner_a_name", "partner_b_id", "partner_b_name",
            "event_id", "event_title", "event_year", "discipline_name", "placement",
        ])
        writer.writeheader()
        writer.writerows(events_out)

    # ── Audit report ────────────────────────────────────────────────────
    sep = "=" * 72
    print(sep)
    print("  FREESTYLE DOUBLES PARTNERSHIP AUDIT")
    print(sep)
    print()

    print("A. DISCIPLINE FILTER")
    print("-" * 40)
    print(f"  Total freestyle doubles disciplines: {len(all_discs)}")
    print(f"  Included (routine/team):             {len(included)}")
    print(f"  Excluded (trick/shred/circle):       {len(excluded)}")
    print()
    if excluded:
        exc_names = sorted(set(d["name"] for d in excluded))
        print("  Excluded discipline names:")
        for n in exc_names:
            print(f"    - {n}")
    print()

    print("B. DATA QUALITY")
    print("-" * 40)
    print(f"  Total entries (included disciplines): {len(entries)}")
    print(f"  Entries with <2 participants:         {len(broken_lt2)}")
    print(f"  Entries with >2 participants:         {len(broken_gt2)}")
    print(f"  Missing person_id:                   {len(missing_pid)}")
    print(f"  Duplicate person in pair:            {len(duplicate_in_pair)}")
    print(f"  Skipped (no pid for partner):        {skipped_no_pid}")
    print()

    if missing_pid:
        print("  Missing-pid examples:")
        for entry, ps in missing_pid[:5]:
            names = [p["display_name"] for p in ps]
            print(f"    {entry['event_title']} ({entry['event_year']}) P{entry['placement']}: {' / '.join(names)}")
        print()

    print("C. PARTNERSHIP SUMMARY")
    print("-" * 40)
    print(f"  Unique partnerships:  {len(partnerships)}")
    print(f"  Total appearances:    {sum(p['appearances'] for p in partnerships.values())}")
    print(f"  Total wins:           {sum(p['wins'] for p in partnerships.values())}")
    print(f"  Total podiums:        {sum(p['podiums'] for p in partnerships.values())}")
    print()

    print("D. TOP PARTNERSHIPS BY APPEARANCES")
    print("-" * 40)
    for r in summary_rows[:10]:
        yr = f"{r['first_year']}–{r['last_year']}" if r["first_year"] != r["last_year"] else str(r["first_year"])
        print(f"  ({r['appearances']:>2} apps, {r['wins']:>2} wins, {r['podiums']:>2} pod) "
              f"{r['partner_a_name']} / {r['partner_b_name']}  [{yr}]")
    print()

    top_wins = sorted(summary_rows, key=lambda r: (-r["wins"], -r["podiums"]))
    print("E. TOP PARTNERSHIPS BY WINS")
    print("-" * 40)
    for r in top_wins[:10]:
        yr = f"{r['first_year']}–{r['last_year']}" if r["first_year"] != r["last_year"] else str(r["first_year"])
        print(f"  ({r['wins']:>2} wins, {r['appearances']:>2} apps) "
              f"{r['partner_a_name']} / {r['partner_b_name']}  [{yr}]")
    print()

    top_span = sorted(summary_rows, key=lambda r: (-r["year_span"], -r["appearances"]))
    print("F. LONGEST-RUNNING PARTNERSHIPS")
    print("-" * 40)
    for r in top_span[:10]:
        yr = f"{r['first_year']}–{r['last_year']}" if r["first_year"] != r["last_year"] else str(r["first_year"])
        print(f"  ({r['year_span']:>2} yr span, {r['appearances']:>2} apps) "
              f"{r['partner_a_name']} / {r['partner_b_name']}  [{yr}]")

    print()
    print(sep)
    print(f"  Outputs written:")
    print(f"    {OUT / 'freestyle_partnerships_summary.csv'}")
    print(f"    {OUT / 'freestyle_partnerships_events.csv'}")
    print(sep)


if __name__ == "__main__":
    main()
