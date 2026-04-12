"""
pipeline/05p5_remediate_canonical.py
Stage 05p5 — Canonical CSV Remediation

Runs immediately after stage 05 (05_export_canonical_csv.py) and applies
five logic fixes to the canonical CSV set before downstream consumption.

Fixes (in order):
  0. Discipline Fix Registry — apply declarative corrections from
                            inputs/canonical_discipline_fixes.csv.  Inactive rows
                            (active ≠ '1') are logged and skipped.  Runs BEFORE
                            Fix 3 and Fix 5 so downstream fixes see corrected data.
                            Supports four fix_types:
                              rename_discipline         — update discipline_name
                              retag_team_type           — update team_type
                              rename_and_retag          — both
                              reshape_doubles_to_singles— structural repair: pick
                                one winner per placement using person_id preference;
                                requires 100% resolution + no duplicate person_ids;
                                emits audit CSV to out/audit/
  1. Identity Sync        — overwrite display_name from persons.csv when person_id present
  2. Regex Deep-Clean     — strip ordinals, scores, parentheticals for unresolved rows
  3. Singles Density Check— remap doubles→singles when participant density = 1.0
                            unless the discipline appears in keep_doubles_overrides.csv
  4. (removed)            — was "force participant_order=1 for singles"; stage 05 now
                            emits sequential participant_order for all disciplines, making
                            (event_key, discipline_key, placement, participant_order) unique
  5. Ghost Partnering     — for doubles disciplines still missing a partner slot,
                            insert __UNKNOWN_PARTNER__ at participant_order=2
  6. Sequential Placement Normalization (doubles only) — for doubles disciplines where a
                            placement slot has ≠2 participants, regroup consecutive
                            participants into sequential paired slots and ghost-partner
                            any remainder.  Singles ties (multiple participants at the
                            same placement number) are source-accurate and preserved as-is.
  7. Duplicate person_id dedup — removes a second occurrence of the same person_id
                            within a (event_key, discipline_key, placement) slot.
                            Runs after all person_id resolution (Fix 7, Fix 8) so that
                            stub rows resolved by name-lookup are also caught.  Caused
                            by PBP emitting both a __NON_PERSON__ team-expansion row
                            and a direct stub row for the same person.

Keep-doubles override:
  Create inputs/keep_doubles_overrides.csv with columns event_key, discipline_key
  to prevent specific disciplines from being remapped to singles even at density 1.0.
  These will instead receive a ghost __UNKNOWN_PARTNER__ partner row.

Coverage-flag override:
  Create overrides/coverage_flag_overrides.csv with columns event_key, discipline_key,
  coverage_flag_override to correct a misclassified coverage_flag on a specific discipline
  before the canonical CSVs are consumed downstream.  Applied immediately after load,
  before any other fix.

Worlds normalization (year >= 1985):
  All events identified as the official World Footbag Championships have their
  event_name set to "{Nth} Annual World Footbag Championships" (N = year - 1979)
  and event_type set to "worlds".  Detection: event_type already == "worlds", OR
  "_worlds" in event_key AND event_name contains a championship-signal substring.

Pre-1985 Worlds corrections (explicit event_key table):
  1980–1984 had three competing organisations (NHSA, WFA, IFAB, FBW) each running
  parallel "World Championships" — a formula cannot apply.  Instead an explicit
  _PRE_1985_WORLDS_NAMES dict sets canonical names and event_type="worlds" for all
  19 worlds-family event_keys.  Companion tables handle:
    - Clearing org tags stored in the country field (NHSA/WFA events)
    - Fixing location fields (city/region/country) for NHSA/WFA and early FBW events
      (1980–1982 NHSA → Oregon City OR; 1983 NHSA/WFA → Boulder CO;
       1984 WFA → Golden CO; FBW Golden track: country→region)

Input/output: out/canonical/ (repo-relative)
"""

import csv
import datetime
import re
import sys
from collections import defaultdict
from pathlib import Path

# Shared heuristic for reshape_doubles_to_singles (see discipline_repair.py)
sys.path.insert(0, str(Path(__file__).parent))
from discipline_repair import reshape_discipline, REPAIR_THRESHOLD

ROOT      = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "out" / "canonical"
OVERRIDES = ROOT / "inputs" / "keep_doubles_overrides.csv"
COVERAGE_FLAG_OVERRIDES = ROOT / "overrides" / "coverage_flag_overrides.csv"
DISCIPLINE_FIXES = ROOT / "inputs" / "canonical_discipline_fixes.csv"

csv.field_size_limit(10 * 1024 * 1024)

TARGET_EVENT = "1997_eugene_celebration"
TARGET_DIV = "Doubles Golf"

VALID_TEAMS = {
    "Jim Fitzgerald / Jack Schoolcraft",
    "Jeff Johnson / Steve Dusablon",
    "Becca English-Ross / Dave Bernard",
    "Brent Welch / Brandon Crum",
    "Aaron Gregg / Bobby Heiney",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def load(name: str) -> tuple[list[dict], list[str]]:
    path = CANONICAL / name
    with open(path, newline="", encoding="utf-8") as f:
        dr = csv.DictReader(f)
        rows = list(dr)
        return rows, list(dr.fieldnames)


def save(name: str, rows: list[dict], fieldnames: list[str]) -> None:
    CANONICAL.mkdir(parents=True, exist_ok=True)
    with open(CANONICAL / name, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  Saved {name} ({len(rows):,} rows)")


# ── Worlds naming/type helpers ────────────────────────────────────────────────

def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return f"{n}th"
    suffix = ["th", "st", "nd", "rd"] + ["th"] * 6
    return f"{n}{suffix[n % 10]}"


def _worlds_canonical_name(year: int) -> str:
    return f"{_ordinal(year - 1979)} Annual World Footbag Championships"


# Signals that confirm the event is the official championships (not a warm-up,
# record attempt, or other event that happens to carry "worlds" in the key).
_WORLDS_NAME_SIGNALS = frozenset([
    "world footbag", "world championship", "wfa world",
    "ifab world", "nhsa world", "ifpa world",
])


def _is_worlds_event(ev: dict) -> bool:
    """Return True for official World Footbag Championships events (year >= 1985)."""
    try:
        year = int(ev.get("year", "") or 0)
    except ValueError:
        return False
    if year < 1985:
        return False
    # Already typed as worlds by a human-reviewed source — accept unconditionally.
    if ev.get("event_type", "") == "worlds":
        return True
    # Must carry "_worlds" in the key and a championship signal in the name.
    ek = ev.get("event_key", "").lower()
    if "_worlds" not in ek:
        return False
    name_lower = ev.get("event_name", "").lower()
    return any(sig in name_lower for sig in _WORLDS_NAME_SIGNALS)


# ── Load ──────────────────────────────────────────────────────────────────────

print("Stage 05p5: Canonical CSV Remediation")
print(f"  Source: {CANONICAL}\n")

events,       fields_events       = load("events.csv")
disciplines,  fields_disciplines  = load("event_disciplines.csv")
results,      fields_results      = load("event_results.csv")
participants, fields_participants = load("event_result_participants.csv")
persons,      fields_persons      = load("persons.csv")

print(f"  Loaded: {len(events)} events, {len(disciplines)} disciplines, "
      f"{len(results)} results, {len(participants)} participants, "
      f"{len(persons)} persons")

# Load keep-doubles overrides (optional)
keep_doubles: set[tuple[str, str]] = set()
if OVERRIDES.exists():
    with open(OVERRIDES, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            keep_doubles.add((row["event_key"].strip(), row["discipline_key"].strip()))
    print(f"  Keep-doubles overrides: {len(keep_doubles)} discipline(s)")
else:
    print(f"  Keep-doubles overrides: none (create {OVERRIDES.name} to add)")

# Load coverage_flag overrides (optional)
# Matches on (event_key, discipline_key) and overwrites coverage_flag in event_disciplines.
coverage_flag_overrides: dict[tuple[str, str], str] = {}
if COVERAGE_FLAG_OVERRIDES.exists():
    with open(COVERAGE_FLAG_OVERRIDES, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            k = (row["event_key"].strip(), row["discipline_key"].strip())
            coverage_flag_overrides[k] = row["coverage_flag_override"].strip()
    print(f"  Coverage-flag overrides: {len(coverage_flag_overrides)} discipline(s)")
else:
    print(f"  Coverage-flag overrides: none (create {COVERAGE_FLAG_OVERRIDES.name} to add)")

# Load canonical discipline fixes (optional).
# fix_type options and behavior:
#   rename_discipline         — update discipline_name only
#   retag_team_type           — update team_type only; doubles→singles removes ghost rows
#   rename_and_retag          — both of the above
#   reshape_doubles_to_singles— structural repair: doubles-shaped participant rows
#                               are analyzed per-placement and reduced to one winner
#                               each; requires 100% resolution confidence and no
#                               duplicate person_ids before it will apply
# Only rows with active='1' are applied.  Inactive rows are logged but skipped.
_VALID_FIX_TYPES  = {
    "rename_discipline",
    "retag_team_type",
    "rename_and_retag",
    "reshape_doubles_to_singles",   # structural repair: doubles-shaped → true singles
}
_VALID_TEAM_TYPES = {"singles", "doubles"}
discipline_fixes: list[dict] = []
if DISCIPLINE_FIXES.exists():
    _seen_disc_fix_keys: set[tuple[str, str]] = set()
    with open(DISCIPLINE_FIXES, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            ek  = row["event_key"].strip()
            dk  = row["discipline_key"].strip()
            ft  = row["fix_type"].strip()
            act = row["active"].strip()
            if not ek or not dk:
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"event_key and discipline_key are required")
            if ft not in _VALID_FIX_TYPES:
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"invalid fix_type '{ft}' — must be one of {_VALID_FIX_TYPES}")
            if (ek, dk) in _seen_disc_fix_keys:
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"duplicate entry for ({ek}, {dk})")
            _seen_disc_fix_keys.add((ek, dk))
            new_name = row.get("new_name", "").strip()
            new_tt   = row.get("new_team_type", "").strip()
            if ft in {"rename_discipline", "rename_and_retag"} and not new_name:
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"fix_type '{ft}' requires new_name")
            if ft in {"retag_team_type", "rename_and_retag"} and not new_tt:
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"fix_type '{ft}' requires new_team_type")
            if new_tt and new_tt not in _VALID_TEAM_TYPES:
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"invalid new_team_type '{new_tt}' — must be 'singles' or 'doubles'")
            # reshape_doubles_to_singles: new_team_type defaults to 'singles' if not set;
            # original_team_type=doubles is required (validated at application time).
            if ft == "reshape_doubles_to_singles" and new_tt and new_tt != "singles":
                raise SystemExit(f"canonical_discipline_fixes.csv line {lineno}: "
                                 f"reshape_doubles_to_singles requires new_team_type='singles' "
                                 f"(got '{new_tt}')")
            if ft == "reshape_doubles_to_singles" and not new_tt:
                new_tt = "singles"  # default
            discipline_fixes.append({**row,
                                      "event_key": ek, "discipline_key": dk,
                                      "fix_type": ft, "active": act,
                                      "new_name": new_name, "new_team_type": new_tt})
    active_count   = sum(1 for r in discipline_fixes if r["active"] == "1")
    inactive_count = len(discipline_fixes) - active_count
    print(f"  Discipline fixes: {len(discipline_fixes)} total  "
          f"({active_count} active, {inactive_count} inactive)")
else:
    print(f"  Discipline fixes: none (create {DISCIPLINE_FIXES.name} to add)")

_coverage_patched = 0
for row in disciplines:
    k = (row["event_key"], row["discipline_key"])
    if k in coverage_flag_overrides:
        old_flag = row.get("coverage_flag", "")
        new_flag = coverage_flag_overrides[k]
        row["coverage_flag"] = new_flag
        print(f"  Coverage-flag override: {k[0]} / {k[1]}  {old_flag!r} → {new_flag!r}")
        _coverage_patched += 1

if _coverage_patched:
    print(f"  Coverage-flag rows patched: {_coverage_patched}")

# ── Worlds event name / type normalization ────────────────────────────────────
# For all events year >= 1985 that are identified as the official World Footbag
# Championships, enforce:
#   event_name  → "{Nth} Annual World Footbag Championships"  (N = year - 1979)
#   event_type  → "worlds"
# 1980–1984 events are left untouched (fragmented / duplicate entries require
# separate human-reviewed merge work).

print("\n[Worlds normalization] Applying canonical name/type to Worlds events...")

_worlds_changes: list[dict] = []
for ev in events:
    if not _is_worlds_event(ev):
        continue
    year = int(ev["year"])
    new_name = _worlds_canonical_name(year)
    old_name = ev["event_name"]
    old_type = ev["event_type"]
    name_changed = old_name != new_name
    type_changed = old_type != "worlds"
    if name_changed or type_changed:
        _worlds_changes.append({
            "year":      year,
            "event_key": ev["event_key"],
            "old_name":  old_name,
            "new_name":  new_name,
            "old_type":  old_type,
            "new_type":  "worlds",
        })
        ev["event_name"] = new_name
        ev["event_type"] = "worlds"

if _worlds_changes:
    _worlds_changes.sort(key=lambda r: (r["year"], r["event_key"]))
    print(f"\n  {'year':>4}  {'event_key':<45}  {'old_type':<10}  {'new_type':<8}  old_name  →  new_name")
    print(f"  {'-'*4}  {'-'*45}  {'-'*10}  {'-'*8}  {'-'*30}")
    for ch in _worlds_changes:
        print(f"  {ch['year']:>4}  {ch['event_key']:<45}  {ch['old_type']:<10}  {ch['new_type']:<8}  "
              f"{ch['old_name']!r}  →  {ch['new_name']!r}")
    print(f"\n  Total worlds events changed: {len(_worlds_changes)}")
else:
    print("  No changes — all worlds events already normalized.")

# ── Pre-1985 Worlds: type / name / location corrections ──────────────────────
# Explicit event_key–keyed corrections for the 1980–1984 Worlds-family era.
# Post-1984 normalization uses a formula ("Nth Annual …").  Pre-1985 cannot —
# three competing organisations (NHSA, WFA, IFAB, FBW) each ran parallel
# "World Championships" in the same years.  All entries below are human-
# reviewed; no heuristics.
#
# Naming convention applied:  {YYYY} World Footbag Championships ({ORG})
# National-championship variants keep their existing style but receive
# event_type = "worlds" so they are filterable as worlds-family events.
#
# Duplicate-merge candidates (e.g. 1982_worlds vs 1982_nhsa_national) are
# intentionally left as separate keys — merging requires result-row
# deduplication and is flagged for future review.

_PRE_1985_WORLDS_NAMES: dict[str, str] = {
    # ── NHSA track (de-facto world championships 1980–1983) ───────────────────
    "1980_worlds":               "1980 World Footbag Championships (NHSA)",
    "1981_worlds":               "1981 World Footbag Championships (NHSA)",
    "1982_worlds":               "1982 World Footbag Championships (NHSA)",
    "1983_worlds":               "1983 World Footbag Championships (NHSA)",
    # NHSA national championships (worlds-family; possible dup of above pair)
    "1982_nhsa_national":        "1982 NHSA National Championships",
    "1983_nhsa_national":        "1983 NHSA National Championships",
    # ── WFA track (NHSA successor, 1983–1984) ─────────────────────────────────
    "1983_worlds_2":             "1983 World Footbag Championships (WFA)",
    "1984_worlds":               "1984 World Footbag Championships (WFA)",
    # WFA national championships (worlds-family; possible dup of above pair)
    "1983_national":             "1983 WFA National Championships",
    "1984_national":             "1984 WFA National Championships",
    # ── IFAB track (parallel eastern championships) ────────────────────────────
    "1980_worlds_memphis":       "1980 World Footbag Championships (IFAB)",
    "1981_worlds_san_dimas":     "1981 World Footbag Championships (IFAB/FBW)",
    "1982_worlds_portland":      "1982 World Footbag Championships (IFAB/FBW)",
    "1982_worlds_san_francisco": "1982 World Footbag Championships (IFAB)",
    "1983_worlds_oregon_city":   "1983 World Footbag Championships (IFAB)",
    "1984_worlds_oregon_city":   "1984 World Footbag Championships (IFAB)",
    # ── FBW/Golden freestyle track ────────────────────────────────────────────
    "1982_worlds_golden":        "1982 World Footbag Championships (FBW)",
    "1983_worlds_golden":        "1983 World Footbag Championships (FBW)",
    "1984_worlds_golden":        "1984 World Footbag Championships (FBW)",
}

# country field holds an org tag instead of a real location for these events.
# Clear it — the org is already visible in the event_name.
_PRE_1985_CLEAR_ORG_FROM_COUNTRY: set[str] = {
    "1980_worlds",
    "1981_worlds",
    "1982_worlds",
    "1983_worlds",
    "1983_worlds_2",
}

# Explicit location corrections keyed by event_key.
# FBW Golden track: Colorado was stored in the country field instead of region.
# 1983 NHSA/WFA events: source-backed Boulder, CO (2026-04 reconciliation).
# 1984 WFA events: source-backed Golden, CO (same reconciliation; previously wrong Boulder).
_PRE_1985_LOCATION_FIXES: dict[str, dict[str, str]] = {
    # ── FBW Golden track ──────────────────────────────────────────────────────
    "1982_worlds_golden": {"city": "Golden",  "region": "Colorado", "country": "United States"},
    "1983_worlds_golden": {"city": "Golden",  "region": "Colorado", "country": "United States"},
    "1984_worlds_golden": {"city": "Golden",  "region": "Colorado", "country": "United States"},
    # ── 1980–1982 NHSA events → Oregon City, OR (NHSA home base) ─────────────
    "1980_worlds":        {"city": "Oregon City", "region": "Oregon",    "country": "United States"},
    "1981_worlds":        {"city": "Oregon City", "region": "Oregon",    "country": "United States"},
    "1982_worlds":        {"city": "Oregon City", "region": "Oregon",    "country": "United States"},
    "1982_nhsa_national": {"city": "Oregon City", "region": "Oregon",    "country": "United States"},
    # ── 1983 NHSA/WFA events → Boulder, CO ────────────────────────────────────
    "1983_worlds":        {"city": "Boulder", "region": "Colorado", "country": "United States"},
    "1983_nhsa_national": {"city": "Boulder", "region": "Colorado", "country": "United States"},
    "1983_worlds_2":      {"city": "Boulder", "region": "Colorado", "country": "United States"},
    "1983_national":      {"city": "Boulder", "region": "Colorado", "country": "United States"},
    # ── 1984 WFA events → Golden, CO (not Boulder) ────────────────────────────
    "1984_worlds":        {"city": "Golden",  "region": "Colorado", "country": "United States"},
    "1984_national":      {"city": "Golden",  "region": "Colorado", "country": "United States"},
}

print("\n[Pre-1985 Worlds] Applying event_type / name / location corrections...")

_pre85_changes: list[dict] = []

for ev in events:
    ek = ev.get("event_key", "")
    if ek not in _PRE_1985_WORLDS_NAMES:
        continue

    old_type = ev.get("event_type", "")
    old_name = ev.get("event_name", "")
    new_name = _PRE_1985_WORLDS_NAMES[ek]
    detail: list[str] = []

    # 1. Enforce event_type = "worlds"
    if old_type != "worlds":
        ev["event_type"] = "worlds"
        detail.append(f"type  {old_type!r} → 'worlds'")

    # 2. Apply canonical name
    if old_name != new_name:
        ev["event_name"] = new_name
        detail.append(f"name  {old_name!r} → {new_name!r}")

    # 3. Clear org-tag stored in country field
    if ek in _PRE_1985_CLEAR_ORG_FROM_COUNTRY:
        cur_country = ev.get("country", "")
        if cur_country in ("NHSA", "WFA"):
            ev["country"] = ""
            detail.append(f"country cleared ({cur_country!r})")

    # 4. Apply location fix
    if ek in _PRE_1985_LOCATION_FIXES:
        for field, new_val in _PRE_1985_LOCATION_FIXES[ek].items():
            old_val = ev.get(field, "")
            if old_val != new_val:
                ev[field] = new_val
                detail.append(f"{field}  {old_val!r} → {new_val!r}")

    if detail:
        _pre85_changes.append({"event_key": ek, "detail": detail})

if _pre85_changes:
    _pre85_changes.sort(key=lambda r: r["event_key"])
    print(f"\n  {'event_key':<40}  detail")
    print(f"  {'-'*40}  {'-'*55}")
    for ch in _pre85_changes:
        for i, line in enumerate(ch["detail"]):
            label = ch["event_key"] if i == 0 else ""
            print(f"  {label:<40}  {line}")
    print(f"\n  Pre-1985 worlds events updated: {len(_pre85_changes)} of {len(_PRE_1985_WORLDS_NAMES)}")
else:
    print("  No changes — pre-1985 worlds events already normalized.")

# ── Post-1984 standalone event fixes ──────────────────────────────────────────
# Location and display-name corrections for events not in _PRE_1985_WORLDS_NAMES.
# 1985–1990 Worlds were held in Golden, CO (FBW/WFA).
# 1991 onwards the Worlds rotated to international host cities.
# Source: events_normalized.csv (mirror-era records); "Golden CO" country-field
# format is the same parsing artifact as 1985_worlds.
# 1988 confirmed Golden by series pattern (1986–1990 all Golden, no contrary source).
# 1993 confirmed Golden by user (source TXT blank; events_normalized has no entry).

_1985_EVENT_FIXES: dict[str, dict[str, str]] = {
    # ── 1985 ──────────────────────────────────────────────────────────────────
    "1985_worlds": {
        "city":    "Golden",
        "region":  "Colorado",
        "country": "United States",
    },
    "1985_western_national_indoor": {
        "event_name": "Oak Park \u2014 Chicago Open",
        "city":       "Chicago",
        "region":     "Illinois",
        "country":    "United States",
    },
    # ── 1986–1990 Worlds → Golden, CO ("Golden CO" stored in country field) ───
    "1986_worlds": {"city": "Golden",        "region": "Colorado",          "country": "United States"},
    "1987_worlds": {"city": "Golden",        "region": "Colorado",          "country": "United States"},
    "1988_worlds": {"city": "Golden",        "region": "Colorado",          "country": "United States"},
    "1989_worlds": {"city": "Golden",        "region": "Colorado",          "country": "United States"},
    "1990_worlds": {"city": "Golden",        "region": "Colorado",          "country": "United States"},
    # ── 1991–1995 Worlds → rotating host cities ───────────────────────────────
    "1991_worlds": {"city": "Vancouver",     "region": "British Columbia",  "country": "Canada"},
    "1992_worlds": {"city": "Montreal",      "region": "Quebec",            "country": "Canada"},
    "1993_worlds": {"city": "Golden",        "region": "Colorado",          "country": "United States"},
    "1994_worlds": {"city": "San Francisco", "region": "California",        "country": "United States"},
    "1995_worlds": {"city": "Menlo Park",    "region": "California",        "country": "United States"},
}

print("\n[1985 Standalone] Applying event name / location fixes...")

_1985_changes: list[dict] = []

for ev in events:
    ek = ev.get("event_key", "")
    if ek not in _1985_EVENT_FIXES:
        continue
    fix = _1985_EVENT_FIXES[ek]
    detail: list[str] = []
    for field, new_val in fix.items():
        old_val = ev.get(field, "")
        if old_val != new_val:
            ev[field] = new_val
            detail.append(f"{field}  {old_val!r} → {new_val!r}")
    if detail:
        _1985_changes.append({"event_key": ek, "detail": detail})

if _1985_changes:
    _1985_changes.sort(key=lambda r: r["event_key"])
    print(f"\n  {'event_key':<40}  detail")
    print(f"  {'-'*40}  {'-'*55}")
    for ch in _1985_changes:
        for i, line in enumerate(ch["detail"]):
            label = ch["event_key"] if i == 0 else ""
            print(f"  {label:<40}  {line}")
    print(f"\n  1985 standalone events updated: {len(_1985_changes)}")
else:
    print("  No changes — 1985 standalone events already normalized.")

# ── Fix 0: Canonical Discipline Fix Registry ──────────────────────────────────
# Applies declarative name / team_type corrections for known discipline integrity
# errors.  Runs BEFORE Fix 3 (singles density check) and Fix 5 (ghost partnering)
# so downstream fixes see corrected team_type.
#
# fix_type semantics:
#   rename_discipline  — update discipline_name only
#   retag_team_type    — update team_type only; if doubles→singles, remove ghost
#                        partner rows (notes='auto:ghost_partner') from participants
#   rename_and_retag   — both of the above
#
# Safety rules:
#   • Inactive rows (active ≠ '1') are logged and skipped.
#   • Discipline not found → skip with warning (event may have been renamed upstream).
#   • original_name mismatch  → skip with warning (upstream source may have changed).
#   • original_team_type mismatch → skip with warning.

print("\n[Fix 0] Applying canonical discipline fixes...")

# Build fast lookup: (event_key, discipline_key) → discipline row
_disc_index: dict[tuple[str, str], dict] = {
    (d["event_key"], d["discipline_key"]): d for d in disciplines
}

_f0_applied           = 0
_f0_skipped           = 0
_f0_ghost_removed     = 0
_f0_reshape_removed   = 0   # participant rows replaced by reshape repair


def _emit_reshape_audit(fix_ek: str, fix_dk: str, reshape_result: dict) -> None:
    """Write a CSV audit record for a reshape_doubles_to_singles application."""
    audit_dir = ROOT / "out" / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    audit_path = audit_dir / f"disc_repair_{fix_ek}_{fix_dk}_{ts}.csv"
    fieldnames = [
        "event_key", "discipline_key", "placement",
        "outcome",           # resolved | ambiguous | unresolvable
        "winner_name", "winner_person_id", "winner_order",
        "discarded_name", "discarded_person_id", "discarded_order",
        "reason",
    ]
    with open(audit_path, "w", newline="", encoding="utf-8") as af:
        w = csv.DictWriter(af, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for pl, winner, discarded, reason in reshape_result["resolved"]:
            w.writerow({
                "event_key": fix_ek, "discipline_key": fix_dk,
                "placement": pl, "outcome": "resolved",
                "winner_name":       (winner.get("display_name", "") if winner else ""),
                "winner_person_id":  (winner.get("person_id", "") if winner else ""),
                "winner_order":      (winner.get("participant_order", "") if winner else ""),
                "discarded_name":    (discarded.get("display_name", "") if discarded else ""),
                "discarded_person_id": (discarded.get("person_id", "") if discarded else ""),
                "discarded_order":   (discarded.get("participant_order", "") if discarded else ""),
                "reason": reason,
            })
        for pl, reason in reshape_result["ambiguous"]:
            w.writerow({"event_key": fix_ek, "discipline_key": fix_dk,
                        "placement": pl, "outcome": "ambiguous", "reason": reason})
        for pl, reason in reshape_result["unresolvable"]:
            w.writerow({"event_key": fix_ek, "discipline_key": fix_dk,
                        "placement": pl, "outcome": "unresolvable", "reason": reason})
    print(f"    audit written: {audit_path.relative_to(ROOT)}")


for fix in discipline_fixes:
    ek, dk    = fix["event_key"], fix["discipline_key"]
    ft        = fix["fix_type"]
    active    = fix["active"] == "1"
    orig_name = fix.get("original_name", "").strip()
    orig_tt   = fix.get("original_team_type", "").strip()
    new_name  = fix["new_name"]
    new_tt    = fix["new_team_type"]

    if not active:
        print(f"  SKIP (inactive)  ({ek}, {dk})  fix_type={ft}")
        _f0_skipped += 1
        continue

    disc = _disc_index.get((ek, dk))
    if disc is None:
        print(f"  WARN  ({ek}, {dk}) not found in event_disciplines — skipping")
        _f0_skipped += 1
        continue

    if orig_name and disc["discipline_name"] != orig_name:
        print(f"  WARN  ({ek}, {dk}) original_name mismatch: "
              f"expected '{orig_name}', found '{disc['discipline_name']}' — skipping")
        _f0_skipped += 1
        continue

    if orig_tt and disc["team_type"] != orig_tt:
        print(f"  WARN  ({ek}, {dk}) original_team_type mismatch: "
              f"expected '{orig_tt}', found '{disc['team_type']}' — skipping")
        _f0_skipped += 1
        continue

    old_name = disc["discipline_name"]
    old_tt   = disc["team_type"]

    # ── simple fixes: rename / retag ──────────────────────────────────────────
    if ft in {"rename_discipline", "retag_team_type", "rename_and_retag"}:
        doubles_to_singles = (ft in {"retag_team_type", "rename_and_retag"}
                              and old_tt == "doubles" and new_tt == "singles")
        if ft in {"rename_discipline", "rename_and_retag"}:
            disc["discipline_name"] = new_name
        if ft in {"retag_team_type", "rename_and_retag"}:
            disc["team_type"] = new_tt

        print(f"  APPLIED  ({ek}, {dk})  fix_type={ft}")
        if ft in {"rename_discipline", "rename_and_retag"}:
            print(f"    name:      '{old_name}' → '{new_name}'")
        if ft in {"retag_team_type", "rename_and_retag"}:
            print(f"    team_type: '{old_tt}' → '{new_tt}'")

        # Remove ghost partner rows for doubles→singles retag.
        if doubles_to_singles:
            before = len(participants)
            participants[:] = [
                p for p in participants
                if not (p["event_key"] == ek
                        and p["discipline_key"] == dk
                        and p.get("display_name") == "__UNKNOWN_PARTNER__"
                        and p.get("notes") == "auto:ghost_partner")
            ]
            removed = before - len(participants)
            _f0_ghost_removed += removed
            if removed:
                print(f"    ghost partners removed: {removed}")

        _f0_applied += 1
        continue

    # ── structural repair: reshape_doubles_to_singles ─────────────────────────
    if ft == "reshape_doubles_to_singles":
        disc_parts = [
            p for p in participants
            if p["event_key"] == ek and p["discipline_key"] == dk
        ]
        if not disc_parts:
            print(f"  WARN  ({ek}, {dk}) no participant rows found — skipping reshape")
            _f0_skipped += 1
            continue

        rr = reshape_discipline(disc_parts, threshold=REPAIR_THRESHOLD)

        if not rr["can_apply"]:
            reasons = []
            if not rr["passes_threshold"]:
                reasons.append(
                    f"resolution rate {rr['resolution_rate']:.0%} < "
                    f"{REPAIR_THRESHOLD:.0%} threshold"
                )
            if not rr["passes_duplicate_check"]:
                n_dup = len(rr["duplicate_person_placements"])
                reasons.append(f"{n_dup} duplicate person_id(s) in resolved winners")
            print(f"  SKIP  ({ek}, {dk}) reshape validation failed: "
                  f"{'; '.join(reasons)}")
            n = rr["total_placements"]
            print(f"    resolved {len(rr['resolved'])}/{n}  "
                  f"ambiguous {len(rr['ambiguous'])}  "
                  f"unresolvable {len(rr['unresolvable'])}")
            for pl, reason in rr["ambiguous"]:
                print(f"    ambiguous    P{pl}: {reason}")
            for pl, reason in rr["unresolvable"]:
                print(f"    unresolvable P{pl}: {reason}")
            for pid, pls in rr["duplicate_person_placements"]:
                print(f"    duplicate    pid={pid[:8]} at placements {pls}")
            _f0_skipped += 1
            continue

        # Validation passed — apply the repair
        disc["team_type"] = "singles"
        if new_name:
            disc["discipline_name"] = new_name

        # Build replacement participant rows: one winner per placement,
        # participant_order reset to "1" (canonical singles convention).
        replacement_rows = []
        for pl, winner, _, _ in sorted(rr["resolved"], key=lambda x: x[0]):
            new_row = dict(winner)
            new_row["participant_order"] = "1"
            replacement_rows.append(new_row)

        before = len(disc_parts)
        participants[:] = [
            p for p in participants
            if not (p["event_key"] == ek and p["discipline_key"] == dk)
        ] + replacement_rows
        _f0_reshape_removed += before - len(replacement_rows)

        print(f"  APPLIED  ({ek}, {dk})  fix_type={ft}")
        print(f"    team_type: '{old_tt}' → 'singles'")
        if new_name:
            print(f"    name:      '{old_name}' → '{new_name}'")
        print(f"    participants: {before} rows → {len(replacement_rows)} rows "
              f"({before - len(replacement_rows)} discarded)")

        _emit_reshape_audit(ek, dk, rr)
        _f0_applied += 1
        continue

    # Should never reach here — _VALID_FIX_TYPES check in load block guards this.
    raise SystemExit(f"[Fix 0] Unhandled fix_type: {ft!r}")

print(f"  Fixes applied: {_f0_applied}  skipped: {_f0_skipped}  "
      f"ghost rows removed: {_f0_ghost_removed}  "
      f"reshape rows removed: {_f0_reshape_removed}")

# ── Fix 1 & 2: Identity Sync + Regex Deep-Clean ───────────────────────────────

print("\n[Fix 1+2] Identity sync & regex cleaning...")

person_name_map = {r["person_id"]: r["person_name"] for r in persons}

_RE_DAY_PREFIX   = re.compile(r"^[A-Za-z]+:\s*\d+\.\s*")         # "Saturday: 1. "
_RE_SCORE_SUFFIX = re.compile(r"\s+\d+\.\d+.*$")                  # " 9.20 9.20 1"
_RE_ORDINAL      = re.compile(r"^\d+(?:st|nd|rd|th)?[.):\-]?\s+", re.IGNORECASE)
_RE_PAREN        = re.compile(r"\s*\([^)]*\)\s*$")
_RE_TIE_LABEL    = re.compile(r"\(tie\)", re.IGNORECASE)           # "(tie)" annotation
_RE_SPACES       = re.compile(r"\s{2,}")

def clean_unresolved(name: str) -> str:
    name = _RE_DAY_PREFIX.sub("", name)
    name = _RE_SCORE_SUFFIX.sub("", name)
    name = _RE_ORDINAL.sub("", name)
    name = _RE_TIE_LABEL.sub("", name)
    name = _RE_PAREN.sub("", name)
    name = _RE_SPACES.sub(" ", name).strip()
    return name

names_from_master  = 0
names_regex_cleaned = 0

for row in participants:
    pid = row.get("person_id", "")
    if pid and pid in person_name_map:
        canonical_name = person_name_map[pid]
        if row["display_name"] != canonical_name:
            row["display_name"] = canonical_name
            names_from_master += 1
    elif not pid:
        cleaned = clean_unresolved(row["display_name"])
        if not cleaned:
            # Cleaning stripped the entire name (e.g. "()" → "").
            # Use a meaningful sentinel rather than leaving blank.
            cleaned = "__UNKNOWN_PARTNER__"
        if cleaned != row["display_name"]:
            row["display_name"] = cleaned
            names_regex_cleaned += 1

print(f"  Overwritten from person master: {names_from_master:,}")
print(f"  Regex-cleaned (unresolved):     {names_regex_cleaned:,}")

# ── Fix 3: Singles Density Check ──────────────────────────────────────────────
# Doubles → singles when every placement slot has exactly 1 participant
# (density = 1.0), UNLESS the discipline is in the keep_doubles override set.

print("\n[Fix 3] Singles density check...")

# Count unique placements and total participants per (event_key, discipline_key)
placement_sets:   dict[tuple, set]  = defaultdict(set)
participant_count: dict[tuple, int] = defaultdict(int)

for row in participants:
    k = (row["event_key"], row["discipline_key"])
    placement_sets[k].add(row["placement"])
    participant_count[k] += 1

remapped   = 0
kept_double = 0

for row in disciplines:
    if row["team_type"] != "doubles":
        continue
    k = (row["event_key"], row["discipline_key"])
    n_placements = len(placement_sets.get(k, set()))
    n_participants = participant_count.get(k, 0)
    if n_placements == 0 or n_participants == 0:
        continue
    density = n_participants / n_placements
    if density != 1.0:
        continue

    if k in keep_doubles:
        # Keep as doubles; ghost partner inserted in Fix 5
        print(f"  KEEP doubles (override): {row['event_key']} / "
              f"{row['discipline_key']} ({row['discipline_name']})")
        kept_double += 1
    else:
        print(f"  WARN remap doubles→singles: {row['event_key']} / "
              f"{row['discipline_key']} ({row['discipline_name']}, "
              f"{n_placements} placements — partner data may be missing)")
        row["team_type"] = "singles"
        remapped += 1

print(f"  Remapped to singles: {remapped}")
print(f"  Kept doubles (override): {kept_double}")

# ── Fix 4: (removed) ──────────────────────────────────────────────────────────
# Stage 05 now emits sequential participant_order for all disciplines (singles
# and doubles alike), so (event_key, discipline_key, placement, participant_order)
# is always a unique key.  No post-processing needed here.

tie_fixes = 0  # keep variable for report formatting

# ── Fix 5: Ghost Partnering ───────────────────────────────────────────────────
# For doubles disciplines (including keep_doubles overrides) where a placement
# has only one participant, insert an __UNKNOWN_PARTNER__ row at order=2.

print("\n[Fix 5] Ghost partnering for doubles missing partner...")

doubles_keys = {
    (r["event_key"], r["discipline_key"])
    for r in disciplines
    if r["team_type"] == "doubles"
}

# Find placements that already have participant_order=2
has_partner: set[tuple] = set()
for row in participants:
    k = (row["event_key"], row["discipline_key"], row["placement"])
    if int(row["participant_order"]) == 2:
        has_partner.add(k)

ghost_rows = []
for row in participants:
    k = (row["event_key"], row["discipline_key"])
    slot = (row["event_key"], row["discipline_key"], row["placement"])
    if (k in doubles_keys
            and int(row["participant_order"]) == 1
            and slot not in has_partner):
        ghost_rows.append({
            "event_key":         row["event_key"],
            "discipline_key":    row["discipline_key"],
            "placement":         row["placement"],
            "participant_order": "2",
            "display_name":      "__UNKNOWN_PARTNER__",
            "person_id":         "",
            "notes":             "auto:ghost_partner",
        })
        has_partner.add(slot)  # prevent double-insertion

participants.extend(ghost_rows)

# Re-sort: (event_key, discipline_key, placement as int, participant_order as int)
participants.sort(key=lambda r: (
    r["event_key"],
    r["discipline_key"],
    int(r["placement"]) if r["placement"].isdigit() else 0,
    int(r["participant_order"]),
))

print(f"  Ghost rows inserted: {len(ghost_rows):,}")

# ── Targeted Team Remediation ─────────────────────────────────────────────────
# Keep only a known team whitelist for one specific event/division.

print("\n[Targeted remediation] Filtering invalid teams for specific event/division...")

target_discipline_keys = {
    row["discipline_key"]
    for row in disciplines
    if row["event_key"] == TARGET_EVENT and row.get("discipline_name") == TARGET_DIV
}

valid_slots: set[tuple[str, str, str]] = set()
if target_discipline_keys:
    names_by_slot_order: dict[tuple[str, str, str], dict[int, str]] = defaultdict(dict)
    for row in participants:
        event_key = row["event_key"]
        discipline_key = row["discipline_key"]
        if event_key != TARGET_EVENT or discipline_key not in target_discipline_keys:
            continue
        slot = (event_key, discipline_key, row["placement"])
        names_by_slot_order[slot][int(row["participant_order"])] = row["display_name"]

    for slot, order_map in names_by_slot_order.items():
        name_1 = order_map.get(1, "").strip()
        name_2 = order_map.get(2, "").strip()
        if not name_1 or not name_2:
            continue
        team_name = f"{name_1} / {name_2}"
        if team_name in VALID_TEAMS:
            valid_slots.add(slot)

before_results = len(results)
results = [
    row for row in results
    if (
        row["event_key"] != TARGET_EVENT
        or row["discipline_key"] not in target_discipline_keys
        or (row["event_key"], row["discipline_key"], row["placement"]) in valid_slots
    )
]

before_participants = len(participants)
participants = [
    row for row in participants
    if (
        row["event_key"] != TARGET_EVENT
        or row["discipline_key"] not in target_discipline_keys
        or (row["event_key"], row["discipline_key"], row["placement"]) in valid_slots
    )
]

print(f"  Target discipline keys: {len(target_discipline_keys):,}")
print(f"  Valid team slots kept:  {len(valid_slots):,}")
print(f"  Results removed:        {before_results - len(results):,}")
print(f"  Participants removed:   {before_participants - len(participants):,}")

# ── Fix 6: Sequential Placement Normalization (doubles only) ──────────────────
# For doubles disciplines where a placement slot has ≠2 participants, regroup
# all participants into consecutive pairs assigned sequential placements.
# Lone remainders receive a ghost __UNKNOWN_PARTNER__.
# Preserves original placement in notes as "seq_from:<N>" when changed.
#
# Singles disciplines are NOT renumbered here.  Multiple participants at the same
# placement number represent an explicit source tie (e.g. 5,5,5,8) and must be
# preserved exactly.  The QC gate treats such cases as warns, not hard failures.

print("\n[Fix 6] Sequential placement normalization...")

team_type_lookup = {
    (r["event_key"], r["discipline_key"]): r["team_type"]
    for r in disciplines
}

# Build slot → rows mapping
from collections import defaultdict as _dd

slots_map: dict = _dd(list)
for row in participants:
    k = (row["event_key"], row["discipline_key"], row["placement"])
    slots_map[k].append(row)

# Identify which (event, disc) have violations
disc_slots: dict = _dd(list)  # (ek, dk) → [(int_placement, rows)]
for (ek, dk, pl), rows in slots_map.items():
    disc_slots[(ek, dk)].append((int(pl), rows))

# Sort each discipline's slots by original placement
for k in disc_slots:
    disc_slots[k].sort(key=lambda x: x[0])

seq_normalized = 0
normalized_groups = 0
normalized_participants = 0
new_participants_6: list = []
new_results_map: dict = {}  # (ek, dk, pl_str) → result row

# Pre-populate result map from existing results
results_by_key: dict = {}
for r in results:
    results_by_key[(r["event_key"], r["discipline_key"], r["placement"])] = r

for (ek, dk), place_groups in disc_slots.items():
    tt = team_type_lookup.get((ek, dk), "singles")

    # Singles: multiple participants at the same placement = valid tie.  Never renumber.
    # Doubles: each slot must have exactly 2 participants; regroup if violated.
    if tt == "singles":
        has_violation = False
    else:
        has_violation = any(len(rows) != 2 for _, rows in place_groups)

    if not has_violation:
        # No change — copy all rows verbatim
        for _, rows in place_groups:
            for row in rows:
                rk = (row["event_key"], row["discipline_key"], row["placement"])
                new_participants_6.append(row)
                if rk not in new_results_map:
                    new_results_map[rk] = results_by_key.get(rk, {
                        "event_key": ek, "discipline_key": dk,
                        "placement": row["placement"],
                        "score_text": "", "notes": "", "source": "",
                    })
        continue

    # Only doubles disciplines reach here (singles always takes the no-violation path above).
    normalized_groups += 1
    normalized_participants += sum(len(rows) for _, rows in place_groups)

    # Collect all participants for this discipline in order
    all_rows: list = []
    for _, rows in place_groups:
        sorted_rows = sorted(rows, key=lambda r: int(r["participant_order"]))
        all_rows.extend(sorted_rows)

    if True:  # doubles
        # Group into teams of 2 (consecutive pairs), assign sequential placements
        next_place = 1
        i = 0
        while i < len(all_rows):
            pair = all_rows[i:i + 2]
            i += 2
            # If pair is short, pad with a ghost
            if len(pair) == 1:
                ghost = {
                    "event_key": ek, "discipline_key": dk,
                    "placement": str(next_place),
                    "participant_order": "2",
                    "display_name": "__UNKNOWN_PARTNER__",
                    "person_id": "", "notes": "auto:ghost_partner",
                }
                pair.append(ghost)
            orig = pair[0]["placement"]
            rk = (ek, dk, str(next_place))
            for order_idx, row in enumerate(pair, start=1):
                new_row = dict(row)
                new_row["placement"] = str(next_place)
                new_row["participant_order"] = str(order_idx)
                if orig != str(next_place):
                    note = f"seq_from:{orig}"
                    new_row["notes"] = (new_row["notes"] + ";" + note).lstrip(";")
                    seq_normalized += 1
                new_participants_6.append(new_row)
            if rk not in new_results_map:
                old_rk = (ek, dk, orig)
                base = results_by_key.get(old_rk, {
                    "event_key": ek, "discipline_key": dk, "placement": orig,
                    "score_text": "", "notes": "", "source": "",
                })
                new_result = dict(base)
                new_result["placement"] = str(next_place)
                new_results_map[rk] = new_result
            next_place += 1

participants = new_participants_6

# Rebuild results from normalized participants (one row per unique slot)
used_result_keys = {
    (r["event_key"], r["discipline_key"], r["placement"]) for r in participants
}
results = [v for k, v in new_results_map.items() if k in used_result_keys]

# Re-sort participants
participants.sort(key=lambda r: (
    r["event_key"],
    r["discipline_key"],
    int(r["placement"]) if r["placement"].isdigit() else 0,
    int(r["participant_order"]),
))
# Re-sort results
results.sort(key=lambda r: (
    r["event_key"],
    r["discipline_key"],
    int(r["placement"]) if r["placement"].isdigit() else 0,
))

print(f"  Participants renumbered: {seq_normalized:,}")
print(f"[Fix 6] placement-normalized groups: {normalized_groups}")
print(f"[Fix 6] placement-normalized participants: {normalized_participants}")

# ── Person ID remap: confirmed aliases ────────────────────────────────────────
# Ellis Piltz (73f415ee) confirmed == Eliot Piltz Galán (1685a8aa) 2026-03-27.
# Remap all canonical participants and remove the orphan person entry.

_PERSON_REMAP = {
    "73f415ee-765e-55ec-bde1-247d6b97eba6": "1685a8aa-0446-562c-bfe0-186e50c8c93b",
}

_alias_remapped = 0
for row in participants:
    old_id = row.get("person_id", "")
    if old_id in _PERSON_REMAP:
        new_id = _PERSON_REMAP[old_id]
        row["person_id"] = new_id
        row["display_name"] = person_name_map.get(new_id, row["display_name"])
        _alias_remapped += 1

# Remove orphan person rows that were remapped away
_remap_old_ids = set(_PERSON_REMAP.keys())
_still_used = {r.get("person_id", "") for r in participants}
persons = [p for p in persons if p["person_id"] not in (_remap_old_ids - _still_used)]

if _alias_remapped:
    print(f"\n[Alias remap] {_alias_remapped} participant row(s) remapped; "
          f"{len(_PERSON_REMAP)} merged person(s) removed from persons.csv")

# ── Inject verified_new events (non-mirror, 2002) ─────────────────────────────
#
# Source: verified_new/Résultats Hivernal 2002 .doc
#         (email chain Archambault/Cote, corrections confirmed)
# Source: verified_new/2002-07-21 Championnat International 2002.doc
#         (Yves Archambault email to announce@footbag.org, 2002-07-22)
# Both confirmed "pas publié sur Footbag.org" — not in mirror.
# Injected here as authoritative non-mirror canonical records.

print("\n[Inject] Adding verified_new 2002 events...")

# Guard: skip injection if already present (idempotent)
existing_event_keys = {e["event_key"] for e in events}

# ── New person: Jean-Philippe Rochefort ────────────────────────────────────────
_JPR_ID = "b8fab5e2-d6d3-482b-b062-0f0394d9bd75"
if _JPR_ID not in {p["person_id"] for p in persons}:
    new_person_row = {f: "" for f in fields_persons}
    new_person_row["person_id"]       = _JPR_ID
    new_person_row["person_name"]     = "Jean-Philippe Rochefort"
    new_person_row["first_year"]      = "2002"
    new_person_row["last_year"]       = "2002"
    new_person_row["event_count"]     = "1"
    new_person_row["placement_count"] = "2"
    new_person_row["bap_member"]      = "0"
    new_person_row["fbhof_member"]    = "0"
    persons.append(new_person_row)
    print(f"  Added person: Jean-Philippe Rochefort ({_JPR_ID})")

# ── Event: 2002 Windchill (L'Hivernal) ────────────────────────────────────────
_EK1 = "2002_montreal_hivernal"
if _EK1 not in existing_event_keys:
    events.append({f: "" for f in fields_events} | {
        "event_key":   _EK1,
        "year":        "2002",
        "event_name":  "2002 Windchill (L'Hivernal)",
        "event_slug":  "2002_windchill_lhivernal",
        "start_date":  "2002-04-06",
        "end_date":    "2002-04-07",
        "city":        "Montreal",
        "region":      "Quebec",
        "country":     "Canada",
        "host_club":   "Cégep du Vieux-Montréal",
        "event_type":  "net",
        "status":      "completed",
        "notes":       "Not published on Footbag.org; verified from email (Archambault/Cote 2002-05)",
        "source":      "verified_new",
    })

    # disciplines
    disciplines.append({f: "" for f in fields_disciplines} | {
        "event_key":         _EK1,
        "discipline_key":    "open_singles_net",
        "discipline_name":   "Open Singles Net",
        "discipline_category": "net",
        "team_type":         "singles",
        "sort_order":        "1",
        "coverage_flag":     "complete",
    })
    disciplines.append({f: "" for f in fields_disciplines} | {
        "event_key":         _EK1,
        "discipline_key":    "open_doubles_net",
        "discipline_name":   "Open Doubles Net",
        "discipline_category": "net",
        "team_type":         "doubles",
        "sort_order":        "2",
        "coverage_flag":     "complete",
    })

    # results — Open Singles Net (placements 1-16, 3-way tie at 14)
    # Ties share a placement number; each tied player gets sequential participant_order.
    # One result row per unique placement; multiple participant rows per tied placement.
    _hivernal_singles = [
        # (placement, pid, name)
        ("1",  "691f48a0-1dbd-5ef5-99ea-13615a7437d2", "Yves Archambault"),
        ("2",  "7c5778f0-6847-58e6-9e37-09967ef3db13", "P.T. Lovern"),
        ("3",  "6d50650f-7f41-5484-894f-74986085f48b", "Martin Cote"),
        ("4",  "d0fd4b0a-a59e-525d-a918-eefb16c70e80", "Martin Graton"),
        ("5",  "f569a985-6548-5b3d-9322-5e2c764bcc11", "Robert Lavigne"),
        ("6",  "184a06bb-be96-5120-9a7c-1676f2b01a2a", "Jean-Francois Lemieux"),
        ("7",  "c312c02d-8a8c-5c73-8b68-65fc9e3fa453", "Benjamin Rochon"),
        ("8",  "2caf7286-2a00-5527-8ec3-313132cf469b", "Mario Vaillancourt"),
        ("9",  "d7ee4909-a76d-5639-aa82-ce4a8a7a53ba", "Stephane Comeau"),
        ("10", "f2ce846c-fa31-52e4-a88e-d8f7bccbe92e", "Maude Landreville"),
        ("11", "68829443-e056-5536-a236-83479656d2cc", "Eric Cote"),
        ("12", "87216aed-3048-50f7-8c54-d7e9e7bb52f3", "Philippe Lessard"),
        ("13", _JPR_ID,                                 "Jean-Philippe Rochefort"),
        ("14", "738cbf71-ad21-598f-a5b3-afdb8bdf543d", "Ted Fritsch"),
        ("14", "96b72fe6-ed2f-5d70-8a49-2e2d38b31e5f", "Alexandre Belanger"),
        ("14", "e5b5852c-6792-5d2b-a8e6-b754be9ae2bd", "Samuel Cloutier"),
    ]
    _seen_singles_plc: dict[str, int] = {}
    for plc, _pid, _name in _hivernal_singles:
        if plc not in _seen_singles_plc:
            results.append({f: "" for f in fields_results} | {
                "event_key":      _EK1,
                "discipline_key": "open_singles_net",
                "placement":      plc,
                "source":         "verified_new",
            })
            _seen_singles_plc[plc] = 0
        _seen_singles_plc[plc] += 1
        participants.append({f: "" for f in fields_participants} | {
            "event_key":         _EK1,
            "discipline_key":    "open_singles_net",
            "placement":         plc,
            "participant_order": str(_seen_singles_plc[plc]),
            "display_name":      _name,
            "person_id":         _pid,
        })

    # results — Open Doubles Net (placements 1-9; source has 3-way tie at 7)
    # QC requires exactly 2 participants per doubles placement, so tied teams
    # are assigned sequential placements (7, 8, 9) with notes documenting the tie.
    _hivernal_doubles = [
        # (placement, p1id, p1name, p2id, p2name, notes)
        ("1", "f1e2640c-48ae-588d-99bc-7b55713191f0", "Manu Bouchard",
               "39bc6c51-d2e0-5930-8677-51828c12de14", "Andy Ronald", ""),
        ("2", "c312c02d-8a8c-5c73-8b68-65fc9e3fa453", "Benjamin Rochon",
               "184a06bb-be96-5120-9a7c-1676f2b01a2a", "Jean-Francois Lemieux", ""),
        ("3", "6d50650f-7f41-5484-894f-74986085f48b", "Martin Cote",
               "f569a985-6548-5b3d-9322-5e2c764bcc11", "Robert Lavigne", ""),
        ("4", "691f48a0-1dbd-5ef5-99ea-13615a7437d2", "Yves Archambault",
               "7c5778f0-6847-58e6-9e37-09967ef3db13", "P.T. Lovern", ""),
        ("5", "fea99a91-ae13-5cb1-b87f-3c352783dc2e", "Genevieve Bousquet",
               "f2ce846c-fa31-52e4-a88e-d8f7bccbe92e", "Maude Landreville", ""),
        ("6", "2caf7286-2a00-5527-8ec3-313132cf469b", "Mario Vaillancourt",
               "d0fd4b0a-a59e-525d-a918-eefb16c70e80", "Martin Graton", ""),
        ("7", "d7ee4909-a76d-5639-aa82-ce4a8a7a53ba", "Stephane Comeau",
               "96b72fe6-ed2f-5d70-8a49-2e2d38b31e5f", "Alexandre Belanger", "tied-7th"),
        ("8", "68829443-e056-5536-a236-83479656d2cc", "Eric Cote",
               "87216aed-3048-50f7-8c54-d7e9e7bb52f3", "Philippe Lessard", "tied-7th"),
        ("9", "e5b5852c-6792-5d2b-a8e6-b754be9ae2bd", "Samuel Cloutier",
               _JPR_ID,                                 "Jean-Philippe Rochefort", "tied-7th"),
    ]
    for plc, p1id, p1n, p2id, p2n, note in _hivernal_doubles:
        results.append({f: "" for f in fields_results} | {
            "event_key":      _EK1,
            "discipline_key": "open_doubles_net",
            "placement":      plc,
            "notes":          note,
            "source":         "verified_new",
        })
        participants.append({f: "" for f in fields_participants} | {
            "event_key":         _EK1,
            "discipline_key":    "open_doubles_net",
            "placement":         plc,
            "participant_order": "1",
            "display_name":      p1n,
            "person_id":         p1id,
        })
        participants.append({f: "" for f in fields_participants} | {
            "event_key":         _EK1,
            "discipline_key":    "open_doubles_net",
            "placement":         plc,
            "participant_order": "2",
            "display_name":      p2n,
            "person_id":         p2id,
        })

    print(f"  Added event: {_EK1} (2 disciplines, 14 singles + 9 doubles placements)")

# ── Event: 2002 Montreal International Footbag Championships ──────────────────
_EK2 = "2002_montreal_international"
if _EK2 not in existing_event_keys:
    events.append({f: "" for f in fields_events} | {
        "event_key":   _EK2,
        "year":        "2002",
        "event_name":  "2002 Montreal International Footbag Championships",
        "event_slug":  "2002_montreal_international_footbag_championships",
        "start_date":  "2002-07-21",
        "end_date":    "2002-07-21",
        "city":        "Montreal",
        "region":      "Quebec",
        "country":     "Canada",
        "event_type":  "net",
        "status":      "completed",
        "notes":       "Not published on Footbag.org; verified from Archambault email to announce@footbag.org 2002-07-22",
        "source":      "verified_new",
    })

    # disciplines (5 net divisions)
    _intl_discs = [
        ("open_singles_net",         "Open Singles Net",         "singles", "1"),
        ("open_womens_singles_net",   "Open Women's Singles Net", "singles", "2"),
        ("open_mixed_doubles_net",    "Open Mixed Doubles Net",   "doubles", "3"),
        ("open_womens_doubles_net",   "Open Women's Doubles Net", "doubles", "4"),
        ("open_doubles_net",          "Open Doubles Net",         "doubles", "5"),
    ]
    for dk, dn, tt, so in _intl_discs:
        disciplines.append({f: "" for f in fields_disciplines} | {
            "event_key":           _EK2,
            "discipline_key":      dk,
            "discipline_name":     dn,
            "discipline_category": "net",
            "team_type":           tt,
            "sort_order":          so,
            "coverage_flag":       "complete",
        })

    # Open Singles Net: p1 Emmanuel, p2 John, p3 Patrick/Yves (tie)
    _intl_singles = [
        ("1", "3ef63282-9e9c-5f57-94c5-e1b5c4fe8c3c", "Emmanuel Bouchard"),
        ("2", "3b938feb-b4c7-59a1-929f-7b62be77c1ce", "John Leys"),
        ("3", "202607a4-85da-5231-957a-85eb5a4e3e76", "Patrick Asswad"),
        ("3", "691f48a0-1dbd-5ef5-99ea-13615a7437d2", "Yves Archambault"),
    ]
    # Open Women's Singles Net: p1 Genevieve, p2 Julie, p3 Tina/Marilyn (tie)
    _intl_womens_singles = [
        ("1", "fea99a91-ae13-5cb1-b87f-3c352783dc2e", "Genevieve Bousquet"),
        ("2", "adc70b9b-7496-5ded-8feb-fdc8e9c5d21c", "Julie Symons"),
        ("3", "54e16a85-0204-5ef1-aa92-a09c9af8ae1c", "Tina Lewis"),
        ("3", "40a3babb-8d9d-522c-8cbf-9f221bbc5903", "Marilyn Demuy"),
    ]

    for dk, plclist in [
        ("open_singles_net",       _intl_singles),
        ("open_womens_singles_net", _intl_womens_singles),
    ]:
        _seen_plc: dict[str, int] = {}
        for plc, _pid, _name in plclist:
            if plc not in _seen_plc:
                results.append({f: "" for f in fields_results} | {
                    "event_key": _EK2, "discipline_key": dk, "placement": plc, "source": "verified_new",
                })
                _seen_plc[plc] = 0
            _seen_plc[plc] += 1
            participants.append({f: "" for f in fields_participants} | {
                "event_key": _EK2, "discipline_key": dk, "placement": plc,
                "participant_order": str(_seen_plc[plc]),
                "display_name": _name, "person_id": _pid,
            })

    # Doubles divisions
    _intl_doubles = {
        "open_mixed_doubles_net": [
            ("1", "3ef63282-9e9c-5f57-94c5-e1b5c4fe8c3c", "Emmanuel Bouchard",
                   "40a3babb-8d9d-522c-8cbf-9f221bbc5903", "Marilyn Demuy"),
            ("2", "4f763ef4-fb7b-5fcb-9883-988370e20b2e", "Alexis Deschenes",
                   "adc70b9b-7496-5ded-8feb-fdc8e9c5d21c", "Julie Symons"),
            ("3", "39bc6c51-d2e0-5930-8677-51828c12de14", "Andy Ronald",
                   "f2ce846c-fa31-52e4-a88e-d8f7bccbe92e", "Maude Landreville"),
        ],
        "open_womens_doubles_net": [
            ("1", "adc70b9b-7496-5ded-8feb-fdc8e9c5d21c", "Julie Symons",
                   "40a3babb-8d9d-522c-8cbf-9f221bbc5903", "Marilyn Demuy"),
            ("2", "fea99a91-ae13-5cb1-b87f-3c352783dc2e", "Genevieve Bousquet",
                   "54e16a85-0204-5ef1-aa92-a09c9af8ae1c", "Tina Lewis"),
            ("3", "f2ce846c-fa31-52e4-a88e-d8f7bccbe92e", "Maude Landreville",
                   "30587e0d-eaca-56c7-af01-c2950564b659", "Lyne Arsenault"),
        ],
        "open_doubles_net": [
            ("1", "3ef63282-9e9c-5f57-94c5-e1b5c4fe8c3c", "Emmanuel Bouchard",
                   "c0ba05a1-16a9-51e0-bcf5-7f6b879710a9", "Sebastien Verdy"),
            ("2", "202607a4-85da-5231-957a-85eb5a4e3e76", "Patrick Asswad",
                   "f569a985-6548-5b3d-9322-5e2c764bcc11", "Robert Lavigne"),
            ("3", "c312c02d-8a8c-5c73-8b68-65fc9e3fa453", "Benjamin Rochon",
                   "184a06bb-be96-5120-9a7c-1676f2b01a2a", "Jean-Francois Lemieux"),
            ("4", "691f48a0-1dbd-5ef5-99ea-13615a7437d2", "Yves Archambault",
                   "4f763ef4-fb7b-5fcb-9883-988370e20b2e", "Alexis Deschenes"),
        ],
    }
    for dk, plclist in _intl_doubles.items():
        _seen = set()
        for plc, p1id, p1n, p2id, p2n in plclist:
            if plc not in _seen:
                results.append({f: "" for f in fields_results} | {
                    "event_key": _EK2, "discipline_key": dk, "placement": plc, "source": "verified_new",
                })
                _seen.add(plc)
        for plc, p1id, p1n, p2id, p2n in plclist:
            participants.append({f: "" for f in fields_participants} | {
                "event_key": _EK2, "discipline_key": dk, "placement": plc,
                "participant_order": "1", "display_name": p1n, "person_id": p1id,
            })
            participants.append({f: "" for f in fields_participants} | {
                "event_key": _EK2, "discipline_key": dk, "placement": plc,
                "participant_order": "2", "display_name": p2n, "person_id": p2id,
            })

    print(f"  Added event: {_EK2} (5 disciplines, 4+4+3+3+4 placements)")

# ── Fix 7: Resolve remaining empty person_id fields ───────────────────────────
# Strategy (canonical-only — no synthetic persons):
#   a) Display name exactly matches a person_name in persons.csv (all PT persons):
#      → Fill in that person's person_id.  Safe: no identity guessing.
#   Sentinels (__NON_PERSON__, __UNKNOWN_PARTNER__, etc.) and names with no
#   exact PT match are left with person_id="" — the QC gate treats these as
#   "unresolved participant" (not orphan) and does not flag them as hard-fail.
#
# NOTE: Synthetic UNRESOLVED / per-slot UUID5 persons have been removed.
# Those caused alias rows and noise to leak into persons.csv as fake person rows,
# violating the canonical-only contract.  Stage 05's _clean_pid now resolves
# player-level UUIDs → PT person_ids, so only genuinely unresolvable names
# (noise, city artifacts, single-name fragments) reach this stage with empty ids.

print("\n[Fix 7] Resolving remaining empty person_id fields (canonical-only)...")

_SENTINEL_DISPLAY_NAMES = {"__NON_PERSON__", "__UNKNOWN_PARTNER__", "[UNKNOWN PARTNER]",
                            "[UNKNOWN]", ""}

# Build name→person_id index from current persons.csv (PT-only at this point)
_name_to_pid: dict[str, str] = {p["person_name"]: p["person_id"] for p in persons}

_f7_name_match = 0   # resolved by exact canonical name lookup
_f7_left_empty = 0   # left unresolved (genuinely unresolvable — allowed by QC)

for row in participants:
    if row.get("person_id", "").strip():
        continue  # already resolved by stage 05 or earlier fix
    dname = row.get("display_name", "").strip()
    if dname and dname not in _SENTINEL_DISPLAY_NAMES and dname in _name_to_pid:
        row["person_id"] = _name_to_pid[dname]
        _f7_name_match += 1
    else:
        # Leave person_id="" — sentinel, noise, or genuinely unknown participant.
        # QC gate excludes empty person_id from orphan checks (unresolved ≠ orphan).
        _f7_left_empty += 1

_f7_remaining = sum(1 for r in participants if not r.get("person_id", "").strip())

print(f"  Resolved by exact canonical name match: {_f7_name_match:,}")
print(f"  Left unresolved (empty person_id):      {_f7_left_empty:,}")
print(f"  Remaining empty person_id (pre-Fix8):   {_f7_remaining:,}")

# ── Fix 8: Remove artifact participants + orphaned result rows ─────────────────
# Participants with blank person_id whose display_name is a parsing artifact
# (single word, city/state/country, club name, parenthetical fragment, geographic
# garbage) are REMOVED.  These are not people; keeping them corrupts statistics.
# After removal, event_result rows that end up with zero participants are also
# removed (orphaned result → no data at that placement).
#
# Legitimate sentinels are KEPT:
#   __NON_PERSON__, __UNKNOWN_PARTNER__, [UNKNOWN PARTNER]
# Single-name fragments (Jean, Juha) that look like real first names are also
# REMOVED — unidentifiable and cannot be attributed.

print("\n[Fix 8] Removing artifact participants and orphaned results...")

import re as _re

_KEEP_SENTINELS = {"__NON_PERSON__", "__UNKNOWN_PARTNER__", "[UNKNOWN PARTNER]",
                   "[UNKNOWN]", ""}

# Known geographic/artifact keywords (multi-word patterns)
_GEO_PATTERN = _re.compile(
    r"\b(canada|quebec|province|ontario|colombie|nova\s+scotia|state\s+college|"
    r"mountain\s+view|phoenix|montreal|australia|new\s+zealand|republic)\b",
    _re.I,
)
_CLUB_PATTERN = _re.compile(
    r"\b(club|association|academy|federation|footbag\s+\w+|imagepunkt)\b", _re.I
)
_PAREN_PATTERN = _re.compile(r"[()]")
_TRAILING_FRAG = _re.compile(r"\b(and|or)\s*$", _re.I)
_STATE_FRAG    = _re.compile(r"^[A-Z]{2}\)?\s*[-–]?\s*(canada|and|or)?\s*$")


def _is_artifact(name: str) -> bool:
    """Return True if name is a parsing artifact that should be removed."""
    n = name.strip()
    if not n or n in _KEEP_SENTINELS:
        return False
    # Single word (no spaces) — covers "Jean", "Juha", "California", "Poland"
    if " " not in n:
        return True
    # Contains parentheses — leftover fragment from split team notation
    if _PAREN_PATTERN.search(n):
        return True
    # Club / federation names
    if _CLUB_PATTERN.search(n):
        return True
    # Geographic garbage (city, province, country combinations)
    if _GEO_PATTERN.search(n):
        return True
    # Trailing conjunction fragment — "BC) and", "AB) or"
    if _TRAILING_FRAG.search(n):
        return True
    # Short state/province abbreviation fragments — "GA)", "BC)", "AB)"
    if _STATE_FRAG.match(n):
        return True
    return False


# Build doubles slot set — artifacts in doubles results become [UNKNOWN PARTNER]
# rather than being removed (doubles need exactly 2 participants).
_doubles_slots: set[tuple[str, str]] = {
    (r["event_key"], r["discipline_key"])
    for r in disciplines
    if r.get("team_type") == "doubles"
}

# First pass: remove artifact participants from singles; sentinel-ize in doubles
_f8_removed = 0
_f8_sentineled = 0
clean_participants = []
for row in participants:
    pid   = row.get("person_id", "").strip()
    dname = row.get("display_name", "").strip()
    if not pid and _is_artifact(dname):
        slot = (row.get("event_key", ""), row.get("discipline_key", ""))
        if slot in _doubles_slots:
            # Replace with explicit unknown sentinel — preserves doubles structure
            row["display_name"] = "[UNKNOWN PARTNER]"
            clean_participants.append(row)
            _f8_sentineled += 1
        else:
            _f8_removed += 1   # singles/other — remove entirely
    else:
        clean_participants.append(row)

participants = clean_participants

# Second pass: remove event_result rows that now have zero participants
_result_keys_with_parts: set[tuple[str, str, str]] = {
    (r["event_key"], r["discipline_key"], r["placement"])
    for r in participants
}
_f8_orphan_results = 0
clean_results = []
for row in results:
    rk = (row["event_key"], row["discipline_key"], row["placement"])
    if rk in _result_keys_with_parts:
        clean_results.append(row)
    else:
        _f8_orphan_results += 1
results = clean_results

# Renumber participant_order within each result slot after removals
from collections import defaultdict as _defaultdict
_slot_counter: dict[tuple[str, str, str], int] = _defaultdict(int)
for row in participants:
    slot = (row["event_key"], row["discipline_key"], row["placement"])
    _slot_counter[slot] += 1
    row["participant_order"] = str(_slot_counter[slot])

_f8_remaining = sum(1 for r in participants if not r.get("person_id", "").strip())
print(f"  Artifact participants removed:      {_f8_removed:,}")
print(f"  Artifact participants→sentinel:    {_f8_sentineled:,}")
print(f"  Orphaned result rows removed:      {_f8_orphan_results:,}")
print(f"  Remaining empty person_id:         {_f8_remaining:,}")

# ── Andy Linder corrections (S-17, S-18, S-19) ───────────────────────────────
# S-17: Remove Andy Linder from 1980_western_states / freestyle / p1 (+ cascade)
# S-18: Rename 1985_mountainregion event_name → "Cabin Fever Classic"
# S-19: Rename 1985_western_national_indoor event_name → "Oak Park - Chicago Open"

print("\n[Andy Linder corrections] S-17/S-18/S-19...")

_ANDY_ID = "64a7a989-aa2c-5a58-b141-e8378be4a962"

# S-17: remove Andy participant from 1980_western_states / freestyle / p1
_s17_before = len(participants)
participants = [
    row for row in participants
    if not (
        row["event_key"] == "1980_western_states"
        and row["discipline_key"] == "freestyle"
        and row["placement"] == "1"
        and row.get("person_id", "") == _ANDY_ID
    )
]
_s17_removed = _s17_before - len(participants)

# Cascade: remove orphaned result rows
_result_keys_with_parts2: set[tuple[str, str, str]] = {
    (r["event_key"], r["discipline_key"], r["placement"]) for r in participants
}
_s17_cascade = 0
clean_results2 = []
for _row in results:
    _rk = (_row["event_key"], _row["discipline_key"], _row["placement"])
    if _rk in _result_keys_with_parts2:
        clean_results2.append(_row)
    else:
        _s17_cascade += 1
results = clean_results2

print(f"  S-17: Andy removed from 1980_western_states/freestyle/p1: {_s17_removed}")
print(f"  S-17: Orphaned result rows cascaded:                       {_s17_cascade}")

# S-18: Rename 1985_mountainregion
_s18_count = 0
for _ev in events:
    if _ev["event_key"] == "1985_mountainregion":
        _ev["event_name"] = "Cabin Fever Classic"
        _s18_count += 1

# S-19: Rename 1985_western_national_indoor
_s19_count = 0
for _ev in events:
    if _ev["event_key"] == "1985_western_national_indoor":
        _ev["event_name"] = "Oak Park - Chicago Open"
        _s19_count += 1

print(f"  S-18: 1985_mountainregion renamed: {_s18_count}")
print(f"  S-19: 1985_western_national_indoor renamed: {_s19_count}")

# ── Pre-1997 parse failure repairs + authoritative enrichment ─────────────────
#
# Source: authoritative-results-1980-1985.txt (ground truth)
#
# Part A — Fix corrupted participant display_names.
#   Three rows contain "Nth - Name" artifacts where the parser absorbed a
#   continuation line into the preceding participant field instead of creating
#   a new placement row.
#
# Part B — Add missing placement rows.
#   Placements present in the authoritative text but absent from canonical
#   because the OLD_RESULTS parser only captured p1 for these divisions, or
#   because the downstream parse failure (Part A) swallowed p2/p3 data.
#   - "Mag Hughes" resolves to Scott Hughes (4cbf790d) per verified alias.
#   - Karen Uppinghouse (1982_worlds womens_doubles_net p3) is PRE1997_ONLY
#     and not in the canonical persons table; person_id is left empty
#     (unresolved participant — not treated as orphan by QC gate).

print("\n[Pre-1997 enrichment] Parse failure repairs + authoritative additions...")

# Part A: correct specific corrupted participant rows
_PART_A = {
    # (event_key, discipline_key, placement, participant_order):
    #     (correct_display_name, correct_person_id)
    ("1982_worlds",  "womens_doubles_net", "1", "2"):
        ("Carolyn Ramondie",   "cbf84862-04b1-5408-9e43-49b9818ed9aa"),
    ("1983_worlds_2", "doubles_net",        "2", "2"):
        ("Dave Hill",          "5cb79fb4-ab20-558f-b4a2-e7206c9f22df"),
    ("1984_worlds",  "womens_freestyle",   "2", "2"):
        ("Suzanne Beauchemin", "3c09d4cc-2da9-5e1f-8a4c-e44ca0542f82"),
}

_pA_fixed = 0
for _row in participants:
    _key = (_row["event_key"], _row["discipline_key"],
            _row["placement"], _row["participant_order"])
    if _key in _PART_A:
        _row["display_name"], _row["person_id"] = _PART_A[_key]
        _pA_fixed += 1

print(f"  Part A: corrupted participant rows fixed: {_pA_fixed}/3")

# Part B: add missing placements
# Each entry: (event_key, discipline_key, placement, [(display_name, person_id), ...])
_NEW_PLACEMENTS = [
    # 1982 NHSA — Women's Doubles Net p2, p3
    ("1982_worlds", "womens_doubles_net", "2", [
        ("Rita Buckley",       "2b77bf53-5fb8-57a3-a5c0-aa9b0b08434e"),
        ("Alex Frazier",       "1f2d14aa-31e7-5d1f-a338-9ae43af68af5"),
    ]),
    ("1982_worlds", "womens_doubles_net", "3", [
        ("Cheryl Hughes",      "cfcef53f-670c-5721-b206-1ebe7d63987c"),
        ("Karen Uppinghouse",  ""),   # PRE1997_ONLY — not in canonical persons
    ]),
    # 1982 NHSA — Mixed Doubles Net p2, p3
    ("1982_worlds", "mixed_doubles_net", "2", [
        ("Cheryl Hughes",      "cfcef53f-670c-5721-b206-1ebe7d63987c"),
        ("Bill Hayne",         "92b0ee3b-efaa-545a-b07e-30ab6d8ebeb0"),
    ]),
    ("1982_worlds", "mixed_doubles_net", "3", [
        ("Rita Buckley",       "2b77bf53-5fb8-57a3-a5c0-aa9b0b08434e"),
        ("Greg Cortopassi",    "bf5ce187-5cac-52fc-be9b-ba22c5c6fc01"),
    ]),
    # 1982 NHSA — Women's Singles Net p3
    ("1982_worlds", "womens_singles_net", "3", [
        ("Karen Gunther",      "63327293-7bb9-5a45-a50a-e2a2167ba80e"),
    ]),
    # 1982 NHSA — Singles Consecutive Kicks p2, p3
    ("1982_worlds", "singles_consecutive_kicks", "2", [
        ("Andy Linder",        "64a7a989-aa2c-5a58-b141-e8378be4a962"),
    ]),
    ("1982_worlds", "singles_consecutive_kicks", "3", [
        ("Gary Lautt",         "66a5ee0b-abd2-5b24-9d53-5c4f6e3fee14"),
    ]),
    # 1983 NHSA — Women's Doubles Net p2, p3
    ("1983_worlds", "womens_doubles_net", "2", [
        ("Tricia George",      "26349aa8-a1ff-5e6a-bff5-f93a89d20c68"),
        ("Judy Grace",         "73728c19-e412-5006-aa48-1d2685a77f7e"),
    ]),
    ("1983_worlds", "womens_doubles_net", "3", [
        ("Nancy Reynolds",     "eccb075a-3997-5288-a805-774d358f5656"),
        ("Constance Constable","826201f8-2540-5663-9bbf-239e94ccee43"),
    ]),
    # 1983 NHSA — Mixed Doubles Net p2, p3 (Mag Hughes → Scott Hughes alias)
    ("1983_worlds", "mixed_doubles_net", "2", [
        ("Cheryl Hughes",      "cfcef53f-670c-5721-b206-1ebe7d63987c"),
        ("Scott Hughes",       "4cbf790d-c542-5318-9337-ee3dfd539ff1"),
    ]),
    ("1983_worlds", "mixed_doubles_net", "3", [
        ("Tricia George",      "26349aa8-a1ff-5e6a-bff5-f93a89d20c68"),
        ("David Robinson",     "895b0608-34df-509a-853d-684ffa24e824"),
    ]),
    # 1983 NHSA — Team Freestyle p2 (4-person), p3 (2-person)
    ("1983_worlds", "team_freestyle", "2", [
        ("David Robinson",     "895b0608-34df-509a-853d-684ffa24e824"),
        ("Kevin Courtney",     "eb40c6a6-7e80-5190-b77d-47a47735bc0b"),
        ("Reed Gray",          "b5d49246-d1b4-5540-a92d-72d26e6b1d0b"),
        ("Jim Fitzgerald",     "b54020bc-1a1a-5d23-89e1-34617b3514fa"),
    ]),
    ("1983_worlds", "team_freestyle", "3", [
        ("Jack Schoolcraft",   "b7c2a69b-7547-5ee6-936e-b675c748d131"),
        ("Will Squire",        "a6ba539d-a3b1-5685-ba8f-f537731bc96d"),
    ]),
    # 1983 NHSA — Singles Consecutive Kicks p2, p3
    ("1983_worlds", "singles_consecutive_kicks", "2", [
        ("Jim Caveney",        "df329352-6f3b-5e98-b23b-1af6737d100b"),
    ]),
    ("1983_worlds", "singles_consecutive_kicks", "3", [
        ("Gary Lautt",         "66a5ee0b-abd2-5b24-9d53-5c4f6e3fee14"),
    ]),
    # 1983 WFA — Doubles Net p3 (parse failure recovery; p2 partner fixed in Part A)
    ("1983_worlds_2", "doubles_net", "3", [
        ("Bob Swerdlick",      "4a680cee-eee2-5f29-9637-86075d66581c"),
        ("Mike Puderbaugh",    "38df5c50-08d9-5706-90e5-464508ea0962"),
    ]),
    # 1984 Worlds — Women's Freestyle p3 (parse failure recovery; p2 partner fixed above)
    ("1984_worlds", "womens_freestyle", "3", [
        ("Ruth Osterman",      "a10fa54f-eadb-5842-8df1-fdca1920e7e7"),
        ("Vanessa Sabala",     "03ed9422-5152-5132-a181-7249637c824a"),
        ("Jenny Davison",      "3f48caf5-14c9-59f1-8255-1db7ef2fd049"),
    ]),
]

# Build index of existing (event_key, discipline_key, placement) result slots
_existing_result_slots: set[tuple[str, str, str]] = {
    (r["event_key"], r["discipline_key"], r["placement"]) for r in results
}

_pB_results_added = 0
_pB_parts_added   = 0
_pB_skipped       = 0

for _ek, _dk, _plc, _players in _NEW_PLACEMENTS:
    _slot = (_ek, _dk, _plc)
    if _slot in _existing_result_slots:
        _pB_skipped += 1
        continue
    # Add result row
    results.append({
        "event_key":      _ek,
        "discipline_key": _dk,
        "placement":      _plc,
        "score_text":     "",
        "notes":          "authoritative-results-1980-1985.txt",
        "source":         "",
    })
    _existing_result_slots.add(_slot)
    _pB_results_added += 1
    # Add participant rows
    for _order, (_name, _pid) in enumerate(_players, start=1):
        participants.append({
            "event_key":        _ek,
            "discipline_key":   _dk,
            "placement":        _plc,
            "participant_order": str(_order),
            "display_name":     _name,
            "person_id":        _pid,
            "team_person_key":  "",
            "notes":            "",
        })
        _pB_parts_added += 1

print(f"  Part B: result rows added:      {_pB_results_added}")
print(f"  Part B: participant rows added: {_pB_parts_added}")
print(f"  Part B: slots already present:  {_pB_skipped}")

# Part C: reclassify disciplines that have variable-size teams (>2) from
# "doubles" → "team" in event_disciplines so the QC 2-participant constraint
# does not fire on legitimate multi-person team slots.
_TEAM_RECLASSIFY = {
    ("1983_worlds",  "team_freestyle"),   # p2 has 4-person team (auth: Cortopassi/Mag/Lautt/Caveney)
    ("1984_worlds",  "womens_freestyle"),  # p3 has 3-person team (auth: Osterman/Sabala/Davison)
}
_pC_reclassified = 0
for _d in disciplines:
    if (_d["event_key"], _d["discipline_key"]) in _TEAM_RECLASSIFY:
        _d["team_type"] = "team"
        _pC_reclassified += 1
print(f"  Part C: disciplines reclassified doubles→team: {_pC_reclassified}")

# ── Event merge pass (from overrides/event_equivalence.csv, action=merge) ────
#
# For each merge group: loser rows are combined into the winner event_key.
# Conflicts (same discipline_key + placement already exists in winner) are
# NOT overwritten — the conflict is noted in the results.csv notes field.
# The loser is removed from all five canonical tables after merge.

print("\n[Event merge] Applying event_equivalence.csv merges...")

_EQUIV_PATH = ROOT / "overrides" / "event_equivalence.csv"

# Build merge groups: winner_key → [loser_key, ...]
# Both the winner row and loser row(s) use the canonical event_key (post-Stage-05).
_merge_groups: dict[str, list[str]] = {}
if _EQUIV_PATH.exists():
    with open(_EQUIV_PATH, newline="", encoding="utf-8") as _f:
        for _row in csv.DictReader(_f):
            _action        = (_row.get("action") or "").strip().lower()
            _event_id      = (_row.get("event_id") or "").strip()
            _canonical_key = (_row.get("canonical_event_id") or "").strip()
            if _action != "merge" or not _event_id or not _canonical_key:
                continue
            # event_id here is the canonical event_key written by Stage 05
            if _event_id != _canonical_key:
                _merge_groups.setdefault(_canonical_key, []).append(_event_id)

if not _merge_groups:
    print("  No merge groups defined — skipping.")
else:
    print(f"  {len(_merge_groups)} merge group(s): {list(_merge_groups.keys())}")

    # Index current canonical data by event_key for fast lookup
    _winner_disc_keys:   dict[str, set[str]]                   = defaultdict(set)
    _winner_result_keys: dict[str, set[tuple[str, str]]]       = defaultdict(set)

    for _d in disciplines:
        _winner_disc_keys[_d["event_key"]].add(_d["discipline_key"])
    for _r in results:
        _winner_result_keys[_r["event_key"]].add((_r["discipline_key"], _r["placement"]))

    _m_discs_added      = 0
    _m_results_added    = 0
    _m_results_conflict = 0
    _m_parts_added      = 0

    for _winner_key, _loser_keys in _merge_groups.items():
        for _loser_key in _loser_keys:
            # ── event_disciplines: add loser disciplines not present in winner ──
            for _d in disciplines:
                if _d["event_key"] != _loser_key:
                    continue
                if _d["discipline_key"] not in _winner_disc_keys[_winner_key]:
                    disciplines.append({**_d, "event_key": _winner_key})
                    _winner_disc_keys[_winner_key].add(_d["discipline_key"])
                    _m_discs_added += 1

            # ── event_results: add loser results; flag conflicts ──────────────
            for _r in results:
                if _r["event_key"] != _loser_key:
                    continue
                _slot = (_r["discipline_key"], _r["placement"])
                if _slot in _winner_result_keys[_winner_key]:
                    # Conflict: note it on the existing winner row (do not overwrite)
                    for _wr in results:
                        if (_wr["event_key"] == _winner_key
                                and _wr["discipline_key"] == _slot[0]
                                and _wr["placement"] == _slot[1]):
                            _existing_note = (_wr.get("notes") or "").strip()
                            _conflict_note = (
                                f"MERGE_CONFLICT: loser {_loser_key!r} "
                                f"had different data at {_slot[0]!r} p{_slot[1]}"
                            )
                            _wr["notes"] = (
                                f"{_existing_note}; {_conflict_note}"
                                if _existing_note else _conflict_note
                            )
                            _m_results_conflict += 1
                            break
                else:
                    results.append({**_r, "event_key": _winner_key})
                    _winner_result_keys[_winner_key].add(_slot)
                    _m_results_added += 1

            # ── event_result_participants: add loser participants ─────────────
            # Only add participants for non-conflicting slots.
            # _winner_result_keys[_winner_key] holds the pre-merge snapshot,
            # so any slot already present there was a conflict.
            _pre_merge_winner_slots = _winner_result_keys[_winner_key]
            for _p in participants:
                if _p["event_key"] != _loser_key:
                    continue
                _pslot = (_p["discipline_key"], _p["placement"])
                if _pslot in _pre_merge_winner_slots:
                    continue   # conflict slot — keep winner's participants
                participants.append({**_p, "event_key": _winner_key})
                _m_parts_added += 1

        # ── Remove all loser rows from all tables ─────────────────────────────
        _all_loser_keys = set(_loser_keys)
        events       = [e for e in events       if e["event_key"] not in _all_loser_keys]
        disciplines  = [d for d in disciplines  if d["event_key"] not in _all_loser_keys]
        results      = [r for r in results      if r["event_key"] not in _all_loser_keys]
        participants = [p for p in participants if p["event_key"] not in _all_loser_keys]

    print(f"  Disciplines added:        {_m_discs_added}")
    print(f"  Result rows added:        {_m_results_added}")
    print(f"  Result conflicts flagged: {_m_results_conflict}")
    print(f"  Participant rows added:   {_m_parts_added}")

# ── Referential closure: backfill persons injected by 05p5 fixes ─────────────
# _PART_A / _NEW_PLACEMENTS / inject blocks may set person_ids that were not
# emitted by stage 05 (e.g. parse-failure corrections).  Ensure every non-empty
# participant person_id has a matching row in persons.  Load from PT v51 if needed.

print("\n[Closure] Checking referential closure for persons...")

_05p5_written_pids = {p["person_id"] for p in persons if p.get("person_id", "").strip()}
_05p5_part_pids = {
    r["person_id"].strip()
    for r in participants
    if r.get("person_id", "").strip() and r["person_id"].strip() not in ("__NON_PERSON__",)
}
_05p5_missing = _05p5_part_pids - _05p5_written_pids

if _05p5_missing:
    _lock_files = sorted(
        (ROOT / "inputs" / "identity_lock").glob("Persons_Truth_Final_v*.csv")
    )
    if not _lock_files:
        raise FileNotFoundError(
            f"Referential closure backfill failed: no Persons_Truth_Final_v*.csv "
            f"found in {ROOT / 'inputs' / 'identity_lock'}"
        )
    _pt51_by_id: dict[str, dict] = {}
    with open(_lock_files[-1], newline="", encoding="utf-8") as _fpt:
        for _r in csv.DictReader(_fpt):
            _eid = _r.get("effective_person_id", "").strip()
            if _eid:
                _pt51_by_id[_eid] = _r
    _unresolved_closure: list[str] = []
    _backfilled = 0
    for _mpid in sorted(_05p5_missing):
        if _mpid not in _pt51_by_id:
            _unresolved_closure.append(_mpid)
            continue
        _pr = _pt51_by_id[_mpid]
        _new_row = {f: "" for f in fields_persons}
        _new_row["person_id"]   = _mpid
        _new_row["person_name"] = _pr.get("person_canon", "").strip()
        persons.append(_new_row)
        _backfilled += 1
    if _unresolved_closure:
        raise RuntimeError(
            f"Referential closure failed: {len(_unresolved_closure)} person_id(s) "
            f"in participants cannot be found in {_lock_files[-1].name}:\n"
            + "\n".join(f"  {p}" for p in _unresolved_closure)
        )
    print(f"  Backfilled {_backfilled} missing person(s) from {_lock_files[-1].name}")
else:
    print("  OK — all participant person_ids present in persons.")

# ── Dedup: same person_id in same result slot ─────────────────────────────────
# Must run after all person_id resolution steps (Fix 7, Fix 8, alias remap) so
# that stub rows resolved late (empty pid → resolved by name in Fix 7) are also
# caught.  PBP occasionally emits a direct resolved row AND an __NON_PERSON__
# team-expansion row for the same person at the same placement; both may resolve
# to the same person_id through different paths.

_dedup_seen: set[tuple[str, str, str, str]] = set()
_dedup_removed = 0
_deduped_participants = []
for row in participants:
    pid = row.get("person_id", "")
    if pid:
        slot_pid = (row["event_key"], row["discipline_key"], row["placement"], pid)
        if slot_pid in _dedup_seen:
            _dedup_removed += 1
            continue
        _dedup_seen.add(slot_pid)
    _deduped_participants.append(row)

if _dedup_removed:
    participants = _deduped_participants
    print(f"\n[Dedup] Removed {_dedup_removed} duplicate person_id row(s) within same result slot")

# ── Fix 9: Disambiguate bare division labels in multi-category events ─────────
# When an event contains disciplines with explicit non-net tokens (Routines,
# Golf, Consecutives, Distance, etc.) alongside bare labels (Open Singles,
# Mixed Doubles, etc.), the bare labels are unambiguously Net.  Upgrade them to
# "... Net", correct discipline_category to "net", and rename discipline_key to
# match.  Cascade the key rename to results and participants.
#
# Trigger: event has ≥1 discipline whose name contains an explicit non-net token.
# Guard:   discipline whose name already contains ANY explicit token is left alone.
# Safety:  skip rename if new_key would collide with an existing discipline_key
#          in the same event.

print("\n[Fix 9] Disambiguating bare division labels in multi-category events...")

_EXPLICIT_NONNET_TOKENS = frozenset([
    # Freestyle
    "routine", "routines", "freestyle", "shred", "circle", "sick",
    "request", "battle", "ironman", "combo", "trick",
    # Golf
    "golf",
    # Sideline
    "consecutive", "consec", "distance", "one pass", "one-pass",
    "2-square", "2 square", "two square", "four square", "4-square", "4 square",
    # Overall (aggregate discipline — explicit, not ambiguous)
    "overall",
])
_EXPLICIT_NET_TOKENS = frozenset(["net", "volley", "side-out", "side out", "rallye"])
_ALL_EXPLICIT_TOKENS = _EXPLICIT_NONNET_TOKENS | _EXPLICIT_NET_TOKENS

# Sentinel/placeholder names that must never be upgraded
_FIX9_SKIP_SENTINELS = frozenset(["unknown", ""])


def _has_nonnet_explicit(name: str) -> bool:
    low = name.lower()
    return any(tok in low for tok in _EXPLICIT_NONNET_TOKENS)


def _has_any_explicit(name: str) -> bool:
    low = name.lower()
    return any(tok in low for tok in _ALL_EXPLICIT_TOKENS)


# Events that contain ≥1 explicit non-net discipline → bare labels are Net
_multi_cat_events: set[str] = {
    d["event_key"] for d in disciplines
    if _has_nonnet_explicit(d["discipline_name"])
}

# Build (event_key, discipline_key) → discipline_key index for collision check
_existing_disc_keys: dict[str, set[str]] = {}
for d in disciplines:
    _existing_disc_keys.setdefault(d["event_key"], set()).add(d["discipline_key"])

# Collect renames: (event_key, old_key) → new_key
_f9_renames: dict[tuple[str, str], str] = {}
_f9_upgraded = 0

for d in disciplines:
    ek = d["event_key"]
    if ek not in _multi_cat_events:
        continue
    name = d["discipline_name"]
    if name.strip().lower() in _FIX9_SKIP_SENTINELS:
        continue  # sentinel/placeholder — never upgrade
    if _has_any_explicit(name):
        continue  # already has explicit token — leave as-is
    # Bare label in a multi-category event → upgrade to Net
    old_dk = d["discipline_key"]
    new_dk = old_dk + "_net"
    if new_dk in _existing_disc_keys.get(ek, set()):
        print(f"    SKIP collision: {ek}: {old_dk!r} → {new_dk!r} already exists")
        continue
    _f9_renames[(ek, old_dk)] = new_dk
    d["discipline_key"]      = new_dk
    d["discipline_name"]     = name + " Net"
    d["discipline_category"] = "net"
    _f9_upgraded += 1
    print(f"    {ek}: {name!r} → {name + ' Net'!r}")

# Cascade key renames to results and participants
_f9_results_updated = 0
for r in results:
    new_dk = _f9_renames.get((r["event_key"], r["discipline_key"]))
    if new_dk:
        r["discipline_key"] = new_dk
        _f9_results_updated += 1

_f9_parts_updated = 0
for p in participants:
    new_dk = _f9_renames.get((p["event_key"], p["discipline_key"]))
    if new_dk:
        p["discipline_key"] = new_dk
        _f9_parts_updated += 1

print(f"  Bare labels upgraded to Net: {_f9_upgraded}")
print(f"  Results rows updated:        {_f9_results_updated}")
print(f"  Participant rows updated:    {_f9_parts_updated}")

# ── Fix 10: Pre-1993 governing-body host_club assignment ──────────────────────
# Events through 1982 were organised under the NHSA (National Hacky Sack
# Association).  The WFA (World Footbag Association) succeeded NHSA in 1983.
# Rule:
#   • "NHSA" in event_name                   → host_club = "NHSA"  (explicit tag)
#   • year < 1983 (and no explicit tag)       → host_club = "NHSA"  (year-based)
#   • 1983 ≤ year ≤ 1993 (no explicit tag)   → host_club = "WFA"
# Events with host_club already set are left unchanged.
# Events in 1983 that carry "(NHSA)" in their name receive "NHSA"; all others
# in 1983 receive "WFA" — matching the confirmed transition year.

print("\n[Fix 10] Assigning host_club for pre-1993 governing body events...")
_f10_assigned = 0
for ev in events:
    if ev.get("host_club"):          # already set — do not override
        continue
    yr_str = ev.get("year", "")
    if not yr_str or not yr_str.isdigit():
        continue
    yr = int(yr_str)
    if yr > 1993:
        continue
    name = ev.get("event_name", "")
    if "NHSA" in name or yr < 1983:
        ev["host_club"] = "NHSA"
    else:                             # 1983–1993, not explicitly NHSA-named
        ev["host_club"] = "WFA"
    _f10_assigned += 1

print(f"  host_club assigned: {_f10_assigned} events  "
      f"(NHSA: {sum(1 for e in events if e.get('host_club') == 'NHSA' and int(e.get('year','0') or 0) <= 1993)}, "
      f"WFA: {sum(1 for e in events if e.get('host_club') == 'WFA')})")

# ── Save ──────────────────────────────────────────────────────────────────────

print("\nSaving...")
save("events.csv",                    events,       fields_events)
save("event_disciplines.csv",         disciplines,  fields_disciplines)
save("event_results.csv",             results,      fields_results)
save("event_result_participants.csv", participants, fields_participants)
save("persons.csv",                   persons,      fields_persons)

# ── Relational Health Report ──────────────────────────────────────────────────

# Final integrity counts
disc_set  = {(r["event_key"], r["discipline_key"]) for r in disciplines}
event_set = {r["event_key"] for r in events}

orphan_discs_results = sum(
    1 for r in results
    if (r["event_key"], r["discipline_key"]) not in disc_set
)
orphan_events_results = sum(
    1 for r in results
    if r["event_key"] not in event_set
)
orphan_discs_parts = sum(
    1 for r in participants
    if (r["event_key"], r["discipline_key"]) not in disc_set
)

singles_count = sum(1 for r in disciplines if r["team_type"] == "singles")
doubles_count = sum(1 for r in disciplines if r["team_type"] == "doubles")
ghost_count   = sum(1 for r in participants if r["display_name"] == "__UNKNOWN_PARTNER__")
resolved      = sum(1 for r in participants if r.get("person_id"))
unresolved    = sum(1 for r in participants if not r.get("person_id"))

print(f"""
╔══════════════════════════════════════════╗
║   Relational Health Report — Stage 05p5 ║
╠══════════════════════════════════════════╣
║ Fix 0  Discipline fixes applied          {_f0_applied:>6,} ║
║        Ghost rows removed (retag)       {_f0_ghost_removed:>6,} ║
║        Participant rows reshaped (out)  {_f0_reshape_removed:>6,} ║
║ Fix 1  Names synced from person master   {names_from_master:>6,} ║
║ Fix 2  Names regex-cleaned (unresolved)  {names_regex_cleaned:>6,} ║
║ Fix 3  Disciplines remapped→singles      {remapped:>6,} ║
║        Disciplines kept doubles          {kept_double:>6,} ║
║ Fix 4  Tie rows enforced (order→1)       {tie_fixes:>6,} ║
║ Fix 5  Ghost partner rows inserted       {len(ghost_rows):>6,} ║
║ Fix 6  Participants renumbered (seq)     {seq_normalized:>6,} ║
║ Fix 7  Resolved by exact name match      {_f7_name_match:>6,} ║
║        Left unresolved (empty pid)       {_f7_left_empty:>6,} ║
║ Fix 9  Bare labels → Net                 {_f9_upgraded:>6,} ║
║ Fix 10 host_club assigned (NHSA/WFA)     {_f10_assigned:>6,} ║
║ Pre97  Parse failures repaired           {_pA_fixed:>6,} ║
║        Missing placements added          {_pB_results_added:>6,} ║
╠══════════════════════════════════════════╣
║ Disciplines: singles {singles_count:<5} doubles {doubles_count:<5}       ║
║ Participants: resolved {resolved:<6} unresolved {unresolved:<5} ║
║ Ghost partners total                    {ghost_count:>6,} ║
╠══════════════════════════════════════════╣
║ Orphaned discipline refs (results)       {orphan_discs_results:>6,} ║
║ Orphaned event refs (results)            {orphan_events_results:>6,} ║
║ Orphaned discipline refs (participants)  {orphan_discs_parts:>6,} ║
╚══════════════════════════════════════════╝
""")

