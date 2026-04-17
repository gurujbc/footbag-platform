#!/usr/bin/env python3
"""
02_canonicalize_results.py — Stage 2: Canonicalize raw event data

This script:
- Reads out/stage1_raw_events.csv
- Parses results text into structured placements
- Outputs: out/stage2_canonical_events.csv

Input: out/stage1_raw_events.csv
Output: out/stage2_canonical_events.csv
"""

from __future__ import annotations

import csv
import json
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

################################################################################
# Overrides loader (JSONL) — optional, behavior-changing only when file exists
################################################################################

def load_event_overrides_jsonl(path: Path) -> dict[str, dict]:
    """
    Load overrides/events_overrides.jsonl (JSON Lines).
    Returns: {event_id: override_dict}
    Later entries for the same event_id overwrite earlier ones (last-write-wins).
    """
    overrides: dict[str, dict] = {}
    if not path.exists():
        return overrides

    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception as e:
                raise ValueError(f"Invalid JSON in overrides file at line {line_no}: {e}") from e

            eid = str(obj.get("event_id", "")).strip()
            if not eid:
                raise ValueError(f"Missing event_id in overrides file at line {line_no}")
            overrides[eid] = obj

    return overrides


def _load_known_broken_events() -> set[str]:
    """Load known broken source event IDs from CSV. Fails loudly if file is missing."""
    path = REPO_ROOT / "overrides" / "known_broken_events.csv"
    if not path.exists():
        raise FileNotFoundError(f"Required override file missing: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        return {row["event_id"].strip() for row in csv.DictReader(f) if row["event_id"].strip()}


def _load_set_from_csv(path: Path, id_col: str = "event_id") -> set[str]:
    """Load a set of IDs from a CSV column. Fails loudly if file is missing."""
    if not path.exists():
        raise FileNotFoundError(f"Required override file missing: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        return {row[id_col].strip() for row in csv.DictReader(f) if row[id_col].strip()}


def _load_dict_from_csv(path: Path, key_col: str = "event_id", value_col: str = "event_name") -> dict[str, str]:
    """Load a key→value dict from two CSV columns. Fails loudly if file is missing."""
    if not path.exists():
        raise FileNotFoundError(f"Required override file missing: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        return {
            row[key_col].strip(): row[value_col].strip()
            for row in csv.DictReader(f)
            if row[key_col].strip()
        }


def _load_results_file_overrides(path: Path) -> dict[str, dict]:
    """Load RESULTS_FILE_OVERRIDES from CSV. Fails loudly if file is missing."""
    if not path.exists():
        raise FileNotFoundError(f"Required override file missing: {path}")
    result: dict[str, dict] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            eid = row["event_id"].strip()
            if not eid:
                continue
            result[eid] = {
                "file": row["file"].strip(),
                "replace": row["replace"].strip().lower() == "true",
            }
    return result


def _load_event_parsing_rules(path: Path) -> dict[str, dict]:
    """Load EVENT_PARSING_RULES from CSV (one row per rule key). Fails loudly if file missing."""
    if not path.exists():
        raise FileNotFoundError(f"Required override file missing: {path}")
    result: dict[str, dict] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            eid = row["event_id"].strip()
            rule = row["rule_name"].strip()
            val: str | bool = row["rule_value"].strip()
            if not eid or not rule:
                continue
            if val.lower() == "true":
                val = True
            elif val.lower() == "false":
                val = False
            if eid not in result:
                result[eid] = {}
            result[eid][rule] = val
    return result


def apply_event_overrides(records: list[dict], overrides: dict[str, dict]) -> tuple[list[dict], int, int]:
    """
    Apply per-event overrides to canonical event records.
    Returns: (new_records, applied_count, excluded_count)
    """
    if not overrides:
        return records, 0, 0

    applied = 0
    excluded = 0
    out: list[dict] = []

    OVERRIDE_FIELDS = ["year", "event_name", "date", "location", "host_club", "event_type"]

    for rec in records:
        eid = str(rec.get("event_id", "")).strip()
        ov = overrides.get(eid)
        if not ov:
            out.append(rec)
            continue

        # Exclusions
        if ov.get("exclude") is True:
            excluded += 1
            continue

        # Apply known fields (allow explicit null to clear)
        for k in OVERRIDE_FIELDS:
            if k in ov:
                rec[k] = ov[k]

        # Keep extra override keys attached (harmless; writer ignores unknown keys)
        for k, v in ov.items():
            if k not in ("event_id",):
                rec.setdefault(k, v)

        applied += 1
        out.append(rec)

    return out, applied, excluded


# Import master QC orchestrator
# Note: qc_master will import slop detection checks automatically
try:
    from qc.qc_master import (
        run_qc_for_stage,
        load_baseline as load_baseline_master,
        save_baseline as save_baseline_master,
        print_qc_delta as print_qc_delta_master,
        print_qc_summary as print_qc_summary_master,
    )
    USE_MASTER_QC = True
except ImportError:
    # Fallback: keep old QC if master not available
    print("Warning: Could not import qc_master, using embedded QC")
    USE_MASTER_QC = False


# ------------------------------------------------------------
# QC Constants
# ------------------------------------------------------------
VALID_EVENT_TYPES = {"freestyle", "net", "worlds", "mixed", "social", "golf", ""}
YEAR_MIN = 1970
YEAR_MAX = 2030

# Expected divisions by event type for cross-validation
EXPECTED_DIVISIONS = {
    "worlds": {
        "required": ["net"],        # ERROR if missing
        "expected": ["freestyle"],  # WARN if missing
    },
    "net": {
        "required": ["net"],
        "expected": [],
    },
    "freestyle": {
        "required": ["freestyle"],
        "expected": [],
    },
    "golf": {
        "required": ["golf"],
        "expected": [],
    },
    "mixed": {
        "required": [],
        "expected": [],  # Can have net, freestyle, or both
    },
    "social": {
        "required": [],
        "expected": [],
    },
}

# Known broken source events (SQL errors in original HTML mirror)
# Decision: 2026-02 - These 9 events exist in the mirror but have SQL errors.
# The original footbag.org site had unescaped apostrophes that broke queries.
# We keep the event name (from <title>) and use location/year overrides.
# Note: 11 other broken events were removed - they don't exist in the mirror.
# Managed in: overrides/known_broken_events.csv
KNOWN_BROKEN_SOURCE_EVENTS: set[str] = _load_known_broken_events()
BROKEN_SOURCE_MESSAGE = "[SOURCE ERROR: Database error in original HTML]"

# Junk events to exclude from final output
# Decision: 2026-02 - These events have no useful data (no year, no location, no results)
# Only the event name exists, which isn't useful without context
# Note: 1146524016 and 879559482 were removed - they don't exist in the mirror
# Note: 2001983002 is NOT excluded here — it maps to 1983 WFA championship (has RESULTS_FILE_OVERRIDE)
# Managed in: overrides/junk_events.csv
JUNK_EVENTS_TO_EXCLUDE: set[str] = _load_set_from_csv(
    REPO_ROOT / "overrides" / "junk_events.csv"
)

# Event name overrides for placeholder/template names
# Decision: 2026-02 - Some events have template names that need human correction
# Managed in: overrides/event_name_overrides.csv
EVENT_NAME_OVERRIDES: dict[str, str] = _load_dict_from_csv(
    REPO_ROOT / "overrides" / "event_name_overrides.csv",
    key_col="event_id",
    value_col="event_name",
)

# Location overrides for broken source events (inferred from event names)
# Decision: 2026-02 - These locations were inferred from event names for events
# where the original HTML had SQL errors and no location data was available.
# Managed in: overrides/location_overrides.csv
LOCATION_OVERRIDES: dict[str, str] = _load_dict_from_csv(
    REPO_ROOT / "overrides" / "location_overrides.csv",
    key_col="event_id",
    value_col="location",
)

# Event type overrides for events that can't be auto-classified
# Decision: 2026-02 - Manual classification for edge cases
# Managed in: overrides/event_type_overrides.csv
EVENT_TYPE_OVERRIDES: dict[str, str] = _load_dict_from_csv(
    REPO_ROOT / "overrides" / "event_type_overrides.csv",
    key_col="event_id",
    value_col="event_type",
)

# ------------------------------------------------------------
# Event-Specific Parsing Rules
# ------------------------------------------------------------
# Per-event rules for handling unusual data formats.
# Each event_id maps to a dict of rule names and their config.
# Available rules:
#   - "split_merged_teams": Split "Player1 [seed] COUNTRY Player2 COUNTRY" format
#   - "pre_parse_fixup": Name of a fixup function to apply to results_raw before parsing
#
# Decision: 2026-02 - This structure allows adding event-specific parsing
# without polluting the general parsing logic.
# Events whose results_raw is replaced or supplemented by an external text file.
# Key: event_id string.
# "replace": True  → discard results_raw entirely, use file only.
# "replace": False → prepend file content to existing results_raw (supplement).
# Paths are relative to the repository root.
# Managed in: overrides/results_file_overrides.csv
RESULTS_FILE_OVERRIDES: dict[str, dict] = _load_results_file_overrides(
    REPO_ROOT / "overrides" / "results_file_overrides.csv"
)

# Managed in: overrides/event_parsing_rules.csv
EVENT_PARSING_RULES: dict[str, dict] = _load_event_parsing_rules(
    REPO_ROOT / "overrides" / "event_parsing_rules.csv"
)

def fixup_heart_of_footbag_1997(text: str) -> str:
    """
    Convert ALL-CAPS ordinal format used by event 859787898 (1997 Heart of Footbag).
    Source lines look like:
        BEGINNERS SINGLES
        1ST James Deans
        2ND Forest Schrodt
    Converts to standard "N. Name" format:
        BEGINNERS SINGLES:
        1. James Deans
        2. Forest Schrodt
    """
    # Drop noise header
    text = re.sub(r"^EVENTS:\s*$", "", text, flags=re.MULTILINE | re.IGNORECASE)
    # Convert plain ALL-CAPS division names (no colon/dash) to "Name:" form
    # A division header here is an ALL-CAPS line that contains a DIVISION_KEYWORD
    # and is NOT an ordinal line.
    def _add_colon(m):
        line = m.group(0).rstrip()
        return line + ":"
    text = re.sub(
        r"^(?!(\d{1,2}(ST|ND|RD|TH)\b))[A-Z][A-Z \']+$",
        _add_colon,
        text,
        flags=re.MULTILINE,
    )
    # Convert "1ST Name" / "2ND Name" / "3RD Name" / "4TH Name" → "1. Name"
    text = re.sub(
        r"^(\d{1,2})(ST|ND|RD|TH)\s+",
        lambda m: f"{m.group(1)}. ",
        text,
        flags=re.MULTILINE | re.IGNORECASE,
    )
    return text


def fixup_ordinal_inline_divisions(text: str) -> str:
    """
    Normalise results where division header includes 1st place inline:
      "  Open Singles -  1st  Steve Smith"  ->  "Open Singles:\n1. Steve Smith"
      "                  2nd  Ted Martin"   ->  "2. Ted Martin"
    Used for event 884112176 (1998 Fighting Illini Footbag Festival).
    """
    # Step 1: "[whitespace]DIVISION - 1st NAME" -> "DIVISION:\n1. NAME"
    text = re.sub(
        r'^\s*([A-Za-z][^\n-]*?)\s+-\s+1st\s+(.+?)$',
        r'\1:\n1. \2',
        text,
        flags=re.MULTILINE
    )
    # Step 2: indented ordinal continuations -> "N. NAME"
    text = re.sub(
        r'^\s+(\d+)(?:st|nd|rd|th)\s+(.+?)$',
        r'\1. \2',
        text,
        flags=re.MULTILINE
    )
    return text


def fixup_us_open_2023(text: str) -> str:
    """
    Normalize 2023 US Open (event 1664206719) results format.
    The source uses standalone ordinals before player names and division headers
    with "First place:" suffix that confuse the general parser.

    Transformations:
    - "1v1, First place:" -> "Open Singles Net:"
    - "2v2, First place:" -> "Open Doubles Net:"
    - "Circle, First place:" -> "Circle Contest:"
    - "Routines, First place:" -> "Routines:"
    - "Intermediate" section context tracked for sub-header mapping
    - Standalone ordinals ("2nd") joined with following player line: "2. Chris Siebert"
    - Leading asterisks stripped (*Luka -> Luka)
    """
    lines = text.split('\n')
    normalized = []
    in_intermediate = False

    for line in lines:
        stripped = line.strip()

        # Track Intermediate vs Open section context
        if re.match(r'^Intermediate\s*$', stripped, re.IGNORECASE):
            in_intermediate = True
            continue  # consume the section label; sub-headers below emit the real div name
        if re.match(r'^Freestyle\s*$', stripped, re.IGNORECASE):
            in_intermediate = False
            normalized.append('Freestyle:')
            continue

        # Map 1v1/2v2 headers (with or without trailing colon)
        if re.match(r'^1v1,?\s*[Ff]irst\s+[Pp]lace\s*:?\s*$', stripped):
            normalized.append('Intermediate Singles Net:' if in_intermediate else 'Open Singles Net:')
            continue
        if re.match(r'^2v2,?\s*[Ff]irst\s+[Pp]lace\s*:?\s*$', stripped):
            normalized.append('Intermediate Doubles Net:' if in_intermediate else 'Open Doubles Net:')
            continue

        # Map freestyle division headers
        if re.match(r'^[Cc]ircle,?\s*[Ff]irst\s+[Pp]lace\s*:?\s*$', stripped):
            normalized.append('Circle Contest:')
            continue
        if re.match(r'^[Rr]outines?,?\s*[Ff]irst\s+[Pp]lace\s*:?\s*$', stripped):
            normalized.append('Routines:')
            continue
        # Bare "First place:" at end of event = Intermediate Routines
        if re.match(r'^[Ff]irst\s+[Pp]lace\s*:?\s*$', stripped):
            normalized.append('Intermediate Routines:')
            continue

        # Strip leading asterisk (marks 1st-place player in doubles section)
        if stripped.startswith('*'):
            stripped = stripped[1:].strip()

        normalized.append(stripped)

    # Second pass: join standalone ordinals with the following player line
    # "2nd\nChris Siebert 12722" -> "2. Chris Siebert 12722"
    joined = []
    i = 0
    while i < len(normalized):
        line = normalized[i]
        bare_ord = re.match(r'^(\d{1,2})\s*(?:st|nd|rd|th)\s*$', line, re.IGNORECASE)
        if bare_ord and i + 1 < len(normalized):
            next_line = normalized[i + 1].strip()
            # Only join if next line looks like a player name (not another ordinal or empty)
            if next_line and not re.match(r'^\d{1,2}\s*(?:st|nd|rd|th)\s*$', next_line, re.IGNORECASE):
                joined.append(f'{bare_ord.group(1)}. {next_line}')
                i += 2
                continue
        joined.append(line)
        i += 1

    return '\n'.join(joined)


def fixup_worlds_2024_doubles(text: str) -> str:
    """
    Normalize 2024 IFPA World Championships (event 1706036811) Open Doubles format.

    The source HTML uses "(CC)- Name" with no space before the dash:
      "1. Emmanuel Bouchard (CAN)- François Pelletier (CAN)"
    This prevents the standard ' - ' dash-separator detection in split_entry().

    Fix: insert a space before the dash when it immediately follows a closing paren.
    """
    # Pattern: closing paren + optional whitespace + dash + uppercase-starting name
    # e.g. "(CAN)- " -> "(CAN) - "
    text = re.sub(r'\)\s*-\s*([A-Z])', r') - \1', text)
    return text


def fixup_nz_champs_2000(text: str) -> str:
    """
    NZ Champs 2000 (event 947196813): convert multi-column <pre> layout to sequential.

    The source has up to 3 divisions printed side-by-side with 6+ space gaps:
      "Under 13 Singles            Open Mens Singles           Open Womens Singles"
      "1. Jonathan Bartlett (24)   1. Steve Ramsey (407)       1. Hannah Whiteman (28)"

    Column boundaries are established by header rows (all-non-placement segments).
    Data rows are sliced at those fixed boundaries and routed per-column.
    Wrapped entries (ending "/" or starting "(") are rejoined to the previous entry.
    Single-column overflow (one column ran longer than others) is routed to the
    column whose last-seen placement number is the closest predecessor.
    """
    WIDE_GAP = re.compile(r'\s{6,}')
    PLACE_RE  = re.compile(r'^(\d+)\s*[.=)\-:]')

    def get_col_starts(line):
        """Column start positions for lines with ≥2 wide-gap-separated segments."""
        starts = [0]
        for m in WIDE_GAP.finditer(line):
            s = m.end()
            if s < len(line) and line[s:].strip():
                starts.append(s)
        return starts if len(starts) >= 2 else None

    def slice_cols(line, starts):
        segs = []
        for i, s in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else len(line)
            segs.append((line[s:end] if s < len(line) else '').strip())
        return segs

    def place_num(s):
        m = PLACE_RE.match(s.strip())
        return int(m.group(1)) if m else None

    def all_look_like_div_names(segs):
        """True only if every non-empty segment looks like a division name.
        Rejects player fragments (parenthetical scores, slashes, starts with digit)."""
        for seg in segs:
            if not seg:
                continue
            if re.search(r'\(\d+\)', seg):   # "(13)" "(362)" — score, not div name
                return False
            if '/' in seg:                   # "J.Kingi/K.Stuart" — team separator
                return False
            if re.match(r'\d+\s*[.=]', seg): # starts with placement marker
                return False
        return True

    # Mapping from section header keywords to a short qualifier prepended to column names
    # so that "Open Mens Singles" under Consecutive vs Net vs Freestyle stay distinct.
    _SECTION_PREFIX = {
        "consecutive": "Consecutive",
        "net":         "Net",
        "freestyle":   "Freestyle",
    }

    lines          = text.split('\n')
    output         = []
    col_pos        = []   # column start positions
    col_names      = []   # division name per column
    col_data       = []   # list[list[str]] — accumulated lines per column
    last_pl        = []   # last place number seen per column
    section_pfx    = [""] # current section qualifier (list so closure can mutate it)

    def flush():
        for name, data in zip(col_names, col_data):
            if data:
                pfx = section_pfx[0]
                output.append(f"{pfx} {name}".strip() if pfx else name)
                output.extend(data)
        col_pos.clear(); col_names.clear(); col_data.clear(); last_pl.clear()

    for raw in lines:
        s = raw.strip()
        if not s:
            continue

        gaps = get_col_starts(raw)

        # ── In multi-col context ──────────────────────────────────────────────
        # Always slice using stored col_pos — data rows may have narrow gaps between
        # columns that don't trigger the 6+ space detector.
        if col_pos:
            segs = slice_cols(raw, col_pos)

            if all_look_like_div_names(segs):
                # All segments look like division names (not player fragments).
                if gaps:
                    # Has its own wide gaps → new column header row (recalibrate positions)
                    flush()
                    new_gaps     = get_col_starts(raw)
                    new_segs     = slice_cols(raw, new_gaps)
                    col_pos[:]   = new_gaps
                    col_names[:] = [sg for sg in new_segs if sg]
                    col_data[:]  = [[] for _ in col_names]
                    last_pl[:]   = [0] * len(col_names)
                else:
                    # No wide gaps, no placements → section header line → flush and output
                    flush()
                    sl = s.lower()
                    for kw, pfx in _SECTION_PREFIX.items():
                        if kw in sl:
                            section_pfx[0] = pfx
                            break
                    output.append(s)
                continue

            # Overflow heuristic: if line content doesn't reach col_pos[1], the entry
            # belongs to whichever column has the closest preceding place number.
            if len(col_pos) > 1 and len(raw.rstrip()) < col_pos[1] and segs[0]:
                p_val = place_num(segs[0])
                if p_val is not None:
                    best = 0
                    best_delta = abs(p_val - (last_pl[0] + 1)) if last_pl else 999
                    for j_r in range(1, len(last_pl)):
                        d = abs(p_val - (last_pl[j_r] + 1))
                        if d < best_delta:
                            best_delta = d
                            best = j_r
                    col_data[best].append(segs[0])
                    last_pl[best] = p_val
                continue

            # Data row: route each segment to its column.
            # Bleed-over fix: a short continuation line (e.g. "S.O'Leary (13)  3.")
            # may have the next column's placement marker bled into this segment
            # because compact spacing shifts content left of col_pos.  Strip the
            # trailing placement token and prepend it to the next segment.
            for j, seg in enumerate(segs):
                if j >= len(col_data) or not seg:
                    continue
                # Detect bleed-over before routing.
                # A short continuation segment may end with the start of the next
                # column's placement token bleeding in (e.g. "S.O'Leary (13)  3."
                # or "S.O'Leary                3=A").  Pattern captures the
                # trailing whitespace + digit + separator + any following non-space.
                bleed_m = re.search(r'\s+(\d+[.=]\S*)\s*$', seg)
                if bleed_m and not PLACE_RE.match(seg):
                    bleed = bleed_m.group(1)
                    seg   = seg[:bleed_m.start()].strip()
                    if j + 1 < len(segs):
                        segs[j + 1] = bleed + segs[j + 1]
                p = place_num(seg)
                if p is not None:
                    col_data[j].append(seg)
                    last_pl[j] = p
                elif seg.startswith('(') and col_data[j]:
                    # Trailing score continuation: "(50)" → append to previous entry
                    col_data[j][-1] += ' ' + seg
                elif col_data[j] and col_data[j][-1].rstrip().endswith('/'):
                    # Name continuation after slash: "M.Scott-Murray/" + "S.O'Leary"
                    col_data[j][-1] = col_data[j][-1].rstrip() + seg
            continue

        # ── No multi-col context yet ──────────────────────────────────────────
        if gaps:
            segs = slice_cols(raw, gaps)
            # All segments look like division names → column header row
            if all_look_like_div_names(segs):
                flush()
                col_pos[:]   = gaps
                col_names[:] = [sg for sg in segs if sg]
                col_data[:]  = [[] for _ in col_names]
                last_pl[:]   = [0] * len(col_names)
                continue

        # Single-column line with no multi-col context (section headers, noise, etc.)
        sl = s.lower()
        for kw, pfx in _SECTION_PREFIX.items():
            if kw in sl:
                section_pfx[0] = pfx
                break
        output.append(s)

    flush()
    return '\n'.join(output)


def fixup_two_column_oregon_1997(text: str) -> str:
    """
    Fix 1997 University of Oregon (event 857874500) two-column tabular layout.

    The source has division headers and results printed side-by-side:
      "Singles Golf                                    Doubles Golf"
      "1. Jim Fitzgerald (23)                          1. Andy Ronald/ Jeff Johnson"

    Strategy: collect left-column and right-column content separately, then
    output all left content followed by all right content.  This ensures each
    division header is immediately followed by its own results rather than the
    next column's header.
    """
    lines = text.split('\n')
    left_lines = []
    right_lines = []

    for line in lines:
        # Detect two-column lines: left content + 10+ spaces + right content
        m = re.search(r'^(.+?)\s{10,}(.+)$', line)
        if m:
            left = m.group(1).rstrip()
            right = m.group(2).strip()
            # Strip "TIE" prefix from right side (appears before tied-place results)
            right = re.sub(r'^TIE\s+', '', right).strip()
            left_lines.append(left)
            if right and len(right) >= 2:
                right_lines.append(right)
        else:
            # Single-column line: goes to left stream only
            left_lines.append(line)

    return '\n'.join(left_lines + right_lines)


# Valid 3-letter country codes for merged team detection
VALID_COUNTRY_CODES = {
    "ARG", "AUS", "AUT", "BEL", "BRA", "CAN", "CHI", "COL", "CZE", "DEN",
    "ESP", "FIN", "FRA", "GBR", "GER", "HUN", "ITA", "JPN", "MEX", "NED",
    "NOR", "NZL", "PER", "POL", "RUS", "SUI", "SWE", "URU", "USA", "VEN",
}

# ------------------------------------------------------------
# Stage 2 Helpers
# ------------------------------------------------------------
# Namespace UUID: pick a constant and never change it once you ship.
PLAYERS_NAMESPACE = uuid.UUID("11111111-2222-3333-4444-555555555555")

# Name cleaning patterns
_RE_LEADING_JUNK = re.compile(r"^\s*([&*.,)|-]+\s*)+")
_RE_LEADING_ORD  = re.compile(r"^\s*\d+\s*[\.\)]\s*")  # "1." or "1)"
_RE_BRACKETS     = re.compile(r"[\[\(].*?[\]\)]")      # remove (...) and [...]
_RE_MULTI_SPACES = re.compile(r"\s+")

_BAD_PHRASES = (
    "DID NOT", "ACCORDING TO", "SCORES NOT", "NEW WORLD RECORD",
    "NOT COMPARABLE", "DID NOT PLAY", "INITIAL SEEDING",
    # Section-count noise parsed as player names
    "SQUARE", "SQUARES", "COMPETITORS", "BENEFACTORS",
    "TOTAL REGISTERED", "TOTAL COMPETITORS", "PLACES:",
    "V1, FIRST PLACE", "V2, FIRST PLACE",
    # Ordinal-place fragments: "2ndPlace:" parsed with "2" stripped leaves "NDPLACE"
    "NDPLACE", "STPLACE", "RDPLACE", "THPLACE",
    # Commentary / absence notices
    "DIDN",         # "didn't show up", "didn´t" (apostrophe variants)
    "SHOW UP",      # "didn't show up for semifinals"
    "ABERRATION",   # "Andre P. Aberration" — result anomaly annotation
    # Circle Contest scoring header lines parsed as names
    "ADDS CONTACTS", "RATIO UNIQUES", "SCORE ADD",
    # Winner annotation
    "WINNER:",      # "Winner: Everybody." — commentary, not a person name
    # Timed-format metadata lines leaked as player entries
    "MINUTE TIMED", "MIN. TIMED", "MIN TIMED",
    # Metadata field labels leaked as player entries
    "CONTACT:", "LOCATION:", "VENUE:", "ORGANIZER:", "REGISTRATION:",
)

_TEAM_WORDS = ("TEAM", "FOOTBAG TEAM")  # very light

# Country evidence patterns
_RE_COUNTRY_PAIR = re.compile(r"\b([A-Z]{2,3})/([A-Z]{2,3})\b")
_RE_PARENS_PAIR  = re.compile(r"\(([A-Z]{2,3})\s+([A-Z]{2,3})\)\s*$")
_RE_TRAIL_CODE   = re.compile(r"\b([A-Z]{2,3})\s*$")
_RE_FLAG_PL      = re.compile(r"🇵🇱")

# US states & common provinces to exclude from "country"
_NOT_COUNTRIES = {
    # US states
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO",
    "MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
    # Canada provinces (common)
    "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
}

# minimal common country allowlist (expand over time)
_COUNTRY_OK = {
    "USA","CAN","MEX","BRA","ARG","CHL","COL","PER","VEN",
    "GBR","IRL","FRA","ESP","PRT","DEU","GER","ITA","NLD","BEL","CHE","AUT","SWE","NOR","DNK","FIN","POL","CZE","SVK","HUN","ROU","BGR","UKR","RUS",
    "JPN","KOR","CHN","TWN","THA","VNM","MYS","SGP","IDN","PHL","AUS","NZL",
    "PL","CZ","FI","FR","DE","ES","IT","NL","BE","CH","AT","SE","NO","DK","UK","IE","RU",  # common 2-letter seen in brackets
}

def clean_player_name(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""

    # remove leading junk tokens
    s = _RE_LEADING_JUNK.sub("", s)
    s = _RE_LEADING_ORD.sub("", s)

    # kill obvious trailing punctuation artifacts
    s = s.strip(" ,;:-")

    # remove bracketed notes (tie, scratch, cities, etc.)
    s = _RE_BRACKETS.sub("", s).strip()

    # normalize whitespace
    s = _RE_MULTI_SPACES.sub(" ", s).strip()

    # remove obvious "adds" suffix style
    s = re.sub(r"\b\d+\s+adds\b.*$", "", s, flags=re.I).strip()

    return s

def looks_like_person(clean: str) -> bool:
    if not clean:
        return False

    up = clean.upper()

    # reject if it contains any of the known "not a person" phrases
    if any(p in up for p in _BAD_PHRASES):
        return False

    # reject obvious team names
    if any(w in up for w in _TEAM_WORDS):
        return False

    # reject if there are no letters
    if not any(ch.isalpha() for ch in clean):
        return False

    # reject if it's single token (cities like "Aachen", "Kaluga", etc.)
    # allow single-token nicknames ONLY if quoted like '"Elliott"' is present
    tokens = clean.split()
    if len(tokens) == 1:
        # allow quoted nickname only (rare), otherwise reject
        if '"' in clean or "“" in clean or "”" in clean or "'" in clean:
            return True
        return False

    # reject if it contains too many digits (usually scoreboard junk)
    digit_count = sum(ch.isdigit() for ch in clean)
    if digit_count >= 3:
        return False

    return True

def _normalize_player_name_for_id(name: str) -> str:
    # Keep deterministic; use cleaned name for ID generation
    cleaned = clean_player_name(name)
    return " ".join((cleaned or "").strip().split()).lower()

def make_player_id(player_name: str) -> str:
    key = _normalize_player_name_for_id(player_name)
    return str(uuid.uuid5(PLAYERS_NAMESPACE, key))

def extract_country_observed(entry_raw: str) -> list[str]:
    s = (entry_raw or "").strip()
    if not s:
        return []

    out = []

    # emoji flag example (Poland in your snippet)
    if _RE_FLAG_PL.search(s):
        out.append("PL")

    m = _RE_PARENS_PAIR.search(s)
    if m:
        out.extend([m.group(1), m.group(2)])

    m = _RE_COUNTRY_PAIR.search(s)
    if m:
        out.extend([m.group(1), m.group(2)])

    m = _RE_TRAIL_CODE.search(s)
    if m:
        out.append(m.group(1))

    # normalize/filter
    clean = []
    seen = set()
    for c in out:
        c = c.upper()
        if c in _NOT_COUNTRIES:
            continue
        if c not in _COUNTRY_OK:
            continue
        if c not in seen:
            seen.add(c)
            clean.append(c)

    return clean

def register_player(players: dict, raw_name: str, entry_raw: str) -> str | None:
    name = clean_player_name(raw_name)
    if not looks_like_person(name):
        return None

    pid = make_player_id(name)  # UUID5 from cleaned name
    if pid not in players:
        players[pid] = {"player_name": name, "countries": Counter()}

    for c in extract_country_observed(entry_raw):
        players[pid]["countries"][c] += 1

    return pid


def strip_trailing_country_code(s: str) -> str:
    """
    If a line ends with a valid 3-letter country code, remove it.
    Example: "Damian Budzik FIN" -> "Damian Budzik"
    """
    if not isinstance(s, str):
        return s
    parts = s.strip().split()
    if len(parts) >= 2 and parts[-1].isalpha() and len(parts[-1]) == 3:
        code = parts[-1].upper()
        if code in VALID_COUNTRY_CODES:
            return " ".join(parts[:-1]).strip()
    return s.strip()


_RE_AMP_SPLIT = re.compile(r"\s*&\s*")

_RE_TRAILING_COUNTRY_PAIR = re.compile(r"^(?P<body>.*?)(?:\s+)(?P<c1>[A-Z]{2,3})/(?P<c2>[A-Z]{2,3})\s*$")
_RE_TRAILING_COUNTRY = re.compile(r"^(?P<body>.*?)(?:\s+)(?P<c>[A-Z]{2,3})\s*$")


def _strip_trailing_country_token(s: str) -> str:
    s = s.strip()
    m = _RE_TRAILING_COUNTRY.match(s)
    if not m:
        return s
    # Conservative: only strip ALL-CAPS 2-3 tokens at end (country-like)
    return m.group("body").strip()


def split_team_ampersand_with_country_pair(entry: str):
    """
    Handles: 'Name1 & Name2 FIN/PL' or 'Name1 & Name2 FIN/USA' etc.
    Returns (p1, p2) or None if not match.
    """
    entry = (entry or "").strip()
    m = _RE_TRAILING_COUNTRY_PAIR.match(entry)
    if not m:
        return None

    body = m.group("body").strip()
    # Must actually look like a team joined by ampersand
    if " & " not in body:
        return None

    left, right = [p.strip() for p in body.split(" & ", 1)]
    left = _strip_trailing_country_token(left)
    right = _strip_trailing_country_token(right)

    # Guardrails: avoid splitting if either side is empty
    if not left or not right:
        return None
    return (left, right)


def try_split_amp_team(line: str) -> tuple[str, str] | None:
    """
    Split 'Name1 & Name2' safely.
    - strips trailing country code from the whole line first (e.g., '... FIN')
    - requires exactly one '&' separator
    - requires both sides to look like full names (>=2 tokens)
    - does NOT modify the original unless it returns a split
    """
    if not isinstance(line, str):
        return None
    s = strip_trailing_country_code(line.strip())

    if "&" not in s or "/" in s:
        return None

    parts = _RE_AMP_SPLIT.split(s)
    if len(parts) != 2:
        return None

    left, right = parts[0].strip(), parts[1].strip()

    def looks_like_full_name(x: str) -> bool:
        toks = [t for t in x.split() if t]
        return len(toks) >= 2 and len(x) >= 3 and not any(ch.isdigit() for ch in x)

    if not (looks_like_full_name(left) and looks_like_full_name(right)):
        return None

    return left, right


def is_country_code(s: str) -> bool:
    return (
        isinstance(s, str)
        and len(s) == 3
        and s.isalpha()
        and s.upper() in VALID_COUNTRY_CODES
    )


def strip_trailing_country_codes_aggressive(s: str) -> str:
    """
    Aggressively strip trailing country codes, including patterns like 'FIN/PL' or 'FIN PL'.
    """
    if not isinstance(s, str):
        return s
    s = s.strip()
    
    # Check if last token contains "/" (e.g., "FIN/PL")
    parts = s.rsplit(" ", 1)
    if len(parts) == 2:
        last_part = parts[-1]
        if "/" in last_part:
            codes = last_part.split("/")
            if len(codes) == 2 and all(is_country_code(c.strip()) for c in codes):
                return parts[0].strip()
    
    # Check if last two tokens are both country codes (e.g., "FIN PL")
    parts = s.rsplit(" ", 2)
    if len(parts) >= 2:
        if is_country_code(parts[-1]) and is_country_code(parts[-2]):
            return " ".join(parts[:-2]).strip()
    
    # Fall back to single country code strip
    return strip_trailing_country_code(s)


def repair_misparsed_team_with_ampersand(placements: list[dict]) -> None:
    """
    Fix cases like:
      player1_name = 'A & B FIN'
      player2_name = 'PL'
    caused by misinterpreting 'FIN/PL' as team split.
    Also fixes cases where player1_name contains '&' but player2_name is empty.
    Handles cases where country codes are separated by '/' like 'FIN/PL'.
    """
    for p in placements:
        p1 = p.get("player1_name")
        p2 = p.get("player2_name")

        if not isinstance(p1, str) or "&" not in p1:
            continue

        # Process if player1 contains '&' and:
        # 1. Already marked as team but player2 is a country code (invalid split)
        # 2. Not a team but player2 is empty OR is a country code (should be split)
        competitor_type = p.get("competitor_type", "player")
        is_team = competitor_type == "team"
        
        # Determine if we should process this placement
        should_process = False
        if is_team:
            # Case 1: team but player2 is a country code → invalid split, fix it
            should_process = is_country_code(p2) if p2 else False
        else:
            # Case 2: not a team but player1 has '&'
            # Process if player2 is empty OR is a country code (both indicate misparse)
            if not p2 or not p2.strip():
                should_process = True  # player2 is empty
            elif is_country_code(p2):
                should_process = True  # player2 is a country code
        
        if not should_process:
            continue

        # Strip country codes aggressively (handles FIN/PL pattern)
        p1_clean = strip_trailing_country_codes_aggressive(p1)
        
        # Now try to split on '&' (after stripping country codes, "/" should be gone)
        if "&" not in p1_clean:
            continue
            
        parts = _RE_AMP_SPLIT.split(p1_clean)
        if len(parts) != 2:
            continue

        left, right = parts[0].strip(), parts[1].strip()

        def looks_like_full_name(x: str) -> bool:
            toks = [t for t in x.split() if t]
            return len(toks) >= 2 and len(x) >= 3 and not any(ch.isdigit() for ch in x)

        if not (looks_like_full_name(left) and looks_like_full_name(right)):
            continue

        p["player1_name"] = left
        p["player2_name"] = right
        p["competitor_type"] = "team"


# ------------------------------------------------------------
# QC Issue tracking
# ------------------------------------------------------------
class QCIssue:
    """Represents a single QC issue."""
    def __init__(
        self,
        check_id: str,
        severity: str,
        event_id: str,
        field: str,
        message: str,
        example_value: str = "",
        context: dict = None,
    ):
        self.check_id = check_id
        self.severity = severity
        self.event_id = event_id
        self.field = field
        self.message = message
        self.example_value = example_value
        self.context = context or {}

    def to_dict(self) -> dict:
        return {
            "check_id": self.check_id,
            "severity": self.severity,
            "event_id": self.event_id,
            "field": self.field,
            "message": self.message,
            "example_value": self.example_value,
            "context": self.context,
        }


# Stable UUID namespace for players
NAMESPACE_PLAYERS = uuid.UUID("12345678-1234-5678-1234-567812345678")


def stable_uuid(ns: uuid.UUID, s: str) -> str:
    """Generate stable UUID from namespace and string."""
    return str(uuid.uuid5(ns, s))


# ------------------------------------------------------------
# Division detection and categorization
# ------------------------------------------------------------
# Keywords that DEFINITIVELY indicate a category
# Note: "doubles", "singles", "mixed" are AMBIGUOUS - they exist in both net and freestyle
CATEGORY_KEYWORDS = {
    # NET-specific keywords (if present, division is definitely net)
    "net": {
        "net",           # "Open Singles Net", "Doubles Net"
        "volley",        # "Kick Volley"
        "side-out",      # Net scoring format: "Open Doubles (Side-Out)"
        "side out",      # Variant spacing
        "rallye",        # Net scoring format: "Open Singles (Rallye)"
    },
    # FREESTYLE-specific keywords (if present, division is definitely freestyle)
    "freestyle": {
        "freestyle",     # "Open Freestyle", "Singles Freestyle"
        "routine",       # "Open Routines", "Routine"
        "routines",
        "shred",         # "Shred 30", "Open Shred"
        "circle",        # "Circle Contest", "Open Circle"
        "sick",          # "Sick 3", "Sick3"
        "request",       # "Request Contest"
        "battle",        # "Freestyle Battle"
        "ironman",       # Freestyle endurance event
        "combo",         # "Big Combo", "Huge Combo"
        "trick",         # "Big Trick", "Sick 3-Trick"
        # French keywords
        "homme",         # French men's freestyle
        "femme",         # French women's freestyle
        "feminin",       # French feminine
        # NOTE: "consecutive" is NOT freestyle - it's OTHER (sideline)
    },
    # GOLF keywords
    "golf": {
        "golf",
        "golfer",
        "golfers",
    },
    # SIDELINE/OTHER keywords
    "sideline": {
        "2-square",
        "2 square",      # Without hyphen
        "two square",
        "four square",
        "4-square",
        "4 square",      # Without hyphen
        "consecutive",   # Timed consecutives, one-pass consecutives
        "consec",        # Abbreviation
        "one pass",      # Distance one pass
        "one-pass",      # Hyphenated variant
        "distance",      # Distance events
    },
}

# Keywords for detecting division headers in raw text (used by looks_like_division_header)
# This is a FLAT set - we just need to know if it's a division, not which category
DIVISION_KEYWORDS = {
    # Modifiers (category-neutral)
    "open", "pro", "women", "womens", "men", "mens", "woman", "ladies",
    "intermediate", "advanced", "beginner", "novice", "amateur", "masters",
    # Structure words (category-neutral)
    "double", "doubles", "single", "singles", "mixed",
    # Net-specific
    "net", "volley",
    # Freestyle-specific
    "freestyle", "circle", "shred", "routine", "routines",
    "battle", "battles", "sick3", "sick 3", "sick", "request", "last standing", "last",
    "ironman", "combo", "trick", "ten",
    # Sideline/other
    "consecutive", "consec", "one pass", "distance",
    # Golf
    "golf",
    # 2-square/4-square
    "2-square", "2 square", "two square", "four square", "4-square",
    # Non-English terms
    "simple",       # French for singles
    "doble",        # Spanish for doubles (singular)
    "dobles",       # Spanish for doubles (plural)
    "individuales", # Spanish for singles
    "sencillo",     # Spanish for singles
    "homme",        # French for men's
    "femme",        # French for women's
    "feminin",      # French for feminine
}

# Footbag freestyle trick-name words.
# These appear in performance-annotation lines (e.g. "BLURRY WHIRL", "DOBLE LEG OVER")
# and must NOT be mistaken for division headers or player names.
# Rule: if a short all-caps/mixed-caps line contains ANY of these words (whole-word match)
# it is almost certainly annotated trick data, not a division or competitor.
TRICK_NAME_WORDS = {
    # Leg-over family
    "legover", "leg over",
    # Whirl family
    "whirl", "blurry",
    # Clipper family
    "clipper", "hyperclip",
    # Walking tricks
    "ripwalk", "janiwalker", "locwalk", "swiftwalk",
    # Paradox family
    "paradox", "mirage",
    # Misc named tricks
    "bedwetter", "barfly", "eggbeater", "pixie", "dexterity",
    "torque", "dragonfly", "osis", "sampler", "symphony",
    "blender", "swirl", "symposium",
    # Dexterity / superfly family
    "superfly", "blurriest",
}

# Section headers that indicate logistical/announcement content — not results.
# When the parser sees one of these as a standalone header line, it enters a
# noise-skip mode and ignores all subsequent lines until a recognized division
# header or numeric placement line resets it.
NOISE_SECTION_HEADERS = {
    "attendees", "attendee list",
    "contacts", "contact information", "contact info",
    "hotel", "hotel information", "hotel reservations", "hotel amenities",
    "travel", "travel information",
    "dates and times", "schedule",
    "maps", "map",
    "registration", "registration for events",
    "prizes", "prize list",
    "sponsors", "sponsorship",
    "about", "description", "event description",
    "information", "general information",
    "rules", "event rules",
    # Event-announcement sections that list divisions descriptively (not as results)
    "events", "event list", "divisions", "division list",
}

# Common abbreviated division headers and their expansions
ABBREVIATED_DIVISIONS = {
    # Net abbreviations
    "osn": "Open Singles Net",
    "odn": "Open Doubles Net",
    "isn": "Intermediate Singles Net",
    "idn": "Intermediate Doubles Net",
    "wsn": "Women's Singles Net",
    "wdn": "Women's Doubles Net",
    "mdn": "Mixed Doubles Net",
    "msn": "Masters Singles Net",
    # Freestyle abbreviations
    "osf": "Open Singles Freestyle",
    "odf": "Open Doubles Freestyle",
    "osr": "Open Singles Routines",
    "odr": "Open Doubles Routines",
    "wsr": "Women's Singles Routines",
    # Other common abbreviations
    "os": "Open Singles",
    "od": "Open Doubles",
    "is": "Intermediate Singles",
    "id": "Intermediate Doubles",
    "ws": "Women's Singles",
    "wd": "Women's Doubles",
    "md": "Mixed Doubles",
}

# Division name normalization for non-English languages
# Maps division headers to English equivalents
DIVISION_LANGUAGE_MAP = {
    # Spanish divisions
    # Pattern: normalize by removing RESULTADO/RESULTADOS prefix, PUESTOS suffix
    # INDIVIDUAL = Singles, DOBLES = Doubles
    "resultados open individual": "Open Singles",
    "resultado open individual": "Open Singles",
    "resultados open individual puestos": "Open Singles",
    "resultado open individual puestos": "Open Singles",
    "resultados open singles": "Open Singles",
    "resultado open singles": "Open Singles",
    "resultados open dobles": "Open Doubles",
    "resultado open dobles": "Open Doubles",
    "resultado open dobles puestos": "Open Doubles",
    "resultados open dobles puestos": "Open Doubles",
    "resultado footbag net open dobles": "Open Doubles Net",
    "open net dobles": "Open Doubles Net",
    "open dobles": "Open Doubles",
    "individuales": "Open Singles",
    "dobles": "Open Doubles",
    "resultados sick three": "Sick 3",
    "sick 3 resultados": "Sick 3",

    # French divisions
    # SIMPLE/SINGLE = Singles, Homme = Men's, Féminine/Féminin = Women's
    "single homme": "Men's Singles",
    "single féminine": "Women's Singles",
    "simple net féminin": "Women's Singles Net",
}

# Looks like a placement line: "15. Name", "2nd: Name", etc.
_RE_PLACE_NUM_DOT = re.compile(r"^\s*\d{1,3}\s*[.)]\s+\S")
_RE_PLACE_ORDINAL = re.compile(r"^\s*\d{1,3}\s*(st|nd|rd|th)\s*[:.)]\s+\S", re.IGNORECASE)

# Prize / annotation patterns often embedded in "headers"
_RE_MONEY = re.compile(r"\$\s*\d+")
_RE_PRIZEY = re.compile(r"\b(prize|payout|\$\d+|usd)\b", re.IGNORECASE)

# Obvious section headings (not divisions)
_RE_SECTION_HEADING = re.compile(r"\b(final results?|results?)\b", re.IGNORECASE)

# Name-ish / narrative patterns (not competitive divisions)
_RE_HAS_DASH_NAME = re.compile(r"\b(shred|sets?)\b\s*[-:]\s*[A-Z][a-z]+", re.IGNORECASE)
_RE_OVERALL = re.compile(r"^\s*overall\b", re.IGNORECASE)
_RE_CONTAINS_AND_NAME = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+and\s+", re.IGNORECASE)

# Pattern for detecting merged team format: "Name [seed] CCC Name CCC"
_RE_MERGED_TEAM = re.compile(
    r"^(?P<p1>.+?)\s+(?:\[\d+\]\s+)?(?P<c1>[A-Z]{3})\s+(?P<p2>.+?)\s+(?P<c2>[A-Z]{3})\s*$"
)

# Pattern for splitting ampersand-separated teams
_RE_AMP_TEAM = re.compile(r"\s*&\s*")

_NET_SCORE_RE = re.compile(r"\b\d{1,2}-\d{1,2}\b.*\b\d{1,2}-\d{1,2}\b")


def raw_has_net_signals(rec: dict) -> bool:
    """
    True only if raw results text strongly suggests net scoring/labels exist.
    Uses Stage1's raw block if present, falls back to any stored raw text fields.
    """
    raw = (
        rec.get("results_block_raw")
        or rec.get("results_raw")
        or rec.get("results_text_raw")
        or ""
    )
    s = str(raw).lower()

    if " singles net" in s or " doubles net" in s or " footbag net" in s:
        return True
    if " net" in s:
        # weak, but keep (still better than unconditional ERROR)
        return True
    if _NET_SCORE_RE.search(s):
        return True
    return False


def is_valid_division_label(s: str) -> bool:
    """
    Conservative filter: returns False if s is very likely NOT a division label.
    We do NOT try to correct it; we just refuse to treat it as a division header.
    """
    if not s:
        return False
    t = s.strip()
    if len(t) < 3:
        return False

    # Strip common suffixes that aren't part of the division name (before validation)
    # e.g., "Open Singles Net Results" -> "Open Singles Net"
    t = re.sub(r"\s*-\s*(final|complete)\s+results\s*$", "", t, flags=re.IGNORECASE).strip()
    t = re.sub(r"\s+(final\s+)?results\s*$", "", t, flags=re.IGNORECASE).strip()

    # Not a division if it looks like an actual placement line
    if _RE_PLACE_NUM_DOT.match(t) or _RE_PLACE_ORDINAL.match(t):
        return False

    # Not a division if it contains obvious prize annotation (common corruption)
    if _RE_MONEY.search(t) or _RE_PRIZEY.search(t):
        return False

    # Not a division if it's a standalone section heading (after stripping suffixes above)
    if re.fullmatch(r"(final\s+)?results?", t.strip(), flags=re.IGNORECASE):
        return False

    # Lines like "Freestyle Shred- David Clavens" are almost never divisions
    if _RE_HAS_DASH_NAME.search(t):
        return False

    # Overall summaries are usually not divisions (handle via a different field later if desired)
    if _RE_OVERALL.match(t):
        return False

    # "Chris Ott And ..." often indicates a narrative/award line, not a division
    if _RE_CONTAINS_AND_NAME.search(t) and ("results" not in t.lower()):
        return False

    return True


def normalize_language_division(division_raw: str) -> str:
    """Normalize non-English division names to English equivalents."""
    if not division_raw:
        return division_raw
    key = division_raw.lower().strip().rstrip('.:')
    return DIVISION_LANGUAGE_MAP.get(key, division_raw)


def truncate_long_division(division_raw: str, max_length: int = 80) -> str:
    """
    Truncate excessively long division names.

    Long divisions are usually misidentified placements or event descriptions.
    Keeps meaningful part and truncates at word boundary.
    Also strips explanatory parenthetical content (e.g., "Shred 30 (Total Adds...)").
    """
    if not division_raw:
        return division_raw

    # First, strip explanatory parenthetical content from end
    # E.g., "Shred 30 (Total Adds Compared To Total Contacts)" -> "Shred 30"
    cleaned = re.sub(r'\s*\([^)]*\)\s*$', '', division_raw).strip()

    # If already short after cleaning parentheses, return it
    if len(cleaned) <= max_length:
        return cleaned

    # Truncate at max_length and try to break at word boundary
    truncated = cleaned[:max_length]
    last_space = truncated.rfind(' ')
    if last_space > max_length // 2:  # Only break at word if we still have meaningful content
        truncated = truncated[:last_space].strip()
    return truncated


def categorize_division(division_name: str, event_type: str = None) -> str:
    """
    Categorize a division name into: net, freestyle, golf, or unknown.

    Priority:
    1. If contains NET keyword (e.g., "net") → "net"
    2. If contains FREESTYLE keyword (e.g., "shred", "routine") → "freestyle"
    3. If contains GOLF keyword → "golf"
    4. If ambiguous but event_type is known → use event_type
    5. Otherwise → "unknown"

    Note: "Singles", "Doubles", "Mixed", "Open", "Intermediate" alone are AMBIGUOUS
    but can be inferred from event_type context.
    """
    if not division_name:
        return "unknown"

    low = division_name.lower()

    # Overall/aggregate divisions (e.g. "Individual Overall") are not unknown
    if "individual overall" in low:
        return "overall"

    # Check for net keywords first (most specific)
    for keyword in CATEGORY_KEYWORDS["net"]:
        if keyword in low:
            return "net"

    # Check for freestyle keywords
    for keyword in CATEGORY_KEYWORDS["freestyle"]:
        if keyword in low:
            return "freestyle"

    # Check for golf keywords
    for keyword in CATEGORY_KEYWORDS["golf"]:
        if keyword in low:
            return "golf"

    # Check for other sideline keywords
    for keyword in CATEGORY_KEYWORDS["sideline"]:
        if keyword in low:
            return "sideline"

    # Ambiguous division name - use event context if available
    # e.g., "Open Singles", "Doubles", "Intermediate" could be net or freestyle
    if event_type:
        event_type_lower = event_type.lower()
        # If event is clearly net or freestyle, use that
        if event_type_lower == "net":
            return "net"
        elif event_type_lower == "freestyle":
            return "freestyle"
        elif event_type_lower == "golf":
            return "golf"
        elif event_type_lower == "worlds":
            # Worlds pages often omit the literal word "net" in net divisions.
            # We still refuse to guess freestyle/golf/sideline (those self-identify via keywords),
            # but for ambiguous "Singles/Doubles/Mixed" divisions, treat as net by elimination.
            if division_name and division_name != "Unknown":
                low2 = division_name.lower()
                if any(w in low2 for w in ("singles", "single", "doubles", "double", "mixed")):
                    return "net"
            return "unknown"
        elif event_type_lower == "mixed":
            # In footbag, freestyle divisions always self-identify via keywords
            # (routines, shred, circle, sick, battle, etc.).  If we reached here,
            # no freestyle keyword matched, so a named division is net by elimination.
            # Only truly unidentified divisions ("Unknown") stay unknown.
            if division_name and division_name != "Unknown":
                return "net"
        # For "social", stay unknown

    return "unknown"


def _has_division_keyword(text: str) -> bool:
    """Check if text contains any division keyword as a whole word (not substring)."""
    text_lower = text.lower()
    for kw in DIVISION_KEYWORDS:
        # Use word boundary matching to avoid "pro" matching "Prokoph"
        if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
            return True
    # Handle alpha-digit compound division names where \b doesn't fire between \w chars:
    # "Shred30" → no \b between 'd' and '3'; "Sick3" → same
    if re.search(r'\bshred\d', text_lower) or re.search(r'\bsick\d', text_lower):
        return True
    return False


def looks_like_division_header(line: str) -> bool:
    """
    Check if line looks like a division header.

    Good division headers:
      - "Open Singles Net", "Intermediate Shred", "DOUBLE:", "Sick 3"
      - Abbreviated: "OSN", "ODN", "ODF"
      - Non-English: "Simple:", "Doble:"
      - Short, typically under 50 chars
      - Contains division keywords
      - May end with colon

    NOT division headers (noise):
      - Narrative sentences with "the", "was", "will be", etc.
      - Lines containing scores like "15-5" or "12-11"
      - Lines with result data embedded: "Singles Net: 1. Player Name"
      - Long descriptive text
    """
    low = line.lower().strip()

    # Check for abbreviated divisions first (e.g., "OSN", "ODN:")
    abbrev = low.rstrip(':')
    if abbrev in ABBREVIATED_DIVISIONS:
        return True

    # Strip explanatory text in parentheses for length check
    # E.g., "Intermediate Shred 30 (total adds only.. uniques etc. not counted)"
    #    -> "Intermediate Shred 30"
    line_without_parens = re.sub(r'\s*\([^)]+\)\s*', ' ', line).strip()

    # Length check - real division headers are short (after removing explanations)
    if len(line_without_parens) > 50:
        return False

    # Reject empty or very short lines
    if len(line) < 3:
        return False

    # Reject lines that look like results (start with number + name)
    # BUT: Don't reject if it contains division keywords (e.g., "30 Second Shred", "1 Minute Freestyle")
    # Covers both:
    #   - Separator format: "1. John Smith", "2) Jane Doe", "3: Player"
    #   - Tab-separated format: "1\tJohn Smith" (common in tabular results)
    if re.match(r"^\d+\s*[.):\-]?\s+[A-Z]", line):
        # Check if it has division keywords - if so, might be a time-based division
        if not _has_division_keyword(low):
            return False

    # Reject lines that contain embedded results (colon followed by number)
    # e.g., "Singles Net: 1. The Enforcer Kenny Schultz"
    if re.search(r":\s*\d+[.)]", line):
        return False

    # Reject lines with scores (number-number patterns)
    # e.g., "15-5", "12-11", "21 - 16"
    if re.search(r"\d{2,}\s*[-–]\s*\d{2,}", line):
        return False

    # Reject lines that start with times (schedule noise)
    if re.match(r"^\d{1,2}:\d{2}", line):
        return False

    # Reject lines starting with ordinals followed by a name
    # e.g., "1ST Kenneth Godfrey" - this is a result, not a division
    if re.match(r"^\d+(st|nd|rd|th)\s+[A-Z][a-z]", line, re.IGNORECASE):
        return False

    # Reject admin/instruction text
    if re.match(r"^(important|registration|when:|where:|click|email)", low):
        return False

    # Reject lines containing "place" (result context)
    if "place" in low:
        return False

    # Reject lines starting with "&" or containing contact info
    # Use word boundary for "contact" to avoid matching "Consecutive"
    if line.startswith("&") or re.search(r'\bcontact\b', low):
        return False

    # Reject narrative sentences - these contain common narrative markers
    narrative_patterns = [
        r'\bthe\s+\w+\s+\w+\s+\w+',  # "the summer opening has" (4+ words after "the")
        r'\bwas\b', r'\bwere\b',     # past tense verbs
        r'\bwill\s+be\b',            # future tense
        r'\bgoing\s+to\b',           # "going to celebrate"
        r'\bhere\b.*\bresults?\b',   # "here the results"
        r'\bplayed\b',               # past tense
        r'\bspectators\b',           # audience mention
        r'\bunbeatable\b',           # narrative adjective
        r'\bcelebrate\b',            # narrative verb
    ]
    for pattern in narrative_patterns:
        if re.search(pattern, low):
            return False

    # Reject lines that look like player entries with locations
    # e.g., "Klemens Längauer (AT - 4.)"
    if re.search(r'\([A-Z]{2,3}\s*[-–]\s*\d', line):
        return False

    # Reject comma-separated lists that look like descriptions
    # e.g., "10 golfers, great weather, crazy course!"
    # Valid headers rarely have multiple commas
    if line.count(',') >= 2:
        return False

    # Reject lines with exclamation marks (typically narrative/excitement)
    if '!' in line and not line.rstrip().endswith(':'):
        return False

    # Must contain at least one division keyword (word-boundary match).
    # Use the de-parenthesized version so parenthetical content (e.g., trick
    # annotations like "...last dex of last superfly") can't trigger keywords.
    low_no_parens = line_without_parens.lower()
    if not _has_division_keyword(low_no_parens):
        return False

    # Reject if the line contains freestyle trick-name words.
    # e.g. "DOBLE LEG OVER" matches "doble" (Spanish=doubles) but is actually a
    # trick name.  Trick words have word-boundary priority over division keywords.
    # Also check de-parenthesized version to avoid false positives from annotations.
    for tw in TRICK_NAME_WORDS:
        if re.search(r'\b' + re.escape(tw) + r'\b', low_no_parens):
            return False

    # Accept if line is reasonably structured:
    # 1. Starts with a division-related word, OR
    # 2. Is a short all-caps header, OR
    # 3. Ends with colon (header style), OR
    # 4. Is short enough (<=35 chars) and contains keyword

    valid_starts = [
        'open', 'pro', 'intermediate', 'int', 'amateur', 'novice', 'beginner',
        'advanced', 'masters', 'women', "women's", 'womens', 'woman', 'men', "men's",
        'ladies', 'girls', 'junior', 'mixed', 'single', 'double', 'net',
        'freestyle', 'shred', 'sick', 'circle', 'routine', 'golf', 'battle',
        'request', 'consecutive', 'timed', 'big', 'last',
        # Non-English variants
        'simple', 'doble', 'feminin', 'homme', 'dívky', 'dvojice', 'mixte',
        # Numbers followed by keywords (e.g., "30 Sec. Shred", "5 Minute Timed")
    ]

    # Check if starts with valid word (case-insensitive)
    first_word = low.split()[0].rstrip(':,.-') if low.split() else ''
    starts_valid = first_word in valid_starts

    # Numbers at start are OK if followed by division keyword
    # e.g., "30 Sec. Shred", "5 Minute Timed Consecutives"
    if first_word.isdigit():
        rest = ' '.join(low.split()[1:])
        starts_valid = _has_division_keyword(rest)

    # Check if it's a short all-caps header (e.g., "DOUBLE:", "SINGLE:")
    is_caps_header = line.isupper() and len(line_without_parens) <= 30

    # Check if it ends with colon and is short (likely a header)
    # Use line_without_parens for length: "Open Circle (3 rounds: variety, etc.):" is a valid header
    is_colon_header = line.rstrip().endswith(':') and len(line_without_parens) <= 40

    # Short lines with keywords are likely headers
    is_short_with_keyword = len(line_without_parens) <= 35

    return starts_valid or is_caps_header or is_colon_header or is_short_with_keyword


def smart_title(s: str) -> str:
    """
    Title case that handles apostrophes correctly.
    Fixes: "women's" -> "Women's" (not "Women'S")
    """
    words = s.split()
    result = []
    for word in words:
        titled = word.title()
        # Fix 'S after apostrophe -> 's
        titled = re.sub(r"'S\b", "'s", titled)
        result.append(titled)
    return " ".join(result)


def canonicalize_division(division_raw: str) -> str:
    """
    Produce canonical division name.
    Normalize whitespace and apply smart title casing.
    """
    if not division_raw:
        return "Unknown"
    div = division_raw
    # Strip "Division: " prefix produced by magazine/01b2 inline format
    if div.lower().startswith("division: "):
        div = div[len("division: "):]
    # Fix encoding corruption: "?" or U+FFFD used as placeholder for lost accented chars
    # 1. Possessive apostrophe: "Women?s" / "Master?S" → "Women's" / "Master's"
    div = re.sub(r"(\w)[?\ufffd][Ss]\b", r"\1's", div)
    # 1b. "Womenìs" / "Masterìs": U+00EC (i with grave) used as corrupted apostrophe
    div = re.sub(r"(\w)\u00ECs\b", r"\1's", div)
    # 2. Space-surrounded "?" used as dash: "30 Second Shred ? Open" → "30 Second Shred - Open"
    div = re.sub(r'\s[?\ufffd]\s', ' - ', div)
    # 3. Known multilingual level/gender words with corrupted accented char
    div = re.sub(r'\binterm[?\ufffd]diaire\b', 'Intermediate', div, flags=re.IGNORECASE)
    div = re.sub(r'\binterm[?\ufffd]diate\b', 'Intermediate', div, flags=re.IGNORECASE)
    div = re.sub(r'\bf[?\ufffd]minin(e?)\b', r'Feminin\1', div, flags=re.IGNORECASE)
    div = re.sub(r'\bd[?\ufffd]vky\b', 'Women', div, flags=re.IGNORECASE)
    # 4. Trailing "?" / U+FFFD noise at end of word or line
    div = re.sub(r'[?\ufffd]+$', '', div).strip()
    # 5. Trailing ":" (colon carried over from division header detection)
    div = div.rstrip(':').strip()
    # 6. Normalize common abbreviations: dbls→Doubles, sgls→Singles, dobles→Doubles
    div = re.sub(r"\bdbls\b",   "Doubles", div, flags=re.IGNORECASE)
    div = re.sub(r"\bsgls\b",   "Singles", div, flags=re.IGNORECASE)
    div = re.sub(r"\bdobles\b", "Doubles", div, flags=re.IGNORECASE)
    return smart_title(" ".join(div.split()))


# ------------------------------------------------------------
# Results parsing
# ------------------------------------------------------------
def strip_trailing_score(name: str) -> str:
    """
    Remove ONLY trailing scores and obvious non-name data from player names.
    Conservative approach to avoid creating duplicates.

    Examples:
      "Matt Strong 526" -> "Matt Strong"
      "Ricky Moran: Bothell, WA - 121.35" -> "Ricky Moran: Bothell, WA"
      "Emily J. 5-1" -> "Emily J."

    NOTE: Parenthesized data is kept (may be club names OR tricks - can't reliably distinguish)
    """
    # Remove trailing match score patterns like "5-1", "11-7", "9/3" (doubles game scores)
    cleaned = re.sub(r'\s+\d+[-/]\d+\s*$', '', name).strip()

    # Remove trailing 2-4 digit numbers (scores)
    cleaned = re.sub(r'\s+\d{2,4}\s*$', '', cleaned).strip()

    # Remove trailing decimal scores like "- 121.35" or "= 95.2"
    cleaned = re.sub(r'\s+[-=]\s*\d+(\.\d+)?\s*$', '', cleaned).strip()

    # Remove trailing score patterns like "123 -" or "456 ="
    cleaned = re.sub(r'\s+\d+\s*[-=]\s*$', '', cleaned).strip()

    return cleaned


def clean_host_club(name: str) -> str:
    """
    Clean host club names by removing common formatting artifacts.

    Removes:
    - Numbered prefixes: "1. Club Name", "2. Club Name"
    - Ordinal prefixes: "1st Club", "2nd Club" (converted from numbered)
    """
    if not name:
        return name

    # Remove numbered prefix: "1. Name", "2. Name", etc.
    name = re.sub(r'^\d+\.\s+', '', name).strip()

    # Remove ordinal prefix: "1st Name", "2nd Name", "3rd Name", "4th Name", etc.
    name = re.sub(r'^\d+(?:st|nd|rd|th)\s+', '', name).strip()

    return name


def clean_player_name(name: str) -> str:
    """
    Remove scores, trick lists, and narrative commentary from player names.
    Applied after split_entry() to clean individual player names.

    Preserves: country/club codes in parentheses like (CZE), (Paris Zion)
    Removes: scores, stats breakdowns, trick lists, narrative text
    """
    if not name:
        return name

    original = name

    # Pre-rule: Fix apostrophe corruption before any other processing
    # "O?Brien" → "O'Brien": Irish/Celtic names where apostrophe was lost as "?"
    name = re.sub(r"\bO\?([A-Z][a-z])", r"O'\1", name)

    # Pre-rule: Strip "tie " / "tie: " prefix from tied-place entries
    # e.g. "tie Michael Lopez" → "Michael Lopez", "Tie: Jeff Wells" → "Jeff Wells"
    name = re.sub(r'^tie\s*:?\s+', '', name, flags=re.IGNORECASE).strip()

    # Rule 1: Strip "Name (CZE) - 242.79 (127 adds, 31 uniques, ...)"
    # Score + stats after dash/equals following a parenthetical
    name = re.sub(r'(\))\s*[-=]\s*\d+\.?\d*\s*\([\d\s,a-zA-Z]+\).*$', r'\1', name).strip()

    # Rule 2: Strip "Name 146,66 (36 contacts, 12 uniques, 110 adds...)"
    # European comma-decimal score followed by stats parenthetical
    name = re.sub(r'\s+\d+[,.]\d+\s*\([\d\s,a-zA-Z]+\).*$', '', name).strip()

    # Rule 3: Strip "Name ---------(<score>)" or "Name --------- (<score>)"
    # Dashed-out scores (player didn't make finals)
    name = re.sub(r'\s+-{3,}\s*\(\d+\.?\d*\)\s*$', '', name).strip()

    # Rule 4: Strip "Name <score> (<score>)" — double score pattern
    # e.g. "Vasek Klouda 259.35 (281.53)"
    name = re.sub(r'\s+\d+\.?\d+\s*\(\d+\.?\d+\)\s*$', '', name).strip()

    # Rule 5: Strip parenthetical scores: "Name (194.47)"
    # Only numeric content with decimal point, 2+ digits before decimal
    name = re.sub(r'\s*\(\d{2,}\.?\d*\)\s*$', '', name).strip()

    # Rule 6: Strip "Name (Country) - score (stats...)" where stats has non-paren format
    # e.g. "David Clavens (USA) - whirlwalk > blurriest > ..."
    name = re.sub(r'(\([A-Z]{2,}(?:\s+\w+)*\))\s*[-=]\s+\S.{15,}$', r'\1', name).strip()

    # Rule 7: Strip score + trick parenthetical: "Name 42.6 (Alpine Food Processor > ...)"
    # Score followed by tricks in parentheses (contains > or uppercase trick names)
    name = re.sub(r'\s+\d+\.?\d*\s*\([A-Z][\w\s>.,]+\).*$', '', name).strip()

    # Rule 8: Strip colon-separated trick lists: "Name: trick, trick, trick"
    # Colon followed by 10+ chars containing trick indicators (, > ; ( ")
    m = re.search(r':\s+.{10,}$', name)
    if m and re.search(r'[,>;("]', m.group()):
        name = name[:m.start()].strip()

    # Rule 9: Strip trick lists with "--" separator: "Name--trick, trick"
    name = re.sub(r'\s*--\s*.{10,}$', '', name).strip()

    # Rule 10: Strip trick lists with ">" after country/club parenthetical
    # e.g. "Felix Zenger (FIN) Double Blender > Superfly > ..."
    m = re.match(r'^(.+?\([^)]+\))\s+\S.*>.*$', name)
    if m:
        candidate = m.group(1)
        # Make sure what follows the paren looks like tricks (has >)
        rest = name[len(candidate):]
        if '>' in rest:
            name = candidate.strip()

    # Rule 11: Strip trick lists with ">" after bare name (no parenthetical)
    # e.g. "Damian Gielnicki Spinning Eggbeater > Paradon Swirl > ..."
    # Only if the name doesn't already contain parentheses
    if '(' not in name and '>' in name:
        # Find the first > and look for a name before the trick
        idx = name.index('>')
        before = name[:idx].strip()
        # Try to find where the name ends and tricks begin
        # Look for a transition from capitalized name words to trick content
        words = before.split()
        # Find the last word that looks like a name start (before trick words)
        # Trick words tend to come after 2+ name words
        if len(words) >= 3:
            # Check if word 3+ look like trick content (Spinning, Ducking, etc.)
            # Heuristic: first 2 words are the name, rest is tricks
            candidate_name = ' '.join(words[:2])
            # Verify the candidate looks like a name (both words start uppercase)
            if all(w[0].isupper() for w in words[:2] if w):
                name = candidate_name.strip()

    # Rule 12: Strip narrative text after club parenthetical
    # e.g. "Claire Beltran (Paris Zion) Elle reste championne..."
    # Match: close paren, then 10+ chars of non-paren text
    m = re.match(r'^(.+?\([^)]+\))\s+(.{10,})$', name)
    if m:
        after_paren = m.group(2)
        # Only strip if text after paren looks like narrative (starts with lowercase
        # or contains sentence-like content), NOT like a name suffix
        if (after_paren[0].islower() or
            re.search(r'[.!,;].*\s', after_paren) or
            len(after_paren) > 30):
            # But preserve if it looks like it could be team members
            # e.g. "Name (Club), Name2, Name3"
            if not re.match(r'^[A-Z][a-z]+\s+[A-Z]', after_paren):
                name = m.group(1).strip()

    # Rule 13: Strip "? " trick lists (? used as separator in some events)
    # e.g. "Serge Kaldany ? Quantum Ducking Mirage > Pixie..."
    if ' ? ' in name and '>' in name:
        idx = name.index(' ? ')
        candidate = name[:idx].strip()
        if candidate and candidate[0].isupper():
            name = candidate

    # Rule 14: Strip "Name (Country)(tricks...)" — double parenthetical
    # e.g. "Filip Wojciuk (Poland)(fairy ducking butterfly-bedwetter-...)"
    # Must run before general parenthetical stripping to preserve country code
    m = re.match(r'^(.+?\([^)]{2,15}\))\((.{10,})\)(.*)$', name)
    if m:
        paren2 = m.group(2)
        # Only strip if second paren content looks like tricks (lowercase, has separators)
        if paren2[0].islower() or '>' in paren2 or paren2.count('-') >= 2:
            name = m.group(1).strip()

    # Rule 15: Strip parenthetical trick lists (contains > or | or many commas or = separator)
    # e.g. "Vasek Klouda (Janiwalker>Blurriest, Bedwetter>...)"
    # e.g. "Jakub Mo¶ciszewski (phoenix>bedwetter>pixie paradon | phasing>...)"
    # e.g. "Ale? Zelinka (Backside Symposium Atomic Eggbeater = Symposium...)"
    # e.g. "Jon Schneider (Hopover-Swirl-dragon-rake, Infinity-swirl-...)"
    # But preserve country codes like (CZE) and club names like (Paris Zion)
    m = re.match(r'^([^(]+)\((.+)\)(.*)$', name)
    if m:
        before_paren = m.group(1).strip()
        paren_content = m.group(2)
        after_paren = m.group(3).strip()
        # Strip if paren content contains trick indicators and is long
        has_trick_indicators = ('>' in paren_content or '|' in paren_content or
                                '=' in paren_content or paren_content.count(',') >= 2 or
                                paren_content.count('-') >= 2 or ';' in paren_content)
        # Also strip if it's long narrative text (contains ... or starts with common words)
        is_narrative = ('...' in paren_content or
                        re.match(r'^(I |the |a |an |we |he |she |it |this |forfeit|did not)', paren_content, re.IGNORECASE))
        if len(paren_content) > 15 and (has_trick_indicators or is_narrative):
            # But not if it's clearly a country/club code (short, all letters)
            if not re.match(r'^[A-Za-z\s]{2,10}$', paren_content):
                name = before_paren
                # If there was text after the paren that looks like a country code, keep it
                if after_paren and re.match(r'^\([A-Z]{2,5}\)', after_paren):
                    name = name + ' ' + after_paren

    # Rule 16: Strip "Name (Country) - narrative" where narrative isn't a score
    # e.g. "Dan Greer (USA)- 3 way tie; did not advance past semi-final"
    m = re.match(r'^(.+?\([^)]{2,15}\))\s*-\s*(.{10,})$', name)
    if m:
        after = m.group(2)
        # Only strip if it doesn't start with a digit (which would be a score, handled above)
        if not re.match(r'^\d', after):
            name = m.group(1).strip()

    # Rule 17: Strip square bracket annotations
    # e.g. "Florian Goetze [Final: Emmanuel withdrew due to injury]..."
    m_bracket = re.search(r'\s*\[.{10,}$', name)
    if m_bracket and len(name[:m_bracket.start()].strip()) >= 3:
        name = name[:m_bracket.start()].strip()

    # Rule 18: Strip narrative after club parenthetical with comma separator
    # e.g. "Christopher Reyer (Paris Rien n'est Hacky), désolé pour l'oubli..."
    m = re.match(r'^(.+?\([^)]+\)),\s+(.{10,})$', name)
    if m:
        after = m.group(2)
        # Strip if the text after comma is narrative (starts lowercase)
        if after[0].islower():
            name = m.group(1).strip()

    # Rule 19: Strip colon trick lists where content has parenthetical explanation
    # e.g. "Jeremy Benton: Stepping P.S. Blender ("S" means 'simple' = 7...)"
    m = re.search(r':\s+\S.{10,}$', name)
    if m and ('(' in m.group() or '"' in m.group()):
        name = name[:m.start()].strip()

    # Rule 20: Strip bare name + all-lowercase trick content with >
    # e.g. "DamianPiechocki stepping ps whirl >spinning pdxwhirl >..."
    # e.g. "Maciek Niczyporuk janiwalk>bedwetter>pixie whirling swirl (5,2)"
    if '>' in name:
        # Find where lowercase trick text starts after an uppercase-starting name
        m = re.match(r'^([A-Z]\S+(?:\s+[A-Z]\S+)*)\s+([a-z].+)$', name)
        if m and '>' in m.group(2):
            name = m.group(1).strip()

    # Rule 21: Strip unclosed second parenthetical after country code
    # e.g. "Alex Trener (Austria)(matador-blury whirl-ps whirl, janiwalker-..."
    # Must run before unclosed-paren rule to preserve the country code
    m = re.match(r'^(.+?\([^)]{2,15}\))\((.{10,})$', name)
    if m:
        paren2 = m.group(2)
        if paren2[0].islower() or '>' in paren2 or paren2.count('-') >= 2:
            name = m.group(1).strip()

    # Rule 23: Strip leading slash (parsing artifact from some events)
    # e.g. "/ Serge Kaldany" → "Serge Kaldany"
    name = re.sub(r'^/\s*', '', name).strip()

    # Rule 24: Strip trailing slash
    # e.g. "Forest Schrodt /" → "Forest Schrodt", "scratch/" → "scratch"
    name = re.sub(r'\s*/\s*$', '', name).strip()

    # Rule 25: Strip "- n/a" suffix (player didn't compete)
    # e.g. "Sergio Garcia (Spain) - n/a" → "Sergio Garcia (Spain)"
    name = re.sub(r'\s*-\s*n/a\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 26: Strip N/A placeholders in parentheses or with dash prefix
    # e.g. "Jeff Mudd (N/A)" → "Jeff Mudd", "SERVICE POACHING-n/a" → "SERVICE POACHING"
    # Strip trailing "(n/a)" or "(N/A)" or similar placeholders
    name = re.sub(r'\s*\(n/a\)\s*$', '', name, flags=re.IGNORECASE).strip()
    # Also handle "TRICK-n/a" pattern (missing trick data)
    name = re.sub(r'(-n/a)\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 22: Strip unclosed parenthetical trick/narrative content
    # e.g. "Vasek Klouda (Janiwalker>Blurriest, Bedwetter>Frantic Butterfly, Pixie"
    # e.g. "Nick Landes 42.2 (Nuclear Osis > Spinning Ducking Butterfly > ..."
    # These are truncated trick lists with ( but no closing )
    if name.count('(') > name.count(')'):
        idx = name.index('(')
        before = name[:idx].strip()
        after_open = name[idx+1:]
        # Strip if content after ( is long and has trick/narrative indicators
        if len(after_open) > 15 and (
            '>' in after_open or '|' in after_open or '=' in after_open or
            '...' in after_open or
            after_open.count(',') >= 2 or after_open.count('-') >= 2 or
            re.match(r'^[a-z]', after_open) or
            re.match(r'^(I |the |a |an |we |he |she |it |this )', after_open, re.IGNORECASE)
        ):
            # Strip the trailing score before ( if present
            before = re.sub(r'\s+\d+\.?\d*\s*$', '', before).strip()
            if len(before) >= 3:
                name = before

    # Rule 27: Strip trick name in middle parenthetical for "Big One" division
    # e.g., "Paweł Ścierski (Symp. Whirling SS. Rev. Symp. Whirl) (Poland)"
    # Format: Name (TrickDescription) (Country)
    # Detect: two parenthetical groups at the end, middle one is longer
    paren_pairs = []
    i = 0
    while i < len(name):
        if name[i] == '(':
            close = name.find(')', i)
            if close > i:
                paren_pairs.append((i, close, name[i+1:close]))
                i = close + 1
            else:
                break
        else:
            i += 1

    # If we have 2 parenthetical groups at the end, check if it's Name (Trick) (Country)
    if len(paren_pairs) >= 2:
        second_last = paren_pairs[-2]
        last = paren_pairs[-1]
        trick_content = second_last[2]
        country_content = last[2]

        # Check if this looks like trick + country pattern
        # Trick: 3+ words, contains trick keywords
        # Country: short (2-15 chars), typically all uppercase or normal country name
        if (trick_content.count(' ') >= 2 and  # 3+ words
            2 <= len(country_content) <= 15 and
            any(word in trick_content for word in ['Symp', 'Whirl', 'Rev', 'Bedwetter', 'Fusion',
                                                    'Paradox', 'Eggbeater', 'Legbeater', 'Swirl',
                                                    'Mirage', 'Osis', 'Marius', 'Nemesis', 'Gauntlet',
                                                    'Atomic', 'Merlin', 'Mulet', 'Drifter', 'Clown'])):
            # Strip the trick parenthetical, keep name + country
            # Extract everything before the trick paren + the country paren
            before_trick = name[:second_last[0]].strip()
            name = (before_trick + ' (' + country_content + ')').strip()

    # Rule 36: Strip "Winner = Name" prefix (event summaries listing the winner)
    # e.g. "Winner = Franck Rémy" → "Franck Rémy"
    name = re.sub(r'^Winner\s*=\s*', '', name, flags=re.IGNORECASE).strip()

    # Rule 37: Strip ordinal placement in parentheses (French event format)
    # e.g. "David (1) Rambaud" → "David Rambaud", "Grischa (2) Tellenbach" → "Grischa Tellenbach"
    name = re.sub(r'\s*\(\d{1,2}\)\s*', ' ', name).strip()

    # Rule 38a: Strip "+CODE" affiliation suffix (double-nationality/club combos)
    # e.g. "Anne Busch CH+GER" → "Anne Busch CH" (Rule 38 then strips "CH")
    # e.g. "Ludovic Lacaze RNH+Icarus" → "Ludovic Lacaze RNH" (Rule 38 strips "RNH")
    # e.g. "Alex Smirnov USA+RUS" → "Alex Smirnov USA" (Rule 38 strips "USA")
    name = re.sub(r'\+[A-Za-z]{2,10}$', '', name).strip()

    # Rule 38: Strip bare 2-5 letter country/club code at end of name
    # e.g. "Grischa Tellenbach RNH" → "Grischa Tellenbach", "Charlotte Vollmer GER" → "Charlotte Vollmer"
    # Only strip if the name part has mixed case (has lowercase letters)
    m = re.match(r'^([A-Za-zÀ-ÿ][\w\-\'À-ÿ]+(?: [A-Za-zÀ-ÿ][\w\-\'À-ÿ]+)+)\s+([A-Z]{2,5})$', name)
    if m and any(c.islower() for c in m.group(1)):
        name = m.group(1).strip()

    # Rule 39: Strip " - ORG" where ORG is 2-5 uppercase letters (org/club suffixes)
    # e.g. "Wojtek Jamski - WSF" → "Wojtek Jamski", "Marcin Staroń - WSF" → "Marcin Staroń"
    name = re.sub(r'\s*-\s*[A-Z]{2,5}\s*$', '', name).strip()

    # Rule 30: Strip "(ClubName)REPRESENT" suffix (European club events)
    # e.g. "Olivier Gonelle(Icarus Team from Montpellier)REPRESENT" → "Olivier Gonelle"
    name = re.sub(r'\([^)]+\)\s*REPRESENT\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 31: Strip "(NN ADDS) trick description" (Circle Contest format)
    # e.g. "Maxime Boucoiran (75 ADDS) Pixie whirling swirl" → "Maxime Boucoiran"
    name = re.sub(r'\s*\(\d+\s+ADDS\)\s+.*$', '', name).strip()

    # Rule 32: Strip " with N kicks (golf format)"
    # e.g. "Stefan Siegert with 16 kicks (4 under par)" → "Stefan Siegert"
    name = re.sub(r'\s+with\s+\d+\s+kicks\b.*$', '', name).strip()

    # Rule 33: Extend Rule 13 — multiple " ? " separators even without ">"
    # e.g. "Honza Weber fenix ? food prozessor ? paradox symposium whirl" → "Honza Weber"
    # Also strips trailing lowercase trick words before "?" (e.g., "Honza Weber fenix")
    if name.count(' ? ') >= 2:
        idx = name.index(' ? ')
        candidate = name[:idx].strip()
        # Strip trailing lowercase words (they're trick words, not name)
        candidate = re.sub(r'\s+[a-z]\S*(?:\s+.*)?$', '', candidate).strip()
        if candidate and candidate[0].isupper():
            name = candidate

    # Rule 34: Strip " - NN (golf tie/playoff narrative)"
    # e.g. "Dr. Mike Stefanelli - 31 (3-Way tie, 1 hole playoff)" → "Dr. Mike Stefanelli"
    name = re.sub(r'\s*-\s*\d+\.?\d*\s*\((?:3-[Ww]ay|[Tt]ie|playoff).*\).*$', '', name).strip()

    # Rule 35: Strip trailing narrative introduced by "Not played off" or "did not"
    # e.g. "Alex Zerbe Not played off; did not make cut to round 2." → "Alex Zerbe"
    name = re.sub(r'\s+(?:Not played off|did not)\b.*$', '', name).strip()

    # Rule 40: Strip "N victories" / "N victory" suffix (event leaderboard annotations)
    # e.g. "Miquel Clemente 5 victories" → "Miquel Clemente", "Grischa Tellenbach 1 victory" → "Grischa Tellenbach"
    # Also handles "N victory - N points" form
    name = re.sub(r'\s+\d+\s+victor(?:y|ies)\b.*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 41: Strip "(Location) decimal-score" suffix (Polish/Central European golf format)
    # e.g. "Mariusz Wilk (Warszawa) 97,50" → "Mariusz Wilk", "Marek Zalewski (Giżycko) 73,44" → "Marek Zalewski"
    name = re.sub(r'\s*\([^)]+\)\s*\d+[,.]\d+\s*$', '', name).strip()
    # Also handle bare decimal score at end without location: "Fred Touzelet67.4" → "Fred Touzelet"
    name = re.sub(r'\d+[.,]\d+\s*$', '', name).strip()

    # Rule 42: Strip emoji flag sequences at end of name
    # e.g. "Yassin Khateeb 🇩🇪" → "Yassin Khateeb", "Eurik Lindner 🇩🇪" → "Eurik Lindner"
    name = re.sub(r'[\U0001F1E0-\U0001F1FF]{2}\s*$', '', name).strip()

    # Rule 43: Strip trailing "N. " ordinal rank suffix (Scandinavian format)
    # e.g. "Barry Thorsen 3." → "Barry Thorsen", "Lucas 1." → "Lucas"
    name = re.sub(r'\s+\d+\.\s*$', '', name).strip()

    # Rule 44: Strip " - suffix" where suffix is a single word OR entirely lowercase
    # Handles trick names (single word: "gauntlet"), city names (single word: "Jyväskylä"),
    # and multi-word trick/score annotations (all-lowercase: "fairy eggbeater", "56 * new course record")
    # Guard: preserve multi-word suffixes with uppercase (another person like "david Butcher")
    m44 = re.search(r'\s*-\s+(.+)$', name)
    if m44:
        suffix = m44.group(1).strip()
        suffix_words = suffix.split()
        # Strip if single word (city/trick) OR all-lowercase (trick/annotation)
        if len(suffix_words) == 1 or not re.search(r'[A-Z]', suffix):
            name = name[:m44.start()].strip()

    # Rule 45: Strip dash+number without space at end: "Errol Stryker-44" → "Errol Stryker"
    # Only when digit follows dash directly (not hyphenated names like "Jean-Pierre")
    name = re.sub(r'-\d+\s*$', '', name).strip()

    # Rule 46: Strip "N pts" / "Npts" / "N pkt" score suffixes (various formats)
    # e.g. "Brad Watkins 28pts" → "Brad Watkins", "Damian Budzik 153pkt" → "Damian Budzik"
    name = re.sub(r'\s*\d+\s*p(?:ts?|kt)\.?\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 47: Strip "N Punkte" / "N Punkte ¤" (German points suffix)
    # e.g. "Stefan Nold 4 Punkte" → "Stefan Nold", "Philipp Schäfer 15 Punkte ¤" → "Philipp Schäfer"
    name = re.sub(r'\s+\d+\s+Punkte?.*$', '', name).strip()

    # Rule 48: Strip quoted trick descriptions in double quotes
    # e.g. 'Serge Kaldany "Pixie Ducking Symposium Whirl"' → "Serge Kaldany"
    name = re.sub(r'\s+"[^"]*"\s*$', '', name).strip()
    # Also handle smart/curly quotes
    name = re.sub(r'\s+[\u201c\u201d][^\u201c\u201d]*[\u201c\u201d]\s*$', '', name).strip()

    # Rule 49: Strip "[N]" bracket ordinal and unclosed "[Country" annotation
    # e.g. "Kerstin Anhuth [4] GER" → "Kerstin Anhuth GER" (then Rule 38 strips GER)
    # e.g. "Roman Gornitskiy [RUS" → "Roman Gornitskiy" (unclosed bracket with country code)
    name = re.sub(r'\s*\[\d+\]\s*', ' ', name).strip()
    # Strip unclosed "[annotation" at end (no closing bracket)
    name = re.sub(r'\s*\[[^\]]*$', '', name).strip()

    # Rule 50: Strip " \ Name" backslash-joined team member (Bulgarian events)
    # e.g. "Rossen Kyrta \ Ivan Stanev" → "Rossen Kyrta" (player2 captured separately)
    # Note: split_entry handles "\" as team separator; this handles residual "\Name" in player1
    name = re.sub(r'\s*\\\s*.*$', '', name).strip()

    # Rule 51: Strip " N points" suffix (Basque Country event format)
    # e.g. "Egoitz Campo 11 points" → "Egoitz Campo"
    name = re.sub(r'\s+\d+\s+points?\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 52: Strip "N games" suffix (net tournament format)
    # e.g. "Kevin Regamey - 4 games" → "Kevin Regamey" (dash handled by Rule 44)
    name = re.sub(r'\s+\d+\s+games?\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 53: Strip "&Word" suffix (teammate first name appended without space after "/" split)
    # e.g. "Matze Schmidt&Peter" → "Matze Schmidt" (Peter was the partner, separated via "/" split)
    name = re.sub(r'&\w+$', '', name).strip()

    # Rule 54: Strip trailing golf score "+N" (e.g. "Francois Leh +6" → "Francois Leh")
    name = re.sub(r'\s+\+\d+\s*$', '', name).strip()

    # Rule 55: Strip trailing standalone number (golf score, ranking, etc.)
    # e.g. "James Roberts 63" → "James Roberts"
    # Only strip if result still has 2+ words (don't strip the only identifier from a name)
    m55 = re.sub(r'\s+\d+\s*$', '', name).strip()
    if m55 and len(m55.split()) >= 2:
        name = m55

    # Rule 56: Strip ", Generation" suffix (Roman numeral / Jr / Sr after comma)
    # e.g. "Rob Woodhull, III" → "Rob Woodhull", "Chris Routh, Jr." → "Chris Routh"
    name = re.sub(r',\s*(Jr\.?|Sr\.?|I{1,4}|IV|VI{0,3}|VIII|IX|X|2nd|3rd)\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 28: Strip "and Nth position match" bronze-medal match descriptions
    # e.g. "and 4º position match", "and 3rd position match"
    if re.search(r'^and\s+\d', name, re.IGNORECASE):
        return ""

    # Rule 29a: Strip trailing prize-money and score annotations before junk cleanup
    # e.g. "R Lavign-$70" → "R Lavign", "Matt Quinn- $10" → "Matt Quinn"
    # e.g. "Klemens Längauer - 110,38" → "Klemens Längauer", "Rory Dawson - 102. 1" → "Rory Dawson"
    # e.g. "Y Merzouk- prize" → "Y Merzouk"
    name = re.sub(r'\s*-\s*\$\d+(?:[.,]\d+)?\s*$', '', name).strip()   # -$70, - $10
    name = re.sub(r'\s*-\s*\d+[,.]\s*\d+\s*$', '', name).strip()        # - 110,38 / - 102. 1
    name = re.sub(r'\s*-\s*prize\b.*$', '', name, flags=re.IGNORECASE).strip()  # - prize / - prize money

    # Rule 29: Strip trailing junk markers (trailing dashes, asterisks, en/em-dashes, #, _, ], =)
    # e.g. "Nick Jaros -" → "Nick Jaros", "Tim Werner ---" → "Tim Werner"
    # e.g. "Jason Varvaro-" → "Jason Varvaro", "Pattrick Schrickel*#" → "Pattrick Schrickel"
    # e.g. "Marton Lukacs (HU)]" → "Marton Lukacs (HU)", "Brendan Erskine =" → "Brendan Erskine"
    cleaned = re.sub(r'[\s\*\-–—#_\]=]+$', '', name).strip()
    if cleaned:
        name = cleaned

    # Rule 57: Strip trailing " :" (space + colon, French/European bracket format)
    # e.g. "Serge Kaldany :" → "Serge Kaldany", "Basel) :" → "Basel)"
    name = re.sub(r'\s*:\s*$', '', name).strip()

    # Rule 58: Strip trailing " ID:" (North American bracket format)
    # e.g. "Emmanuel Bouchard ID:" → "Emmanuel Bouchard"
    name = re.sub(r'\s+ID:\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 59: Strip trailing ellipsis
    # e.g. "Julia Böhm ..." → "Julia Böhm"
    name = re.sub(r'\s*\.{2,}\s*$', '', name).strip()
    name = name.rstrip('…').strip()

    # Rule 60: Strip leading period, comma, or closing paren (ordinal parsing artifacts)
    # e.g. ". Emmanuel Bouchard" → "Emmanuel Bouchard", ") Jan Struzh" → "Jan Struzh"
    # Source format "1.) Name" leaves ".) Name" after digit stripping → both chars removed
    name = re.sub(r'^[.,)]+\s*', '', name).strip()

    # Rule 60b: Strip orphaned ordinal suffix left when digit is stripped before name
    # e.g. "nd= Adrian Dick" → "Adrian Dick" (from source "2nd= Adrian Dick")
    # Handles st= / nd= / rd= / th= with optional spaces/equals
    name = re.sub(r'^(?:st|nd|rd|th)[=:\s]+', '', name, flags=re.IGNORECASE).strip()

    # Rule 61: Strip " -> trick" annotation (Finnish/European Sick 3 format)
    # e.g. "Legbeater -> Vortex" → "" (whole thing is trick list, caller discards empty)
    # e.g. player2 side: gets cleaned away so only player1 is stored
    if re.search(r'\s+->\s+', name):
        # Everything from "->" is a trick annotation; strip it
        name = re.sub(r'\s*->\s*.+$', '', name).strip()

    # Rule 62: Strip trailing comma (leftover after score-stripping rules)
    # e.g. "Andrew Coleman 24, 57, 12," → "Andrew Coleman 24, 57, 12" (then Rule 55 strips numbers)
    name = re.sub(r',\s*$', '', name).strip()

    # Rule 63: Strip "representing CLUB/TEAM" suffix (e.g. '"Nato" representing Nato\'s marauders')
    name = re.sub(r'\s+representing\s+.+$', '', name, flags=re.IGNORECASE).strip()

    # Rule 63b: Reject ordinal-fragment tokens left by "2ndPlace:" parsing
    # "2ndPlace:" → parser strips "2" ordinal → "ndPlace" or "stPlace" etc.
    if re.fullmatch(r'(?:nd|st|rd|th)[Pp]lace\.?', name):
        return ""

    # Rule 64: Strip parenthesized numeric score/count sequences
    # Multi-number: "(2,2,2,1,1,1)", "(130,4)", "(199.8333)", "( 165,33)"
    # Preserves country/city info like "(Poland)" or "(Planet Footbag Zürich, CH)"
    name = re.sub(r'\s*\(\s*\d+(?:[,. ]+\d+)+\s*\)', '', name).strip()
    # Single large number: "(8533)", "(631)", "(525)" — clearly a score/ID, not a location
    name = re.sub(r'\s*\(\s*\d{3,}\s*\)', '', name).strip()

    # Rule 65: Strip "N Drops/drops/dropless" score annotations
    # "Nils 16,5p 7 Drops" → "Nils",  "Justin 14,2 12 Drops" → "Justin"
    # "Brett Ables 290 0 drops" → "Brett Ables", "David Clavens $275 dropless" → "David Clavens"
    name = re.sub(r'\s+\d+[,.]\d+p?\s+\d+\s+[Dd]rops?\b.*$', '', name).strip()
    name = re.sub(r'\s+\d+\s+[Dd]rops?\b.*$', '', name).strip()
    name = re.sub(r'\s+\$\d+(?:[,.]\d+)?\s+[Dd]roples{1,2}\b.*$', '', name).strip()

    # Rule 66: Strip IFPA registration number annotations
    # "Daniel IFPA # 51574 Open" → "Daniel", "Sam Hogan (No IFPA # Amature" → "Sam Hogan"
    # "Ryan Morris ( No IFPA#)" → "Ryan Morris"
    name = re.sub(r'\s+IFPA\s*#?\s*\d+.*$', '', name, flags=re.IGNORECASE).strip()
    name = re.sub(r'\s*\(\s*No\s+IFPA\b.*$', '', name, flags=re.IGNORECASE).strip()
    # Strip bare "( No IFPA#)" unclosed/closed variants
    name = re.sub(r'\s*\(\s*No\s+IFPA.*?\)?\s*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 67: Strip inline ID annotations
    # "Robert McCloskey ID:12506" → "Robert McCloskey"
    name = re.sub(r'\s+ID:\s*\d+\b.*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 68: Strip bare registration/IFPA numbers with optional division suffix
    # "Jim 83027 Open" → "Jim", "Jake Dodd 82585 Open" → "Jake Dodd", "Jim 83027" → "Jim"
    name = re.sub(
        r'\s+\d{4,}\s+(Open|Amature|Amateur|Novice|Intermediate|Advanced|Pro|Masters?)\b.*$',
        '', name, flags=re.IGNORECASE).strip()
    # Bare 5+-digit number at end (safe threshold — avoids clipping 4-digit golf/net scores)
    m68 = re.sub(r'\s+\d{5,}$', '', name).strip()
    if m68:
        name = m68

    # Rule 69: Strip high-precision floating-point ratio scores
    # "Aleksi Airinen 256,9655172 138" → "Aleksi Airinen"
    name = re.sub(r'\s+\d+[,.]\d{5,}(?:\s+\d+)?$', '', name).strip()

    # Rule 70: Strip "? Event Record" / "Event Record" annotation
    # "Rob McCloskey ? Event Record" → "Rob McCloskey"
    name = re.sub(r'\s*\??\s*Event\s+Record\b.*$', '', name, flags=re.IGNORECASE).strip()

    # Rule 71: Strip bare "N ADDS" scoring suffix (Circle Contest format)
    # "French ConneXion 75 ADDS" → "French ConneXion"
    name = re.sub(r'\s+\d+\s+[Aa][Dd][Dd][Ss]\b.*$', '', name).strip()

    return name.strip()


def split_entry(entry: str, is_doubles: bool = False) -> tuple[str, Optional[str], str]:
    """
    Detect teams/multiple players separated by '/', ' and ', ' & ', commas, or dash separators.
    Returns (player1, player2, competitor_type).
    For multi-player entries (3+ comma-separated names), returns first 2 as team.
    Canonical output format uses '/' separator (handled in _build_name_line).

    Priority:
    1. " & " between names (alternative separator, checked first to handle city notation)
    2. "/" outside parentheses (most common team separator)
    3. " and " between names (word separator)
    4. "et" between names (French "and")
    5. " - ", " – ", " — " between names (dash separators: hyphen, en-dash, em-dash)
    6. Bare dash "Name1-Name2" (doubles only: both sides must be multi-word full names)
    7. ", " between multiple names (comma separator for groups - returns first 2)
    """
    entry = " ".join(entry.split()).strip()

    # Strip common prefixes that shouldn't affect team detection
    # e.g., "tie : Name1 & Name2", "(tie) Name1 / Name2", "3rd place - Name1 / Name2"
    entry_clean = re.sub(
        r'^(\(\s*tie\s*\)[.\-:\s]*|tie\s*[.:\-]?\s*|\d+\s*[.)\-:=]?\s*(st|nd|rd|th)?\s*place\s*[-:]?)\s*',
        '', entry, flags=re.IGNORECASE
    ).strip()

    # Strip ordinals WITHOUT "place" keyword: "2nd ", "3rd ", "4. ", "2nd= ", etc.
    # This handles entries like "2nd Martin Cote/ ..." that don't have the word "place"
    entry_clean = re.sub(r'^\d+\s*[.)\-:=]?\s*(st|nd|rd|th)?\s*[=]?\s*', '', entry_clean).strip()

    # Strip leading punctuation artifacts left after ordinal digit removal
    # e.g. ".) Kiss + Gyáni" → "Kiss + Gyáni" (from "1.) Kiss + Gyáni" after "1" stripped)
    entry_clean = re.sub(r'^[.)\s]+(?=[A-Za-zÀ-ÿ\u0100-\u017F"\'(])', '', entry_clean).strip()

    # Strip "d " or "d\t" prefix from ordinal parsing corruption
    entry_clean = re.sub(r'^[dD]\s+', '', entry_clean).strip()

    if not entry_clean:
        entry_clean = entry

    # Helper to validate if a name-like string looks like it could be a player name
    def looks_like_name(s):
        """Check if string looks like a player name (relaxed validation)."""
        if not s or len(s) < 2:
            return False
        # Strip leading quotes
        s_clean = s.lstrip('"\'')
        if not s_clean:
            return False
        # Must contain at least one alphabetic character and not be all numbers
        has_alpha = bool(re.search(r'[a-zA-Z]', s_clean))
        is_not_number = not re.match(r'^\d+$', s_clean.strip())
        return has_alpha and is_not_number

    # Helper to check if a "/" is inside parentheses
    def slash_outside_parens(s):
        """Find first "/" that is NOT inside parentheses."""
        depth = 0
        for i, c in enumerate(s):
            if c == '(':
                depth += 1
            elif c == ')':
                depth = max(0, depth - 1)
            elif c == '/' and depth == 0:
                return i
        return -1

    # Check for comma-separated names FIRST (before "and" split)
    # This handles cases like "Name1, Name2 and Name3" where commas are primary separator
    # We check early but not before "/" which is the most explicit team separator
    comma_count = entry_clean.count(',')

    # Try "/" outside parentheses FIRST - it's the most explicit team separator
    # e.g., "Martin Cote/ Martin Graton (the M & M?s)" should split on "/" not " & "
    slash_idx = slash_outside_parens(entry_clean)
    if slash_idx > 0:
        a = entry_clean[:slash_idx].strip()
        b = entry_clean[slash_idx + 1:].strip()
        if len(a) >= 2 and len(b) >= 2:
            return strip_trailing_score(a), strip_trailing_score(b), "team"

    # Try " \ " backslash separator (Bulgarian events use "Player1 \ Player2")
    if ' \\ ' in entry_clean:
        a, b = entry_clean.split(' \\ ', 1)
        a_clean = strip_trailing_score(a.strip())
        b_clean = strip_trailing_score(b.strip())
        if looks_like_name(a_clean) and looks_like_name(b_clean):
            return a_clean, b_clean, "team"

    # Try "+" as team separator (European events: "Player1 + Player2" or "Player1+Player2")
    # Requires both sides to start with uppercase to avoid false splits on scores/annotations
    if '+' in entry_clean:
        parts = entry_clean.split('+', 1)
        a_clean = strip_trailing_score(parts[0].strip())
        b_clean = strip_trailing_score(parts[1].strip())
        if (looks_like_name(a_clean) and looks_like_name(b_clean) and
                a_clean[:1].isupper() and b_clean[:1].isupper()):
            return a_clean, b_clean, "team"

    # Try " ? " as team separator (French/European doubles events use "?" between player names)
    # e.g., "Martin Cote ? Martin Graton" (1235653935 11th Euro)
    # NOTE: also used in freestyle singles as "Name ? Trick" — only activate for doubles context
    if is_doubles and ' ? ' in entry_clean:
        parts = entry_clean.split(' ? ', 1)
        a_clean = strip_trailing_score(parts[0].strip())
        b_clean = strip_trailing_score(parts[1].strip())
        if looks_like_name(a_clean) and looks_like_name(b_clean):
            return a_clean, b_clean, "team"

    # Try "&" without surrounding spaces (e.g., "Matze Schmidt&Peter")
    if '&' in entry_clean and ' & ' not in entry_clean:
        parts = entry_clean.split('&', 1)
        a_clean = strip_trailing_score(parts[0].strip())
        b_clean = strip_trailing_score(parts[1].strip())
        if looks_like_name(a_clean) and looks_like_name(b_clean):
            return a_clean, b_clean, "team"

    # Try " & " second - it's often used when "/" appears in city/country notation
    if " & " in entry_clean:
        a, b = entry_clean.split(" & ", 1)
        a_clean = strip_trailing_score(a.strip())
        b_clean = strip_trailing_score(b.strip())
        # Validate: both parts should look like names (relaxed: lowercase names, quoted names OK)
        if looks_like_name(a_clean) and looks_like_name(b_clean):
            return a_clean, b_clean, "team"

    # " and " between two names (case insensitive)
    # Be careful not to match "and" within names like "Alexandra"
    # Special handling: if entry has commas AND "and", check if left side of "and" has commas
    # This handles "Name1, Name2 and Name3" format
    and_match = re.search(r'\s+and\s+', entry_clean, re.IGNORECASE)
    if and_match:
        a = entry_clean[:and_match.start()].strip()
        b = entry_clean[and_match.end():].strip()
        a_clean = strip_trailing_score(a)
        b_clean = strip_trailing_score(b)
        # Validate both parts look like names (relaxed: accept lowercase, quoted names)
        # Note: "and" can separate real names or be part of a single team name with nickname
        if looks_like_name(a_clean) and looks_like_name(b_clean):
            # If 'a' has commas (multiple names), try to split on comma first
            if ',' in a_clean and a_clean.count(',') >= 1:
                a_parts = [p.strip() for p in a_clean.split(',')]
                # Don't split if parts[1] is a name suffix (Roman numeral, Jr., Sr.)
                # e.g. "David Bernard, III and Andy Ronald" → p1="David Bernard, III", p2="Andy Ronald"
                _SUFFIX_RE = re.compile(r'^(Jr\.?|Sr\.?|II|III|IV|V|VI|VII|VIII|IX|X|2nd|3rd)$', re.IGNORECASE)
                if len(a_parts) == 2 and _SUFFIX_RE.match(a_parts[1].strip()):
                    return a_clean, b_clean, "team"
                # Use first comma-separated part as player1, rest + b as player2
                if len(a_parts) >= 2 and len(a_parts[0]) >= 2:
                    p1 = strip_trailing_score(a_parts[0])
                    # Reconstruct player2: remaining commas + "and" part
                    remaining = ', '.join(a_parts[1:]) + ' and ' + b_clean
                    p2_clean = strip_trailing_score(remaining)
                    if len(p2_clean) >= 2:
                        return p1, p2_clean, "team"
            return a_clean, b_clean, "team"

    # "et" / "og" / "und" / "y" separator (French "and", Danish/Norwegian "og", German "und",
    # Spanish "y"). Requires both sides to start with a capital letter.
    et_match = re.search(r'\s+(?:et|og|und|y)\s+', entry_clean, re.IGNORECASE)
    if et_match:
        a = entry_clean[:et_match.start()].strip()
        b = entry_clean[et_match.end():].strip()
        a_first = a[:1] if a else ''
        b_first = b[:1] if b else ''
        # Validate both parts look like names (at least 2 chars each, start with capital)
        if (len(a) >= 2 and len(b) >= 2 and
            a_first.isupper() and b_first.isupper()):
            return strip_trailing_score(a), strip_trailing_score(b), "team"

    # Dash separator (common in Spanish/Portuguese events)
    # Check for " - ", " – " (en-dash), or " — " (em-dash) between two names
    # Be careful not to match dashes in prefixes like "3rd place - Name"
    # or in hyphenated names like "Jean-Pierre"
    # Matches: hyphen-minus (U+002D), en-dash (U+2013), em-dash (U+2014)
    dash_match = re.search(r'\s+[-–—]\s+', entry_clean)
    if dash_match:
        a = entry_clean[:dash_match.start()].strip()
        b = entry_clean[dash_match.end():].strip()
        a_first = a[:1] if a else ''
        b_first = b[:1] if b else ''
        # Validate both parts look like names (at least 2 chars each, start with capital)
        # Also ensure 'a' doesn't look like an ordinal (e.g., "1st", "2nd", "3rd")
        ordinal_pattern = r'^\d+(st|nd|rd|th)?$'
        if (len(a) >= 2 and len(b) >= 2 and
            a_first.isupper() and b_first.isupper() and
            not re.match(ordinal_pattern, a, re.IGNORECASE)):
            return strip_trailing_score(a), strip_trailing_score(b), "team"

    # Bare-dash separator for doubles divisions: "Name1-Name2" (no spaces around dash)
    # Heuristic: if BOTH sides of a bare dash are multi-word (contain a space), it's
    # likely a team separator rather than a hyphenated single name (e.g., "Jean-Pierre").
    # Guards: both sides must have ≤5 words (rejects narrative text) and no bare digits.
    # Only activated when is_doubles=True to avoid false splits in singles events.
    if is_doubles and '-' in entry_clean:
        _digit_re = re.compile(r'(?<!\()\b\d+\b(?!\))')  # digits outside parentheses
        for i, c in enumerate(entry_clean):
            if c != '-' or i == 0:
                continue
            left = entry_clean[:i].strip()
            right = entry_clean[i + 1:].strip()
            left_words = left.split()
            right_words = right.split()
            if (' ' in left and ' ' in right
                    and len(left_words) <= 5 and len(right_words) <= 5
                    and len(left) >= 4 and len(right) >= 4
                    and looks_like_name(left) and looks_like_name(right)
                    and not _digit_re.search(left) and not _digit_re.search(right)):
                return strip_trailing_score(left), strip_trailing_score(right), "team"

    # "Name (ST) Name" or "Name (ST) Name (ST)" — state/province code doubles pattern
    # e.g., "John Smith (BC) Jane Doe (AB)" (event 886044392 Vancouver 1998)
    # Only activate for doubles to avoid splitting "Paul (PT) Lovern" in singles.
    # Also require the first name has at least 2 words before the state code.
    if is_doubles:
        _sc_re = re.compile(r'^(.+?\([A-Z]{2}\))\s+([A-Z].+)$')
        sc_match = _sc_re.match(entry_clean)
        if sc_match:
            first_part = sc_match.group(1).strip()
            # Name before the state code must have a space (i.e., "First Last", not "Paul")
            name_before_code = re.sub(r'\s*\([A-Z]{2}\)\s*$', '', first_part).strip()
            if ' ' in name_before_code:
                a_clean = strip_trailing_score(first_part)
                b_clean = strip_trailing_score(sc_match.group(2).strip())
                if looks_like_name(a_clean) and looks_like_name(b_clean):
                    return a_clean, b_clean, "team"

    # Comma-separated names (for multi-player entries like Circle Contest)
    # e.g., "Paweł Nowak, Paweł Ścierski, Krzysztof Sobótka, Sylwia Kocyk (Poland)"
    # Split on comma, but exclude commas that look like location info (e.g., "City, Country")
    # Heuristic: If entry has 3+ comma-separated parts and most look like names, split them
    if ',' in entry_clean:
        # First remove trailing location info like "(Poland)" before splitting
        entry_no_location = re.sub(r'\s*\([^)]*\)\s*$', '', entry_clean).strip()

        if ',' in entry_no_location:
            parts = [p.strip() for p in entry_no_location.split(',')]

            # Check if this looks like a multi-player entry vs "City, Country" format
            # Multi-player: most parts start with capital letter (names)
            # City,Country: 2 parts, second is usually short (country code or country name)
            capital_count = sum(1 for p in parts if p and p[0].isupper())

            # If we have 3+ parts that look like names (start with capital), treat as multi-player
            if len(parts) >= 3 and capital_count >= 3:
                # Multi-player entry: return first two as "team"
                p1 = strip_trailing_score(parts[0])
                p2 = strip_trailing_score(parts[1])
                if len(p1) >= 2 and len(p2) >= 2:
                    return p1, p2, "team"
            elif len(parts) == 2 and capital_count >= 2:
                # Two-part comma entry (less common, might be "Name, Country" or "Name, Name")
                # Only treat as team if both parts are reasonable name lengths (3+ chars)
                p1 = strip_trailing_score(parts[0])
                p2 = strip_trailing_score(parts[1])
                # Guard: if not a doubles division and right part is a single word,
                # this is "Last, First" European naming format — treat as single player.
                # e.g., "Daouk, Karim", "Belouin Ollivier, Boris", "Markkanen, Jani"
                # Return the full "Last, First" token to preserve UUID mapping in identity lock.
                if not is_doubles and ' ' not in p2:
                    return strip_trailing_score(entry_clean), None, "player"
                # Check if both parts look like names (not location info)
                # Location format: short country code (2-3 chars) or country names
                # Names are typically 3+ chars, contain letters, may have accents
                if (len(p1) >= 3 and len(p2) >= 3 and
                    p1[0].isupper() and p2[0].isupper() and
                    not re.match(r'^[A-Z]{2,3}$', p2)):  # Not a country code like "POL"
                    return p1, p2, "team"

    return strip_trailing_score(entry), None, "player"


def split_merged_team(entry: str) -> tuple[str, Optional[str], str]:
    """
    Split merged team entry format: "Player1 [seed] COUNTRY Player2 COUNTRY"

    Examples:
      "Emmanuel Bouchard [1] CAN Florian Goetze GER" -> ("Emmanuel Bouchard", "Florian Goetze", "team")
      "Matti Pohjola [6] FIN Janne Uusitalo FIN" -> ("Matti Pohjola", "Janne Uusitalo", "team")

    Returns (player1, player2, competitor_type) or (entry, None, "player") if no match.
    """
    # Pattern: Name1 [optional seed] COUNTRY Name2 COUNTRY
    # The seed is optional, country codes are 3 uppercase letters
    pattern = re.compile(
        r'^(.+?)\s*'              # Player 1 name (non-greedy)
        r'(?:\[\d+\])?\s*'        # Optional seed in brackets
        r'([A-Z]{3})\s+'          # Country code 1
        r'(.+?)\s+'               # Player 2 name (non-greedy)
        r'([A-Z]{3})$'            # Country code 2
    )

    match = pattern.match(entry.strip())
    if match:
        p1_name, p1_country, p2_name, p2_country = match.groups()
        # Validate both country codes are known
        if p1_country in VALID_COUNTRY_CODES and p2_country in VALID_COUNTRY_CODES:
            return p1_name.strip(), p2_name.strip(), "team"

    # No match - return original as single player
    return entry, None, "player"


def try_split_merged_team(line: str) -> tuple[str, str] | None:
    """
    Generic detector for merged team format: "Name [seed] CCC Name CCC"
    
    Returns (player1_name, player2_name) if detected, None otherwise.
    Only matches if both country codes are valid and both names look name-ish.
    """
    m = _RE_MERGED_TEAM.match(line.strip())
    if not m:
        return None
    c1, c2 = m.group("c1"), m.group("c2")
    if c1 not in VALID_COUNTRY_CODES or c2 not in VALID_COUNTRY_CODES:
        return None
    p1 = m.group("p1").strip()
    p2 = m.group("p2").strip()
    # Require both sides to look name-ish (avoid accidental splits)
    if len(p1) < 3 or len(p2) < 3:
        return None
    return p1, p2


def try_split_ampersand_team(line: str) -> tuple[str, str] | None:
    """
    Split 'Name1 & Name2' safely WITHOUT mutating the original line unless split is valid.
    Also strips a trailing country code from the full line first (e.g., '... GER').
    """
    if not isinstance(line, str):
        return None
    s = line.strip()
    if "&" not in s:
        return None
    if "/" in s:
        return None  # higher-trust separator; don't compete

    # strip trailing country code from whole line first (e.g., "... GER")
    s2 = strip_trailing_country_code(s)

    # require exactly one ampersand separator (any spacing)
    parts = _RE_AMP_TEAM.split(s2)
    if len(parts) != 2:
        return None

    left, right = parts[0].strip(), parts[1].strip()

    # conservative "name-ish" guards
    def looks_like_name(x: str) -> bool:
        if len(x) < 3:
            return False
        if any(ch.isdigit() for ch in x):
            return False
        low = x.lower()
        if "http" in low or "www" in low or "@" in x:
            return False
        # require at least two tokens (first+last) to avoid "Team & Club" junk
        toks = [t for t in x.split() if t]
        return len(toks) >= 2

    if not (looks_like_name(left) and looks_like_name(right)):
        return None

    return left, right


def infer_division_from_event_name(event_name: str, placements: list = None, event_type: str = None) -> Optional[str]:
    """
    Infer division from event name, placement patterns, and event type when no division headers are present.

    Examples:
      "Finnish Singles Net Footbag Championships" -> "Open Singles Net"
      "Basque Tournament of Footbag Net (Individual)" -> "Open Singles Net"
      "Colorado Shred Symposium" -> "Open Shred"
      Event with team entries (Name & Name) -> doubles
    """
    name_lower = event_name.lower()
    placements = placements or []
    event_type = (event_type or "").lower()

    # Check for singles/doubles in event name
    has_singles = "singles" in name_lower or "individual" in name_lower or "single" in name_lower
    has_doubles = "doubles" in name_lower or "double" in name_lower

    # If we have placements, check if they look like teams (doubles) or individuals (singles)
    if placements and not has_singles and not has_doubles:
        team_count = sum(1 for p in placements if p.get("competitor_type") == "team")
        player_count = sum(1 for p in placements if p.get("competitor_type") == "player")
        if team_count > player_count:
            has_doubles = True
        elif player_count > team_count:
            has_singles = True

    # Check for net (in name or event_type)
    is_net = "net" in name_lower or event_type == "net"
    if is_net:
        if has_singles and not has_doubles:
            return "Open Singles Net"
        elif has_doubles and not has_singles:
            return "Open Doubles Net"
        # Just "net" without clear singles/doubles
        # Default to singles if all entries are individual players
        if placements and all(p.get("competitor_type") == "player" for p in placements):
            return "Open Singles Net"
        elif placements and all(p.get("competitor_type") == "team" for p in placements):
            return "Open Doubles Net"
        return None

    # Check for freestyle disciplines
    is_freestyle = "freestyle" in name_lower or event_type == "freestyle"
    if "shred" in name_lower:
        return "Open Shred"
    if "routine" in name_lower:
        return "Open Routines"
    if "circle" in name_lower:
        return "Open Circle"
    if is_freestyle:
        if has_singles:
            return "Open Singles Freestyle"
        elif has_doubles:
            return "Open Doubles Freestyle"
        return "Open Freestyle"

    # Check for known tournament name patterns
    if "king of the hill" in name_lower:
        return "Open Singles Net"  # Always singles knockout format
    if "bembel cup" in name_lower:
        return "Open Doubles Net"  # Always doubles tournament

    # For mixed events with placements but no clear keywords, infer from competitor type
    # This handles events like "IFPA Turku Open", "Bedford Championships", etc.
    if event_type == "mixed" and placements:
        # Check if all placements are teams or all are players
        team_count = sum(1 for p in placements if p.get("competitor_type") == "team")
        player_count = sum(1 for p in placements if p.get("competitor_type") == "player")

        # If predominantly one type, infer division
        if team_count > 0 and player_count == 0:
            # All teams - likely doubles net (default for mixed events)
            return "Open Doubles Net"
        elif player_count > 0 and team_count == 0:
            # All players - likely singles net (default for mixed events)
            return "Open Singles Net"

    return None


# ------------------------------------------------------------
# Parsing helpers for filtering junk lines
# ------------------------------------------------------------
_RE_CONTINUATION = re.compile(r"^\s*&\s*\d+\s*\.\s*")     # "& 5."
_RE_STARTS_AMP   = re.compile(r"^\s*&\s*")               # "& ..."
_RE_MULTI_NAME_COMMA = re.compile(r",\s*[A-Z][a-z]+")    # "..., John" (very rough)

# Detect "continued placement numbering" lines like:
# "4. & 5. Name", "5.&6. Name", "16, 17.&18. Name"
_RE_PLACEMENT_CONTINUATION = re.compile(
    r"(^|\s)\d+\s*[\.,)]\s*&\s*\d+\s*[\.,)]"    # "4. & 5." or "5.&6."
)

def is_continuation_or_junk_result_line(s: str) -> bool:
    t = (s or "").strip()
    if not t:
        return True

    # strong signal: lines that begin with "&" are almost always continuations / commentary
    if _RE_STARTS_AMP.match(t):
        return True

    return False

def _is_trick_name_line(s: str) -> bool:
    """True if s looks like a standalone freestyle trick name (not a player or division).

    Matches entries like "LEG OVER.", "BLURRY WHIRL", "DOBLE LEG OVER".
    These appear as performance annotations after the player name in some
    South-American result formats and should be dropped.

    Trick words inside parentheses are annotating a player entry and must NOT
    trigger this check — e.g. "Will Digges (Pixie Paradon Swirl)" is a player.
    We strip parenthetical content before testing.
    """
    # Remove parenthetical trick annotations (e.g. "(Pixie Paradon Swirl)")
    # before testing, so that "Name (trick)" is not falsely rejected.
    stripped = re.sub(r'\([^)]*\)', '', s).strip().rstrip('.')
    # If removing parens leaves only the trick content, the original was a bare trick line
    low_s = stripped.lower()
    return any(re.search(r'\b' + re.escape(tw) + r'\b', low_s) for tw in TRICK_NAME_WORDS)


def _arrow_outside_parens(s: str) -> bool:
    """True if ' > ' appears outside of balanced parentheses.

    Used to distinguish trick-sequence entries like
    "Diving Clipper > Spinning Clipper > Paradox" (skip)
    from annotated player entries like
    "Will Digges (Alpine Blurry > Janiwalker)" (keep — trick info is parenthetical).
    """
    depth = 0
    i = 0
    while i < len(s):
        if s[i] == '(':
            depth += 1
        elif s[i] == ')':
            depth = max(0, depth - 1)
        elif depth == 0 and s[i:i+3] == ' > ':
            return True
        i += 1
    return False


def looks_like_person_name(s: str) -> bool:
    t = (s or "").strip()
    if not t:
        return False
    if t.startswith("(") or t.startswith("["):
        return False
    tu = t.upper()
    import re as _re
    if any(_re.search(r'\b' + x + r'\b', tu) for x in ("POOL", "RANK", "RANKING", "FINAL RESULTS", "RESULTS:", "SCORES")):
        return False
    # Reject section-count noise parsed as player names
    if any(tu == x or tu.startswith(x + " ") or tu.startswith(x + ":") for x in (
            "SQUARE", "SQUARES", "COMPETITORS", "TEAMS", "BENEFACTORS",
            "TOTAL REGISTERED", "TOTAL COMPETITORS", "4 PLACES", "6 PLACES")):
        return False
    # Reject known commentary / scoring-header phrases (shared with _BAD_PHRASES)
    if any(p in tu for p in _BAD_PHRASES):
        return False
    # must contain letters
    if not any(ch.isalpha() for ch in t):
        return False
    return True


def parse_results_text(results_text: str, event_id: str, event_type: str = None) -> list[dict]:
    """
    Parse results text into structured placements.
    Returns list of placement dicts with confidence scoring.

    Args:
        results_text: Raw results text to parse
        event_id: Event identifier
        event_type: Event type for context (net, freestyle, etc.) - used to disambiguate divisions
    """
    placements = []
    division_raw = "Unknown"
    rejected_division_headers = 0

    # Normalize results_text: replace non-breaking spaces with regular spaces
    # Non-breaking spaces (\xa0, \u00a0) can break pattern matching
    if results_text:
        results_text = results_text.replace('\xa0', ' ').replace('\u00a0', ' ')

        # NEW: split embedded division headers that appear mid-line (common in Worlds pages)
        # Example: "... 70 74 144 open doubles net results 1. Randy ..."
        # becomes: "... 70 74 144\nopen doubles net results\n1. Randy ..."
        results_text = re.sub(
            r'(?i)(\S)\s+((?:women\'?s|womens|men\'?s|mens|mixed|open|intermediate|masters)\s+'
            r'(?:intermediate\s+)?(?:singles|doubles)\s+net\s+results\b)',
            r'\1\n\2',
            results_text
        )

    # Get event-specific parsing rules
    event_rules = EVENT_PARSING_RULES.get(str(event_id), {})
    use_merged_team_split = event_rules.get("split_merged_teams", False)

    pre_parse_fixup = event_rules.get("pre_parse_fixup")
    if pre_parse_fixup == "ordinal_inline_divisions":
        results_text = fixup_ordinal_inline_divisions(results_text)
    elif pre_parse_fixup == "us_open_2023":
        results_text = fixup_us_open_2023(results_text)
    elif pre_parse_fixup == "worlds_2024_doubles":
        results_text = fixup_worlds_2024_doubles(results_text)
    elif pre_parse_fixup == "two_column_oregon_1997":
        results_text = fixup_two_column_oregon_1997(results_text)
    elif pre_parse_fixup == "nz_champs_2000":
        results_text = fixup_nz_champs_2000(results_text)
    elif pre_parse_fixup == "heart_of_footbag_1997":
        results_text = fixup_heart_of_footbag_1997(results_text)

    # Track whether we're in a seeding section (should skip these entries)
    in_seeding_section = False

    # Track whether we're in a logistical/announcement section (attendees, hotel, etc.)
    # Resets when a recognised division header or numeric placement line appears.
    in_noise_section = False

    place_re = re.compile(r"^\s*(\d{1,3})\s*[.)\-:]?\s*(.+)$")
    # Pattern for ordinal placements like "1ST Name", "2ND Name", "1st: Name", "2nd: Name"
    ordinal_re = re.compile(r"^\s*(\d{1,2})(ST|ND|RD|TH):?\s+(.+)$", re.IGNORECASE)
    # Pattern for tied placements like "23/24 Name" - captures the tie suffix
    tied_place_re = re.compile(r"^/\d+\s+(.+)$")
    # Pattern for multi-line ordinal: place indicator on its own line, name on next line
    # English: "1st Place", "2nd Place"
    # Spanish: "1° LUGAR", "2°", "1º", "1er LUGAR", "2do LUGAR"
    multiline_ordinal_re = re.compile(
        r"^\s*(\d{1,2})\s*"
        r"(?:"
        r"(?:st|nd|rd|th)\s+place"                          # English: "1st Place"
        r"|"
        r"[°º]\s*(?:lugar|puesto|place)?"                   # Spanish: "1° LUGAR", "1°", "1º"
        r"|"
        r"(?:er|do|ro|to|ta)\s*(?:lugar|puesto|place)?"     # Spanish text: "1er LUGAR", "2do"
        r")\s*$", re.IGNORECASE)

    # Pending place from multi-line ordinal format ("1st Place\nName")
    pending_place = None

    # Pending division: when we see "Division Header" with no inline name,
    # we expect the next line might be a bare player name (e.g., "Lee Van Sickle")
    pending_division = None

    # Flag to indicate that place/entry_raw have been set by bare name or inline detection
    # (skip ordinal/place regex parsing in this case)
    placement_already_parsed = False

    # Track placement index for debugging
    placement_index = 0

    for raw_line in (results_text or "").splitlines():
        t = (raw_line or "").strip("\n")

        t = (t or "").strip()

        if _RE_PLACEMENT_CONTINUATION.search(t):
            if str(event_id) in {"857881519", "990905420"}:
                print("SKIP CONTINUATION", event_id, repr(t[:120]))
            continue

        # DEBUG: show what the line really starts with for the two problem events
        if str(event_id) in {"857881519", "990905420"} and "&" in t[:10]:
            print("DEBUG LINE PREFIX", event_id, [hex(ord(ch)) for ch in t[:8]], repr(t[:80]))

        # robust skip: strip common "weird spaces" too
        t2 = t.lstrip(" \t\r\n\u00a0\u2007\u202f\ufeffÂ")
        if t2.startswith("&"):
            continue

        line = t.strip()
        if not line:
            continue

        # skip divider/section markup lines
        if line.startswith("<<<") or line.startswith("---"):
            continue

        # Reset placement parsing flag at start of loop
        placement_already_parsed = False

        # Normalize range-style placements (e.g., "9.-12. Player" -> "9. Player")
        # Handles tied placements shown as ranges where each player gets the same line
        # Examples: "9.-12. Wiktor Debski", "13.-16. Jindrich Smola", "17.-20. Alexander Trenner"
        # Pattern: <start>.-<end>. <player> where start is the lower place number
        line = re.sub(r'^(\s*\d{1,3})\.-\d{1,3}\.', r'\1.', line)

        # Detect seeding vs results sections (skip seeding data)
        line_lower = line.lower()

        # Check for division headers that include "- Initial Seeding" or "- Final Results"
        # e.g., "Open Routines - Initial Seeding", "Open Battles - Complete Results"
        if " - " in line and looks_like_division_header(line.split(" - ")[0].strip()):
            candidate = line.split(" - ")[0].strip()
            if is_valid_division_label(candidate):
                suffix = line.split(" - ", 1)[1].lower() if " - " in line else ""
                if "seeding" in suffix:
                    in_seeding_section = True
                    division_raw = candidate
                    continue
                elif "result" in suffix or "final" in suffix or "complete" in suffix:
                    in_seeding_section = False
                    division_raw = candidate
                    continue
            else:
                rejected_division_headers += 1
                continue

        # Standalone seeding section markers
        # Includes common misspellings: "seddings" (seen in Colombian events)
        if line_lower.rstrip(':') in ("initial seeding", "seeding", "seedings",
                                       "seddings", "seeds"):
            in_seeding_section = True
            continue

        # "Results" or "Results Pool X" or "Final Results" etc. indicate actual results
        if (line_lower.startswith("results") or
            line_lower == "final standings" or
            line_lower.startswith("final results") or
            "final" in line_lower and "standing" in line_lower):
            in_seeding_section = False
            # Don't continue - this might be a division header like "Results Pool A"
            if looks_like_division_header(line):
                candidate = line.rstrip(":")
                if is_valid_division_label(candidate):
                    division_raw = candidate
                else:
                    rejected_division_headers += 1
                continue

        # Detect logistical/announcement section headers (e.g. "ATTENDEES:", "HOTEL:")
        # A noise-section header is a short ALL-CAPS or Title-Case line ending in ":"
        # whose stripped lowercase matches NOISE_SECTION_HEADERS.
        _noise_candidate = line.rstrip(":").strip().lower()
        if line.endswith(":") and _noise_candidate in NOISE_SECTION_HEADERS:
            in_noise_section = True
            continue

        # A recognized division header or a numeric placement line exits noise-skip mode.
        # Require an explicit separator for numeric lines (avoids street addresses like
        # "175 Jefferson Road" triggering an exit). Division headers must end with ":"
        # to avoid attendee names containing division keywords (e.g. "Dan Cyr (Intermediate: Sick 1)")
        # from prematurely ending the skip.
        if in_noise_section:
            # Allow "1. Name" / "1) Name" / "1- Name" / "1: Name" but NOT "3:00 pm".
            # When separator is ":", require next char to NOT be a digit (avoids HH:MM times).
            _has_placement = (
                bool(re.match(r"^\s*\d{1,3}\s*[.)\-]\s*\S", line))
                or bool(re.match(r"^\s*\d{1,3}\s*:\s*(?!\d)\S", line))
            )
            _is_div_header = (line.endswith(":")
                              and looks_like_division_header(line.rstrip(":").strip())
                              and line.rstrip(":").strip().lower() not in NOISE_SECTION_HEADERS)
            if _has_placement or _is_div_header:
                in_noise_section = False
            else:
                continue

        # Skip entries in seeding sections (these are pre-tournament rankings, not results)
        if in_seeding_section:
            continue

        # Multi-line ordinal: "1st Place" on its own line, name on next line
        multiline_match = multiline_ordinal_re.match(line)
        if multiline_match:
            pending_place = int(multiline_match.group(1))
            continue

        # If we have a pending place from "Xth Place" line, this line is the name
        if pending_place is not None:
            # This line should be the player/team name
            entry_raw = line
            place = pending_place
            pending_place = None
            # Skip if it looks like a division header (not a player name)
            if looks_like_division_header(line):
                div_text = line.rstrip(":")
                if is_valid_division_label(div_text):
                    abbrev = div_text.lower()
                    if abbrev in ABBREVIATED_DIVISIONS:
                        division_raw = ABBREVIATED_DIVISIONS[abbrev]
                    else:
                        division_raw = div_text
                    in_seeding_section = False
                else:
                    rejected_division_headers += 1
                continue
            # Fall through to player name processing below
            # (skip the normal place/ordinal parsing)
        else:
            # Check if we're waiting for a bare player name after a division header
            if pending_division is not None and not looks_like_division_header(line):
                # Line doesn't look like a division header
                # Check if it looks like a bare player name
                # Conservative criteria to minimize false positives:
                # 1. Starts with uppercase letter (after stripping leading dash/whitespace)
                # 2. Doesn't start with digit (not a score/time)
                # 3. Reasonable length (not a long URL or narrative)
                # 4. Must have at least one space (First Last format, not single acronym)
                # 5. Must have balanced parentheses (names can have (CZE) but not unmatched parens)
                # 6. No URL-like patterns (://, www., @)
                # 7. No problematic punctuation at line level (;, or multiple commas)

                is_potential_name = False
                # Strip leading dash and whitespace for name validation
                # (e.g., "-Scott Bevier" -> "Scott Bevier")
                line_stripped = re.sub(r'^-\s*', '', line).strip()

                if (line_stripped and line_stripped[0].isupper() and
                    not re.match(r'^\d', line_stripped) and
                    3 <= len(line_stripped) < 70 and  # Tighter length: 3-70 chars (was 100)
                    ' ' in line_stripped and  # Must have space (First Last pattern)
                    not re.search(r'://|www\.|@', line_stripped) and  # No URL patterns
                    line_stripped.count('(') == line_stripped.count(')') and  # Balanced parentheses
                    ';' not in line_stripped and  # No semicolons
                    line_stripped.count(',') <= 1):  # At most one comma (e.g., "Name, Country")

                    # Additional check: must have at least 2 words starting with uppercase
                    words = line_stripped.split()
                    uppercase_words = [w for w in words if w and w[0].isupper()]
                    if len(uppercase_words) >= 2:
                        # Verify it looks like a name, not narrative
                        # Real names: mostly letters, maybe punctuation in parens
                        # Narrative: will have articles, verbs, lowercase-starting words
                        lower_words = [w for w in words if w and w[0].islower()]
                        # Allow up to 1 lowercase word (like "van", "de", "von" in names)
                        if len(lower_words) <= 1:
                            is_potential_name = True

                if is_potential_name:
                    # This looks like a bare player name
                    place = 1  # Implied first place
                    entry_raw = line_stripped  # Use stripped version to remove leading dash
                    division_raw = pending_division
                    pending_division = None
                    placement_already_parsed = True
                    # Fall through to player name processing below
                else:
                    # Not a bare name - reset pending_division and continue with normal parsing
                    pending_division = None
                    # Continue below with normal division header and placement checks

            # --- NEW: handle inline "Division ... 1. Name" without colon ---
            # e.g. "Open Singles Net Results 1. Emmanuel Bouchard"
            handled_inline_div_place = False
            m_inline = re.match(r"^(?P<div>.+?)\s+(?P<place>\d{1,3}\s*[.)])\s+(?P<name>.+)$", line.strip())
            if m_inline:
                div_part = m_inline.group("div").strip().rstrip(":")
                name_part = m_inline.group("name").strip()
                # Only accept if the div part really looks like a division header
                if looks_like_division_header(div_part) and is_valid_division_label(div_part):
                    # set current division
                    abbrev = div_part.lower().rstrip(":")
                    if abbrev in ABBREVIATED_DIVISIONS:
                        division_raw = ABBREVIATED_DIVISIONS[abbrev]
                    else:
                        division_raw = div_part

                    in_seeding_section = False
                    pending_division = None
                    pending_place = None

                    # now treat the rest as a normal placement line
                    place = int(re.sub(r"\D+", "", m_inline.group("place")))
                    entry_raw = name_part
                    placement_already_parsed = True
                    handled_inline_div_place = True
                    # fall through into your existing player/team parsing block

            # --- NEW: inline "Division ... Results 1. Name" (no colon / no newline) ---
            # Examples:
            #   "Womens Singles Net Results 1. Lisa McDaniel ..."
            #   "276 Open Singles Net Results 1. Emmanuel Bouchard ..."
            m_inline = re.match(
                r"^(?:(?P<prefix>\d{1,4})\s+)?(?P<div>.+?)\s+(?P<place>\d{1,3})\s*[.)]\s+(?P<rest>.+)$",
                line.strip()
            )
            if m_inline:
                div_part = m_inline.group("div").strip().rstrip(":")
                place_num = m_inline.group("place").strip()
                rest = m_inline.group("rest").strip()

                # Normalize away boilerplate suffix that isn't part of the division identity
                div_part = re.sub(r"\s+(final\s+)?results\s*$", "", div_part, flags=re.IGNORECASE).strip()

                # Only accept if the div-part looks like a real division header
                if looks_like_division_header(div_part):
                    division_raw = div_part
                    pending_division = None
                    pending_place = None
                    in_seeding_section = False

                    # Rewrite the current line into a standard placement line
                    line = f"{place_num}. {rest}"
                    # IMPORTANT: do NOT 'continue' — fall through so existing placement parsing runs

            # Check for bold-style division headers (common in manually entered results)
            # e.g., "**Intermediate Singles**" or text that was in <b> tags
            if not handled_inline_div_place and looks_like_division_header(line):
                pending_place = None  # Reset pending place on division change

                # Handle "Division: Name" inline format
                # e.g., "4-Square: Lee Van Sickle", "Open Doubles Net: Matthew Johns & Emily Johns"
                # But NOT "Open Singles:" (trailing colon with no name after)
                inline_name = None
                if ':' in line:
                    div_part, _, name_part = line.partition(':')
                    name_part = name_part.strip()
                    # Only treat as inline if name_part looks like a person name
                    # (has Firstname Lastname pattern) and isn't a sub-header
                    if (name_part and re.search(r'[A-Z][a-z]+\s+[A-Z]', name_part)
                            and not looks_like_division_header(name_part)):
                        inline_name = name_part
                        line_for_div = div_part.strip()
                    else:
                        line_for_div = line.rstrip(":")
                else:
                    line_for_div = line.rstrip(":")

                if is_valid_division_label(line_for_div):
                    # Expand abbreviated divisions (e.g., "OSN" -> "Open Singles Net")
                    abbrev = line_for_div.lower()
                    if abbrev in ABBREVIATED_DIVISIONS:
                        division_raw = ABBREVIATED_DIVISIONS[abbrev]
                    else:
                        division_raw = line_for_div
                    # Reset seeding flag when we hit a new division
                    in_seeding_section = False

                    if inline_name:
                        # Treat inline name as implied 1st place
                        place = 1
                        entry_raw = inline_name
                        placement_already_parsed = True
                        # Fall through to player name processing below
                    else:
                        # No inline name - next line might be a bare player name
                        # Set pending_division flag so next line is checked for bare name
                        pending_division = division_raw
                        continue
                else:
                    # Reject as division header; treat as non-division text (skip this line)
                    rejected_division_headers += 1
                    continue

            else:
                # Try ordinal format first (1ST, 2ND, 3RD, 4TH, etc.)
                # Skip this if we already parsed place/entry_raw from bare name or inline format
                if not placement_already_parsed:
                    ordinal_match = ordinal_re.match(line)
                    if ordinal_match:
                        place = int(ordinal_match.group(1))
                        entry_raw = ordinal_match.group(3).strip()
                    else:
                        m = place_re.match(line)
                        if not m:
                            continue
                        place = int(m.group(1))
                        entry_raw = m.group(2).strip()

            # Strip ordinal suffix if entry starts with it (from "1ST" parsed as "1" + "ST Name")
            # Handle: "ST Name" (space), "st. Name" (dot), "st) Name" (paren)
            # Also handle Spanish ordinals: 1er, 2do, 3er, 4to, 5to
            # Also handle degree/ordinal signs: °, º (from "1º Name" parsed as "1" + "º Name")
            entry_raw = re.sub(r'^(ST|ND|RD|TH|ER|DO|TO|TA|[°º])[.\s)\t]+', '', entry_raw, flags=re.IGNORECASE)

        # Strip "place"/"puesto"/"lugar" prefix (from "1st place - Name", "1er PUESTO Name", "1er LUGAR")
        entry_raw = re.sub(r'^(place|puesto|lugar)\s*[-:]?\s*', '', entry_raw, flags=re.IGNORECASE).strip()

        # Strip bare dash prefix (from "1st - Name" or "1.-Name" parsed as "- Name" or "-Name")
        entry_raw = re.sub(r'^-\s*', '', entry_raw).strip()

        # Handle tied placements like "23/24 Name" -> entry starts with "/24 Name"
        # Convert to just "Name" and keep place as 23 (the first/lower number)
        # Must happen before noise filters so "1/2 Finals..." resolves to "Finals..."
        tied_match = tied_place_re.match(entry_raw)
        if tied_match:
            entry_raw = tied_match.group(1).strip()

        # Skip lines that look like years (e.g., "2007 US Open..." parsed as place=200)
        if place >= 100:
            continue  # No event has 100+ placements in a single division

        # Skip schedule/time noise: lines like "9:30 Open Doubles Meeting"
        # get parsed as place=9, entry="30 Open Doubles..."
        # Also skip entries that are clearly times or admin text
        # Pattern 1: entry starts with "00 am/pm" (from "6:00 pm" parsed as place=6)
        if re.match(r'^\d{1,2}\s*(am|pm|a\.m|p\.m)', entry_raw, re.IGNORECASE):
            continue  # Skip - this is a time, not a placement
        # Pattern 2: entry starts with ":30" (from "9:30" parsed as place=9)
        if re.match(r'^:\d{2}', entry_raw):
            continue  # Skip - this is the minutes part of a time
        # Pattern 3: entry IS a time like "6:30pm" or "12:00 noon"
        if re.match(r'^\d{1,2}:\d{2}\s*(am|pm|noon)?', entry_raw, re.IGNORECASE):
            continue  # Skip - this is a time
        # Pattern 4: entry starts with "End of" or similar admin phrases
        if re.match(r'^(end of|registration|reservations)', entry_raw, re.IGNORECASE):
            continue  # Skip - this is admin text
        # Pattern 5: entry starts with "00 " + admin word (from "10:00 End of..." parsed as place=10)
        if re.match(r'^00\s+(end|registration|check)', entry_raw, re.IGNORECASE):
            continue  # Skip - minutes part of time + admin text
        # Pattern 6: entry contains phone number patterns
        if re.search(r'\d{3}[-.]\d{3}[-.]\d{4}|\d{3}[-.]\d{4}|1-800-', entry_raw):
            continue  # Skip - contains phone number
        # Pattern 7: entry is a rule/instruction sentence
        if re.search(r'\b(is allowed|contact is|by phone|make reservations|discount code|you are asked)\b', entry_raw, re.IGNORECASE):
            continue  # Skip - rule or instruction text
        # Pattern 8: entry starts with degree/ordinal sign noise (after stripping, only noise remains)
        # e.g., "º and 4º position match" — but NOT valid names (which had º stripped above)
        if entry_raw.startswith(('°', 'º')):
            continue  # Skip - degree-sign ordinal noise that wasn't stripped
        # Pattern 9: narrative/commentary text (section headers or match descriptions)
        if re.match(r'^(Finals|Finas|points|position)', entry_raw, re.IGNORECASE):
            continue  # Skip - narrative text, not a placement
        # Pattern 10: hotel/hostel names (French and English)
        if re.search(r'\b(hostel|auberge|hotel|hôtel|gîte|manoir)\b', entry_raw, re.IGNORECASE):
            continue  # Skip - accommodation information
        # Pattern 11: schedule/meeting keywords
        if re.search(r'\b(registration|check-in|check in|meet at)\b', entry_raw, re.IGNORECASE):
            continue  # Skip - schedule information
        # Pattern 12: narrative/descriptive text with exclamation marks
        # e.g., "golfers, great weather, crazy course!" from "10 golfers, great..."
        # But NOT legitimate entries with locations like "Name, City, Country"
        if '!' in entry_raw and not entry_raw.rstrip().endswith(':'):
            continue  # Skip - exclamatory text is not a placement

        # Pattern 13: event narrative keywords and tournament match results
        # e.g., "annual Summer Classic next year", "net players from 5 countries", "different states"
        # Also skip tournament match results like "Grischa vs Franck 11/3" (not a placement)
        # These are tournament descriptions, not placement entries
        narrative_patterns = [
            r'\b(annual|classic|championship|tournament)\b.*\b(next year|this year|coming soon|was|hosted|held)\b',  # Event narrative
            r'\bnet players\b.*\b(countries|states)\b',  # Attendee description
            r'\bdifferent states\b',  # Location description
            r'\breceived.*tournament',  # Event recap
            r'\bhighest.*ratio.*games\b',  # Tournament rules/tiebreaker
            r'\bin.*finals.*seed\b.*\bbeat\b',  # Tournament scoring description
            r'^[\w\s]+\s+vs\s+[\w\s]+\s+\d+/\d+',  # Tournament match result format (e.g., "X vs Y 11/3")
            r'\bposition\s+match\b',  # Scheduling text: "3rd and 4th position match"
        ]
        # Pattern 14: doubles bracket match result "Team1/Player1 Vs Team2/Player2"
        # e.g., "Oscar Loreto/ Reinaldo Pérez Vs CArlos Márquez/Angel Vivas (scratch)"
        # These appear in "Doubles Semifinals/Final" sections - skip them as they're
        # match results, not final placements (final standings are listed separately)
        if '/' in entry_raw and re.search(r'\bvs\.?\b', entry_raw, re.IGNORECASE):
            continue  # Skip - doubles bracket match result, not a placement
        if any(re.search(pattern, entry_raw, re.IGNORECASE) for pattern in narrative_patterns):
            continue  # Skip - this is tournament narrative, not a placement

        # Pattern 15: URL or query-string fragment
        # e.g., "28&source_impression_id=..." from a line-wrapped URL
        if re.match(r'^&\w', entry_raw) or re.search(r'https?://', entry_raw):
            continue  # Skip - URL fragment, not a placement

        # Increment placement index for this valid entry
        placement_index += 1

        # Initialize player1 and player2
        player1 = None
        player2 = None
        competitor_type = "player"
        
        # Handle country-pair suffix pattern first (e.g., "Name1 & Name2 FIN/PL")
        team = split_team_ampersand_with_country_pair(entry_raw)
        if team:
            player1, player2 = team
            competitor_type = "team"
        else:
            # Early split on " & " at the raw entry point (before any other parsing)
            name_line = entry_raw
            
            # Try split on ampersand (without mutating name_line unless split succeeds)
            split = try_split_ampersand_team(name_line)
            if split and player2 is None:
                player1, player2 = split
                competitor_type = "team"
        
        # Apply event-specific parsing rules (only if not already split)
        if player1 is None:
            if use_merged_team_split:
                player1, player2, competitor_type = split_merged_team(name_line)
            else:
                _is_doubles_div = bool(re.search(r'\bdoubles?\b', division_raw or '', re.IGNORECASE))
                player1, player2, competitor_type = split_entry(name_line, is_doubles=_is_doubles_div)

        # Fallback: detect merged team format "Name [seed] CAN Name GER"
        if player2 is None and isinstance(player1, str):
            split = try_split_merged_team(player1)
            if split:
                player1, player2 = split
                competitor_type = "team"

        # Post-process: if player2 contains a slash, it's a malformed multi-player entry
        # e.g., "Bryan Nelson" and "Jake DeClercq/Josh DeClercq" should become
        # just player1="Bryan Nelson" (ignore the multi-player in player2), or skip it
        # For now, if player2 has a slash, just use the first name from player2
        if player2 and '/' in player2:
            # Split player2 on the slash and take the first part
            player2_names = [p.strip() for p in player2.split('/')]
            if player2_names:
                player2 = player2_names[0]  # Use first part of the slash-separated names

        # Post-process: drop admin annotations that slipped into player2 via "/" team-split
        # e.g., player2 = "only played in round 1; scores not comparable to above"
        if player2 is not None and ';' in player2 and not looks_like_person(player2.strip()):
            player2 = None
            competitor_type = "player"

        # Strip TIE format remainder from player2: when entry_raw has TIE doubles format
        # "A/B and C/D", the "/" split gives player2="B and C/D", then "/" strip gives
        # player2="B and C". Strip " and C" to leave just the correct partner "B".
        # Also handles singles TIE: "TIE A and B and C" → player2="B and C" → "B".
        # All remaining " and " in player2 are parsing artifacts, not legitimate compound names.
        if player2 and re.search(r'\s+and\s+', player2, re.IGNORECASE):
            and_m = re.search(r'\s+and\s+', player2, re.IGNORECASE)
            trimmed = player2[:and_m.start()].strip()
            if trimmed:  # Don't blank out player2 entirely
                player2 = trimmed

        # Skip trick sequences (identified by " > " separator OUTSIDE parentheses)
        # e.g., "Diving Clipper > Spinning Clipper > Spinning Paradox Dragonfly"
        # But keep "Will Digges (Alpine Blurry > Janiwalker)" — trick info is parenthetical.
        if player1 and _arrow_outside_parens(player1):
            continue  # Skip - this is a trick list, not a placement
        if player2 and _arrow_outside_parens(player2):
            # If player2 is a trick list, just treat entry as single player
            player2 = None
            competitor_type = "player"

        # Skip entries that are standalone trick names (no " > " but still recognisable
        # as trick annotation). e.g. "LEG OVER.", "BLURRY WHIRL", "DOBLE LEG OVER".
        # These appear after the player name in South-American result formats.
        if player1 and _is_trick_name_line(player1):
            continue  # Skip - freestyle trick name, not a competitor

        # Skip placements with invalid player names (noise)
        # A valid player name should have at least 2 alphanumeric characters
        if not player1 or len(player1) < 2 or not re.search(r"[a-zA-Z]{2,}", player1):
            continue  # Skip this as parsing noise

        # Skip entries that are narrative prose (not player names)
        # E.g., "square in my very first game" (from "4-square in my...")
        player1_lower = player1.lower()
        prose_indicators = [' in my ', ' i ', ' the ', ' was ', ' were ', ' said ', ' say ',
                           ' overall ', ' about ', ' would ', ' could ', ' should ']
        if any(indicator in player1_lower for indicator in prose_indicators):
            continue  # Skip as narrative text

        # Confidence scoring
        confidence = "high"
        notes = []

        if division_raw == "Unknown":
            confidence = "medium"
            notes.append("no division header found")

        if not player1:
            confidence = "low"
            notes.append("empty player name")

        # Check for suspicious patterns in entry
        # Note: '>' and tabs are allowed in trick competitions (Sick 3, Request, Battles)
        # Format: "Player\tTrick1>Trick2>Trick3" or "Player\tScore"
        # Heuristic: If entry has tabs AND '>', it's likely a trick combo (not suspicious)
        is_trick_combo_format = '\t' in entry_raw and '>' in entry_raw

        if is_trick_combo_format:
            # Trick combo format - tabs and '>' are expected, only flag other chars
            if re.search(r"[<{}|\\]", entry_raw):
                confidence = "low"
                notes.append("suspicious characters in entry")
        else:
            # Standard format - flag unusual characters including '>'
            if re.search(r"[<>{}|\\]", entry_raw):
                confidence = "low"
                notes.append("suspicious characters in entry")

        # --- NEW: strip common suffixes that are not part of the division name ---
        division_raw = re.sub(r"\s*-\s*(final|complete)\s+results\s*$", "", division_raw, flags=re.I).strip()
        division_raw = re.sub(r"\s+(final\s+)?results\s*$", "", division_raw, flags=re.I).strip()

        # Normalize non-English division names (Spanish, French, etc.) to English
        division_raw = normalize_language_division(division_raw)
        # Truncate excessively long divisions (usually misidentified placements)
        # Use 55 chars to ensure canonicalized version stays under 60 char QC threshold
        division_raw = truncate_long_division(division_raw, max_length=55)
        division_canon = canonicalize_division(division_raw)
        division_category = categorize_division(division_canon, event_type)

        # If team accidentally duplicates same player, drop player2 (deterministic)
        if player1 and player2:
            n1 = re.sub(r"\s+", " ", player1.strip()).lower()
            n2 = re.sub(r"\s+", " ", player2.strip()).lower()
            if n1 == n2:
                player2 = None
                competitor_type = "player"

        # Finalize player names for placement dict
        player1_name = player1
        player2_name = player2

        # Fallback split on '&' ONLY if we don't already have player2
        if not player2_name and isinstance(player1_name, str):
            split = try_split_amp_team(player1_name)
            if split:
                player1_name, player2_name = split
                competitor_type = "team"

        # Reject non-person names for player entries (skip junk like "(tie)", "POOL A", etc.)
        if competitor_type == "player":
            if not looks_like_person_name(player1_name):
                continue  # Skip this placement

        p1_clean = normalize_whitespace(clean_player_name(player1_name))
        if not p1_clean:
            continue  # clean_player_name stripped entire value (e.g. "and 4º position match")
        placements.append({
            "division_raw": normalize_whitespace(division_raw),
            "division_canon": division_canon,
            "division_category": division_category,  # net, freestyle, golf, or unknown
            "place": place,
            "competitor_type": competitor_type,
            "player1_name": p1_clean,
            "player2_name": normalize_whitespace(clean_player_name(player2_name)) if player2_name else "",
            "entry_raw": normalize_whitespace(entry_raw),
            "parse_confidence": confidence,
            "notes": normalize_whitespace("; ".join(notes)) if notes else "",
        })

    # Deduplicate: same (division, place, type, player1, player2) is always an
    # extraction artifact (e.g., h2-structured + pre block both parsed, or
    # pool/overall standings repeating final results).  Keep first occurrence.
    seen_keys = set()
    deduped = []
    for p in placements:
        key = (
            p["division_canon"].lower(),
            str(p["place"]),
            p["competitor_type"],
            p["player1_name"].strip().lower(),
            (p["player2_name"] or "").strip().lower(),
        )
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(p)

    return deduped, rejected_division_headers


# ------------------------------------------------------------
# Location canon (inputs/location_canon_full_final.csv)
# ------------------------------------------------------------
LOCATION_CANON_PATH = REPO_ROOT / "inputs" / "location_canon_full_final.csv"


def _location_canon_part(s: str) -> str:
    """Normalize a location part: strip and treat NaN as empty (return empty string)."""
    s = (s or "").strip()
    if s and s.lower() != "nan":
        return s
    return ""


def load_location_canon(path: Optional[Path] = None) -> dict[str, str]:
    """
    Load event_id -> canonical location string from location_canon_full_final.csv.
    CSV columns: event_id, city_canon, state_canon, country_canon, country_iso3, ...
    Returns dict mapping event_id (str) to "City, State, Country" (non-empty parts only).
    NaN values are treated as empty; if all parts are empty/NaN, the event is not included.
    """
    p = path or LOCATION_CANON_PATH
    result: dict[str, str] = {}
    if not p.exists():
        return result
    with open(p, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eid = (row.get("event_id") or "").strip()
            if not eid:
                continue
            city = _location_canon_part(row.get("city_canon", ""))
            state = _location_canon_part(row.get("state_canon", ""))
            country = _location_canon_part(row.get("country_canon", ""))
            parts = [x for x in (city, state, country) if x]
            if not parts:
                continue
            result[eid] = ", ".join(parts)
    return result


# ------------------------------------------------------------
# CSV processing
# ------------------------------------------------------------
def read_stage1_csv(csv_path: Path) -> list[dict]:
    """Read stage1 CSV and return list of event records."""
    _NAN_STRINGS = {"nan", "none", "null", "na", "#n/a"}
    records = []
    with open(csv_path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Normalise pandas/Excel NaN sentinel strings to empty string for all text fields
            for key, val in row.items():
                if isinstance(val, str) and val.strip().lower() in _NAN_STRINGS:
                    row[key] = ""
            # Convert year to int if present
            if row.get("year"):
                try:
                    row["year"] = int(row["year"])
                except ValueError:
                    row["year"] = None
            else:
                row["year"] = None
            records.append(row)
    return records


def normalize_whitespace(text: str) -> str:
    """
    Normalize all whitespace in text.

    - Replaces tabs with spaces
    - Collapses multiple consecutive spaces into single space
    - Strips leading/trailing whitespace

    This is a mechanically deterministic operation that preserves
    actual content while cleaning presentation.
    """
    if not text:
        return ""
    # Replace tabs with spaces
    cleaned = text.replace('\t', ' ')
    # Collapse multiple spaces into single space
    cleaned = re.sub(r' {2,}', ' ', cleaned)
    # Strip leading/trailing whitespace
    return cleaned.strip()


def clean_date(date_raw: str) -> str:
    """Clean date field by removing iCal remnant text."""
    if not date_raw:
        return ""
    # Remove iCal UI text suffix
    cleaned = re.sub(r"\s*add this event to iCal.*$", "", date_raw, flags=re.IGNORECASE)
    return normalize_whitespace(cleaned)


def canonicalize_location(location_raw: str) -> str:
    """
    Canonicalize location by removing noise and keeping only place names.

    Removes:
    - "Site(s) TBA" prefix (very common - appears in 22% of events)
    - "TBD" prefix
    - Narrative text ("see below", "click here", etc.)
    - Venue names before location (e.g., "Golden Gate Park - San Francisco" → "San Francisco")

    Preserves:
    - City, State/Province, Country format
    - Special characters in place names (e.g., Czech: Nový Jičín)
    """
    if not location_raw:
        return ""

    cleaned = location_raw.strip()

    # Remove "Site(s) TBA" - multiple patterns
    # Prefix: "Site(s) TBA Sofia, Bulgaria" → "Sofia, Bulgaria"
    cleaned = re.sub(r'^Site\s*\(?\s*s?\s*\)?\s*TBA\s*', '', cleaned, flags=re.IGNORECASE)
    # Parenthetical: "University of Oregon (site TBA) Eugene..." → "Eugene..."
    cleaned = re.sub(r'\([^)]*\bsite\s+tba[^)]*\)\s*', '', cleaned, flags=re.IGNORECASE)
    # General TBA in parentheses
    cleaned = re.sub(r'\(\s*tba\s*\)\s*', '', cleaned, flags=re.IGNORECASE)

    # Remove "TBD" and "Location TBD" - multiple patterns
    # Prefix: "TBD Chandler, Arizona" → "Chandler, Arizona"
    cleaned = re.sub(r'^(Location\s+)?TBD\s+', '', cleaned, flags=re.IGNORECASE)
    # Inline: "Sat: TBD; Sun: Levy Pavilion..." → "Sun: Levy Pavilion..." (keep useful part)
    # Complex pattern - remove time-specific TBD parts
    cleaned = re.sub(r'\b(sat|sun|mon|tue|wed|thu|fri):\s*tbd\s*;?\s*', '', cleaned, flags=re.IGNORECASE)
    # General TBD in parentheses
    cleaned = re.sub(r'\(\s*tbd\s*\)\s*', '', cleaned, flags=re.IGNORECASE)

    # Remove narrative text - multiple patterns
    # Prefix: "See details. Salem..." → "Salem..."
    cleaned = re.sub(r'^See\s+details\.?\s*', '', cleaned, flags=re.IGNORECASE)
    # Prefix: "Check the home page for details..." → rest
    cleaned = re.sub(r'^Check\s+the\s+home\s+page\s+for\s+details\.?\s*', '', cleaned, flags=re.IGNORECASE)
    # Parenthetical: "(See details for locations) Oakland..." → "Oakland..."
    cleaned = re.sub(r'\([^)]*\bsee\s+details[^)]*\)\s*', '', cleaned, flags=re.IGNORECASE)
    # Suffix with dash: "Dallas - see below" → "Dallas"
    cleaned = re.sub(r'\s*[-–]\s*see\s+below.*$', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*[-–]\s*click\s+here.*$', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*[-–]\s*details?.*$', '', cleaned, flags=re.IGNORECASE)

    # Remove "to be announced" variations
    cleaned = re.sub(r'\s*\(?\s*to\s+be\s+announced\s*\)?', '', cleaned, flags=re.IGNORECASE)

    # Remove street addresses while preserving venue/location names
    street_terms = r'(?:Street|St\.?|Rd\.?|Road|Avenue|Ave\.?|Boulevard|Blvd\.?|Rue|Straße|Strasse|Straat|Str\.?|Drive|Way|Lane|Court|Place|Plaza|Square|Alley|Circle|Trail|Path|Pike|Parkway|Terrace|Close|Crescent|Heights|Bay|Point|Harbor|Loop|Shore|View|Ridge|Summit|Valley|Hills|Forest|Park|Green|Gardens|Grove|Field|Meadow|Wood|Lake|River|Spring|Hill|Mount|Tower|Gate|Bridge|Station|Centre|Center|Complex|Hall|Building|House|Home|Campus|Quarter|Section)'

    # Pattern 1: "Number Street_Term" (e.g., "123 Main", "82 Avenue", "106 Str.", "560 59th St")
    # Removes: ", 123 Main St." or " - 82 Avenue" or ", 106 Str." or ", 560 59th St"
    # Handles ordinals like "59th" in street names
    cleaned = re.sub(r'(?:,?\s*-?\s*)\d+(?:\s+\d+(?:st|nd|rd|th))?\s+(?:[\w\s]+?\s+)*' + street_terms + r'(?:\.|\s|,|$)', ', ', cleaned, flags=re.IGNORECASE)

    # Pattern 2: Just street numbers without street term (e.g., "1200 Bleury" where Bleury is part of next word)
    # But be careful not to strip years or other numbers
    # Remove: ", 1200 " when followed by capitalized word (likely street name)
    cleaned = re.sub(r',\s+\d{4}\s+(?=[A-Z][a-z]+)', ', ', cleaned)
    cleaned = re.sub(r',\s+\d{3,5}\s+(?=[A-Z][a-z]{3,})', ', ', cleaned)

    # Pattern 3: International street abbreviations
    # German: "Feldgerichtsstrasse 29" or "Roelckestr. 106"
    cleaned = re.sub(r',?\s+\w+strasse\s+\d+(?:\s|,|$)', ', ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r',?\s+\w+str\.?\s+\d+(?:\s|,|$)', ', ', cleaned, flags=re.IGNORECASE)
    # Polish: "ul. Street 12" or "Ulica Street 12" or "ul. Street 9/17" (with slash/hyphen ranges)
    cleaned = re.sub(r',?\s+u[lł]\.\s+[\w\s]+\s+\d+(?:[/-]\d+)?(?:\s|,|$)', ', ', cleaned, flags=re.IGNORECASE)
    # Czech/Slovak: "U stadionu" style
    cleaned = re.sub(r',?\s+[Uu]\s+[\w\s]+\s+\d{3,5}(?:\s|,|$)', ', ', cleaned)

    # Pattern 3b: US street address ranges like "571-601 State St" or ": 571-601 State St"
    cleaned = re.sub(r'[:,-]?\s+\d+-\d+\s+(?:[\w\s]+?\s+)*' + street_terms + r'(?:\s|,|$)', ', ', cleaned, flags=re.IGNORECASE)

    # Pattern 3c: Room numbers on campuses like "157 A+B" or similar building refs
    # Match: digits followed by letter(s), optionally with +, then space/comma
    cleaned = re.sub(r',?\s+\d+\s+[A-Z](?:\+[A-Z])?(?:\s|,)', ', ', cleaned)

    # Pattern 3d: Parenthetical street addresses with postal codes (before removing individual postal codes)
    # Match: (Street Address, PostalCode CityName) when city is already listed after paren
    # Only remove if it has postal code PATTERN: comma followed by digit-hyphen-digit code, not just any digits
    # E.g., "(Plac 1 Maja 10, 57-100 Strzelin) Strzelin" -> "Strzelin"
    # Matches both 5-digit codes (75013) and ranges (57-100)
    # But KEEP: "(Malostranske namesti 262/9)" which is just address/building numbers
    cleaned = re.sub(r'\s*\([^)]*,\s*(?:\d{5}|\d{2,3}-\d{2,3})(?:\s|,|-)[^)]*\)\s*(?=[A-Z]\w+)', ' ', cleaned)

    # Pattern 4: Postal codes in various formats
    # Remove: "75013 Paris" or "20707, USA" patterns
    # Format: 4-5 digits optionally followed by space/hyphen and city name
    cleaned = re.sub(r'\s+\d{5}\s+(?=[A-Z][a-z])', ', ', cleaned)  # "75013 Paris" -> ", Paris"
    cleaned = re.sub(r'\s*,?\s*\d{4,5}(?:,?\s*-\s*\d{1,5})?,?\s*', ', ', cleaned)  # "20707, USA" or "57-100 Strzelin"

    # Pattern 5: UK/international postcode format like "M?6" or "EC2A"
    cleaned = re.sub(r'\s+[A-Z]{1,2}\d{1,2}\s+', ', ', cleaned)

    # Clean up any resulting double commas, triple cities, or malformed spacing
    cleaned = re.sub(r',\s*,+', ',', cleaned)
    cleaned = re.sub(r'(,\s*){2,}', ', ', cleaned)

    # Remove duplicate city names (e.g., "Paris Paris" or "Frankfurt Frankfurt")
    # Match: City, State, City format and remove the duplicate
    cleaned = re.sub(r'(\b\w+(?:\s+\w+)?),\s+\w+,?\s+\1\b', r'\1', cleaned, flags=re.IGNORECASE)

    # Remove parenthetical zip codes/postal codes (usually at end)
    # Matches patterns like "(20707)" or "(75013)" or "(M?6)"
    cleaned = re.sub(r'\s*\([A-Z]?\d{4,5}\)\s*$', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*\([A-Z]{1,2}\s*\d+\)\s*$', '', cleaned, flags=re.IGNORECASE)

    # ------------------------------------------------------------
    # Final polish (presentation-safe, deterministic)
    # ------------------------------------------------------------
    # Collapse repeated separators: ", ,", " ,", ",  ,"
    cleaned = re.sub(r'\s*,\s*,+\s*', ', ', cleaned)
    # Collapse repeated whitespace
    cleaned = re.sub(r'\s{2,}', ' ', cleaned)
    # Strip trailing/leading punctuation and whitespace (e.g., "Paris, France," -> "Paris, France")
    cleaned = cleaned.strip(" \t\r\n,;:-–")
    # One more pass: collapse "City , Country" -> "City, Country"
    cleaned = re.sub(r'\s*,\s*', ', ', cleaned).strip()

    return cleaned


def clean_results_raw(results_raw: str) -> str:
    """
    Remove ALL noise from results_raw field.

    Removes:
    - URLs (http://, https://, www., mailto:, domain references)
    - Email addresses
    - Narrative/promotional paragraphs
    - Commentary and descriptive text
    - Instructional text (click here, see below, etc.)
    - Acknowledgments and thank-you messages
    - Event descriptions and announcements

    Preserves:
    - Division headers
    - Placement entries (number + player/team names)
    - Actual results data

    Philosophy: If it's not a division header or a placement entry, it's noise.
    """
    if not results_raw:
        return ""

    lines = results_raw.split('\n')
    cleaned_lines = []

    # URL patterns to detect and remove
    url_patterns = [
        r'https?://',           # http:// or https://
        r'www\.',               # www.
        r'mailto:',             # mailto:
        r'\w+@\w+\.\w+',        # email addresses
        r'footbag\.org',        # footbag.org references
        r'\.(com|org|net|de|ch|fr|ca|uk|au|ru)\b',  # domain extensions
    ]

    # Noise phrase patterns (case-insensitive)
    # NOTE: Single-word patterns MUST use word boundaries (\b) to avoid false positives
    # e.g., r'\bcontact\b' not r'contact' (to avoid matching "Consecutive")
    noise_patterns = [
        # Promotional/descriptive
        r'check out',
        r'visit',
        r'see.*website',
        r'for more info',
        r'click here',
        r'see below',
        r'see.*full results',
        r'see.*highlights',
        r'full results.*here',

        # Acknowledgments
        r'thanks to',
        r'thank you',
        r'cheers to',
        r'congrats',
        r'congratulations',
        r'special thanks',
        r'shout.*out',

        # Sponsor/donation text
        r'\bsponsor\b',  # Word boundary to avoid matching "sponsorship", etc.
        r'\bdonate\b',   # Word boundary to avoid false matches
        r'\bprize\b',    # Word boundary to match only prize, not "prize money"
        r'without.*help',
        r'would not have',

        # Event descriptions/announcements
        r'people from far and wide',
        r'great success',
        r'biggest event',
        r'biggest party',
        r'hot news',
        r'you don.*t want to miss',
        r'inaugural',
        r'for the.*time we organise',
        r'this year.*s.*will be',

        # Instructional
        r'see.*details',
        r'check.*details',
        r'more information',
        r'\bcontact\b',   # Word boundary: avoid matching "Consecutive" which contains "contact"
        r'\bregister\b',  # Word boundary: avoid matching "Registered Competitors"
    ]

    for line in lines:
        line_stripped = line.strip()

        # Skip empty lines
        if not line_stripped:
            continue

        # Remove lines containing URLs
        has_url = any(re.search(pattern, line_stripped, re.IGNORECASE) for pattern in url_patterns)
        if has_url:
            continue

        # Remove lines that are purely narrative/noise
        # A line is noise if it:
        # 1. Contains noise phrases AND
        # 2. Doesn't look like a result entry (no leading number)
        has_noise_phrase = any(re.search(pattern, line_stripped, re.IGNORECASE) for pattern in noise_patterns)
        looks_like_result = re.match(r'^\s*\d{1,3}[.)\-:\s]', line_stripped) or re.match(r'^\s*\d{1,2}(ST|ND|RD|TH)\s', line_stripped, re.IGNORECASE)

        if has_noise_phrase and not looks_like_result:
            continue

        # Filter fake result entries: lines that START with a number (look like "1. Name")
        # but are actually narrative text (contain narrative keywords after the number)
        # Examples: "20th annual Summer Classic", "23 net players from 5 countries", "4 different states"
        if looks_like_result:
            # Extract the part after the leading number+punctuation
            text_after_number = re.sub(r'^\s*\d+(?:st|nd|rd|th|[.)\-:\s])*\s*', '', line_stripped, flags=re.IGNORECASE)

            # Check if the rest contains narrative keywords
            narrative_keywords = {
                'annual', 'classic', 'annual', 'summer', 'celebration',  # Event names
                'ratio', 'ratio of', 'games won', 'games lost',  # Stats descriptions
                'straight', 'games in',  # Tournament play descriptions
                'net players', 'freestyle players', 'countries',  # Attendee descriptions
                'different states', 'received', 'tournament t', 'sandbag',  # Event recap
                'great success', 'wonderful weather', 'great food',  # Event narrative
            }

            has_narrative_keyword = any(
                keyword in text_after_number.lower()
                for keyword in narrative_keywords
            )

            if has_narrative_keyword:
                # This is a fake result entry - skip it
                continue

        # Remove standalone HTML/markdown artifacts
        if line_stripped in ['---', '***', '===', '___', '...']:
            continue

        # Remove common section headers that are noise (not division headers)
        noise_headers = [
            'results',
            'tournament results',
            'final results',
            'event results',
            'competition results',
            'notes',
            'comments',
            'summary',
        ]
        if line_stripped.lower().strip(':').strip() in noise_headers and len(line_stripped) < 30:
            # Keep it - these might be legitimate section markers
            # But remove overly long narrative-style headers
            pass

        # Remove lines that are complete sentences (narrative paragraphs)
        # Heuristic: If a line is long (>80 chars) and contains multiple sentences, it's likely narrative
        sentence_count = line_stripped.count('. ') + line_stripped.count('! ') + line_stripped.count('? ')
        if len(line_stripped) > 80 and sentence_count >= 2:
            continue

        # Remove lines with lots of prose
        # Multiple heuristics to detect narrative text vs. results data
        words = line_stripped.split()
        if len(words) > 5:  # Only check lines with enough words
            common_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
                          'is', 'was', 'are', 'were', 'be', 'been', 'being', 'will', 'would', 'should', 'could', 'may',
                          'this', 'that', 'these', 'those', 'it', 'we', 'you', 'they', 'who', 'what', 'when', 'where',
                          'why', 'how', 'all', 'some', 'any', 'each', 'every', 'both', 'more', 'most', 'such', 'so', 'than',
                          'about', 'information', 'detailed', 'videos', 'results', 'event', 'please', 'here', 'out',
                          'came', 'make', 'great', 'people', 'like', 'would', 'have', 'had', 'not', 'his', 'her'}

            # Count common words
            common_count = sum(1 for w in words if w.lower().strip('.,!?;:') in common_words)

            # Also count words with multiple capital letters (likely place names: "NY", "PA", "MI")
            # These are often in event descriptions listing locations
            # Strip punctuation before checking length and case
            multi_cap_count = sum(1 for w in words if len(w.strip('.,!?;:')) == 2 and w.strip('.,!?;:').isupper())

            # If high common word density OR multiple state abbreviations, it's likely prose
            common_ratio = common_count / len(words)
            has_many_states = multi_cap_count >= 3  # 3+ state abbreviations = location list

            if (common_ratio > 0.35 or has_many_states) and not looks_like_result:
                continue

        # Remove sentence fragments that look like incomplete prose
        # E.g., "For detailed information about the" or "and some videos"
        fragment_starters = ['for', 'and', 'or', 'but', 'with', 'about', 'regarding', 'concerning', 'to', 'who', 'which']
        if len(words) > 2 and len(words) < 15 and words[0].lower() in fragment_starters:
            # This is likely a sentence fragment left over from URL removal
            continue

        # Remove lines that start with lowercase (likely continuation of previous sentence)
        # Exception: don't remove if it looks like a player name or result entry
        if words and words[0][0].islower() and not looks_like_result:
            # This is a sentence continuation fragment
            continue

        # Remove lines ending with comma (incomplete list/sentence)
        if line_stripped.endswith(',') and not looks_like_result:
            continue

        # Remove venue/sponsor description lines
        venue_words = {'provided', 'chairs', 'tables', 'carpet', 'site', 'venue', 'location',
                      'authority', 'exhibition', 'direct', 'communications', 'elements'}
        if len(words) > 4 and sum(1 for w in words if w.lower().strip('.,!?;:') in venue_words) >= 2:
            # Has 2+ venue-related words - likely venue/sponsor description
            if not looks_like_result:
                continue

        # Remove lines that are just punctuation
        if re.match(r'^[.,!?;:\-\s]+$', line_stripped):
            continue

        # Remove very short lines that are just common words (noise fragments)
        # E.g., "results", "videos", "and some", etc.
        if len(words) <= 3:
            # Check if all words are very common (not player names)
            noise_words = {'results', 'videos', 'video', 'photos', 'photo', 'images', 'image',
                          'information', 'info', 'details', 'detail', 'event', 'tournament',
                          'and', 'or', 'the', 'a', 'an', 'some', 'more', '.', '...'}
            if all(w.lower().strip('.,!?;:') in noise_words for w in words):
                continue

        # If we got here, keep the line
        cleaned_lines.append(line_stripped)

    return '\n'.join(cleaned_lines)


def infer_event_type(event_name: str, results_raw: str, placements: list = None) -> str:
    """
    Infer event_type from event name and placement division categories.

    Priority:
    1. "World Footbag Championships" in name → "worlds"
    2. If placements exist, use their division_category counts:
       - Only net divisions → "net"
       - Only freestyle divisions → "freestyle"
       - Both net and freestyle → "mixed"
       - Only golf → "golf"
       - Only unknown/ambiguous → fall back to text analysis
    3. Fall back to text analysis if no placements or all ambiguous

    Returns: worlds, net, freestyle, mixed, golf, or social
    """
    placements = placements or []
    name_lower = (event_name or "").lower()
    results_lower = (results_raw or "").lower()

    # Check for World Footbag Championships first (strict match)
    if "world footbag championship" in name_lower:
        return "worlds"

    # If we have placements, use their division categories
    if placements:
        categories = set()
        for p in placements:
            cat = p.get("division_category", "unknown")
            if cat and cat != "unknown":
                categories.add(cat)

        # Determine event type from categories present
        has_net = "net" in categories
        has_freestyle = "freestyle" in categories
        has_golf = "golf" in categories
        has_sideline = "sideline" in categories

        # If only golf, it's a golf event
        if has_golf and not has_net and not has_freestyle:
            return "golf"

        # If both net and freestyle, it's mixed
        if has_net and has_freestyle:
            return "mixed"

        # If only net
        if has_net:
            return "net"

        # If only freestyle
        if has_freestyle:
            return "freestyle"

        # If we have placements but all are "unknown" category,
        # fall through to text analysis below

    # --- Text-based fallback (when no placements or all unknown) ---
    combined = name_lower + " " + results_lower

    # Check for golf in text
    if re.search(r'\bgolf\b|\bgolfers?\b', combined):
        return "golf"

    # Check for sideline events (4-square, 2-square)
    if re.search(r'\b(4-square|four.?square|2-square|two.?square)\b', name_lower):
        return "social"

    # Keywords that definitively indicate category
    net_keywords = ["net", "footbag net", "kick volley"]
    freestyle_keywords = ["routine", "shred", "circle", "freestyle", "sick", "request", "consecutive"]

    has_net = any(kw in combined for kw in net_keywords)
    has_freestyle = any(kw in combined for kw in freestyle_keywords)

    # "Jam" in event name indicates freestyle gathering
    if re.search(r'\bjam\b', name_lower):
        has_freestyle = True

    # Net scoring patterns (rally scores like "21-16, 21-11")
    if re.search(r'\b\d{1,2}-\d{1,2},?\s*\d{1,2}-\d{1,2}\b', results_lower):
        has_net = True

    if has_net and has_freestyle:
        return "mixed"
    elif has_net:
        return "net"
    elif has_freestyle:
        return "freestyle"

    # Events with "open", "tournament", "championship", or "cup" in name
    # that have placements are likely mixed competitions
    if placements:
        if re.search(r'\b(open|tournament|championship|cup)\b', name_lower):
            return "mixed"

    # No competition indicators found
    if not placements:
        return "social"

    return "mixed"  # Has placements but couldn't classify - assume mixed


def canonicalize_records(
    records: list[dict],
    location_canon: Optional[dict[str, str]] = None,
) -> tuple[list[dict], dict]:
    """
    Process stage1 records into canonical format with placements.
    location_canon: optional dict event_id -> "City, State, Country" from location_canon_full_final.csv.
    Returns: (canonical_records, players_registry)
    """
    canonical = []
    players = {}  # player_id -> {"player_name": str, "countries": Counter()}
    location_canon = location_canon or {}

    for rec in records:
        event_id = rec.get("event_id", "")

        # Get basic event info
        results_raw = rec.get("results_block_raw", "")
        event_name = rec.get("event_name_raw", "")

        # Try to get event_type hint before parsing (from raw field or event name)
        event_type_hint = rec.get("event_type_raw", "")
        if not event_type_hint:
            # Quick check of event name for obvious net/freestyle/golf keywords
            name_lower = (event_name or "").lower()
            if "world footbag championship" in name_lower:
                event_type_hint = "worlds"
            elif " net" in name_lower or "footbag net" in name_lower:
                event_type_hint = "net"
            elif "freestyle" in name_lower or "shred" in name_lower or "routine" in name_lower:
                event_type_hint = "freestyle"
            elif "golf" in name_lower:
                event_type_hint = "golf"

        # Apply results file overrides (e.g. recovered external results not in mirror)
        if str(event_id) in RESULTS_FILE_OVERRIDES:
            _override = RESULTS_FILE_OVERRIDES[str(event_id)]
            # Strip leading "legacy_data/" — REPO_ROOT already points there.
            _override_file = _override["file"]
            if _override_file.startswith("legacy_data/"):
                _override_file = _override_file[len("legacy_data/"):]
            _override_path = REPO_ROOT / _override_file
            if _override_path.exists():
                _override_text = _override_path.read_text(encoding="utf-8")
                # Strip comment lines (# prefix)
                _override_lines = [l for l in _override_text.splitlines()
                                   if not l.startswith("#")]
                _override_clean = "\n".join(_override_lines)
                if _override.get("replace"):
                    results_raw = _override_clean
                else:
                    results_raw = _override_clean + "\n" + results_raw
            else:
                pass  # Override file removed — fix incorporated upstream

        # Parse placements WITH event_type context for better division categorization
        placements, rejected_division_headers = parse_results_text(results_raw, event_id, event_type_hint)

        # Infer final event_type (now that we have placements)
        event_type_for_div = event_type_hint or infer_event_type(event_name, results_raw, placements)

        # Re-categorize divisions if event_type changed after inference
        if event_type_hint != event_type_for_div and event_type_for_div:
            for p in placements:
                # Re-categorize using the final event_type
                p["division_category"] = categorize_division(p["division_canon"], event_type_for_div)

        # If all placements have Unknown division, try to infer from event name, placements, and event type
        if placements and all(p.get("division_canon") == "Unknown" for p in placements):
            inferred_div = infer_division_from_event_name(event_name, placements, event_type_for_div)
            if inferred_div:
                for p in placements:
                    p["division_raw"] = normalize_whitespace(f"[Inferred from event name: {event_name[:30]}]")
                    p["division_canon"] = inferred_div
                    p["division_category"] = categorize_division(inferred_div, event_type_for_div)
                    if p["parse_confidence"] == "medium":
                        # Keep medium if it was already medium for other reasons
                        pass
                    else:
                        p["parse_confidence"] = "medium"
                    if p["notes"]:
                        p["notes"] = normalize_whitespace(p["notes"] + "; division inferred from event name")
                    else:
                        p["notes"] = "division inferred from event name"

        # Handle known broken source events
        location = canonicalize_location(rec.get("location_raw", ""))
        date = clean_date(rec.get("date_raw", ""))
        if str(event_id) in KNOWN_BROKEN_SOURCE_EVENTS:
            if not location:
                location = BROKEN_SOURCE_MESSAGE
            if not date:
                date = BROKEN_SOURCE_MESSAGE

        # Apply location override if available (overrides take precedence)
        if str(event_id) in LOCATION_OVERRIDES:
            location = LOCATION_OVERRIDES[str(event_id)]
        # Else use location canon (inputs/location_canon_full_final.csv) when available
        elif str(event_id) in location_canon:
            location = location_canon[str(event_id)]

        # If location is NaN, output nothing (empty string)
        if (location or "").strip().lower() == "nan":
            location = ""

        # Get event name and apply override if available
        event_name = rec.get("event_name_raw", "")
        if str(event_id) in EVENT_NAME_OVERRIDES:
            event_name = EVENT_NAME_OVERRIDES[str(event_id)]

        # Infer event_type from name and placement categories
        event_type = rec.get("event_type_raw", "")
        if not event_type:
            event_type = infer_event_type(event_name, results_raw, placements)

        # Apply event_type override if available; re-categorize divisions if type changed
        if str(event_id) in EVENT_TYPE_OVERRIDES:
            overridden_type = EVENT_TYPE_OVERRIDES[str(event_id)]
            if overridden_type != event_type:
                for p in placements:
                    p["division_category"] = categorize_division(p["division_canon"], overridden_type)
            event_type = overridden_type

        year = rec.get("year")

        # Repair misparsed teams (Stage 2.5 post-pass)
        repair_misparsed_team_with_ampersand(placements)

        # Register players and inject IDs into placements
        for p in placements:
            pid1 = register_player(players, p.get("player1_name", ""), p.get("entry_raw", ""))
            if pid1:
                p["player1_id"] = pid1

            pid2 = register_player(players, p.get("player2_name", ""), p.get("entry_raw", ""))
            if pid2:
                p["player2_id"] = pid2

        canonical.append({
            "event_id": event_id,
            "year": year,
            "event_name": normalize_whitespace(event_name),
            "date": date,
            "location": location,
            "host_club": normalize_whitespace(clean_host_club(rec.get("host_club_raw", ""))),
            "event_type": event_type,
            "results_raw": clean_results_raw(results_raw),
            "placements_json": json.dumps(placements, ensure_ascii=False),
            "rejected_division_headers": rejected_division_headers,
        })

    return canonical, players


def deduplicate_events(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Remove duplicate events based on (year, event_name, location).

    When duplicates are found, keep the "better" record:
    1. Prefer actual dates over TBA/placeholder dates
    2. Prefer records with more placements
    3. If still tied, keep the lower event_id (first entered)

    Returns: (deduplicated_records, removed_duplicates)
    """
    from collections import defaultdict

    # Group by (year, event_name, location)
    groups = defaultdict(list)
    for rec in records:
        key = (rec.get("year", ""), rec.get("event_name", ""), rec.get("location", ""))
        groups[key].append(rec)

    deduplicated = []
    removed = []

    for key, group in groups.items():
        if len(group) == 1:
            deduplicated.append(group[0])
        else:
            # Sort to pick the best record
            def score(rec):
                date = rec.get("date", "").lower()
                placements = json.loads(rec.get("placements_json", "[]"))

                # Higher score = better record.
                # Priority order: has_placements > placement_count > date_exists > id
                # Placement count takes priority over date (a stub with a real date but
                # fewer placements must NOT beat a record with more placements and no date).
                has_placements = 1 if placements else 0
                placement_score = len(placements)
                date_score = 0 if "tba" in date or date == "" else 1
                # Lower numeric event_id = tiebreaker (negative so lower is better)
                # Slug-style IDs (non-numeric) score 0 as tiebreaker.
                eid = rec.get("event_id", "") or ""
                id_score = -int(eid) if eid.isdigit() else 0

                return (has_placements, placement_score, date_score, id_score)

            group.sort(key=score, reverse=True)
            deduplicated.append(group[0])  # Keep best
            removed.extend(group[1:])      # Remove rest

    # Sort output by event_id for stable ordering
    deduplicated.sort(key=lambda r: r.get("event_id", ""))

    return deduplicated, removed


def write_stage2_csv(records: list[dict], out_path: Path) -> None:
    """Write canonical records to stage2 CSV file."""
    if not records:
        print("No records to write!")
        return

    fieldnames = [
        "event_id",
        "year",
        "event_name",
        "date",
        "location",
        "host_club",
        "event_type",
        "results_raw",
        "placements_json",
        "rejected_division_headers",
    ]

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)


# ------------------------------------------------------------
# QC Field-Level Checks
# ------------------------------------------------------------
def check_event_id(rec: dict) -> list[QCIssue]:
    """Check event_id field: required, non-empty, pattern."""
    issues = []
    event_id = rec.get("event_id", "")

    if not event_id:
        issues.append(QCIssue(
            check_id="event_id_missing",
            severity="ERROR",
            event_id=event_id,
            field="event_id",
            message="event_id is missing or empty",
        ))
    elif not re.match(r"^\d+$", str(event_id)):
        issues.append(QCIssue(
            check_id="event_id_pattern",
            severity="WARN",
            event_id=str(event_id),
            field="event_id",
            message="event_id should be digits only",
            example_value=str(event_id)[:50],
        ))
    return issues


def check_event_name(rec: dict) -> list[QCIssue]:
    """Check event_name field: required, non-empty, no HTML/URLs."""
    issues = []
    event_id = rec.get("event_id", "")
    event_name = rec.get("event_name", "")

    if not event_name or not event_name.strip():
        issues.append(QCIssue(
            check_id="event_name_missing",
            severity="ERROR",
            event_id=str(event_id),
            field="event_name",
            message="event_name is missing or empty",
        ))
    else:
        # Check for HTML remnants
        if re.search(r"<[^>]+>|&[a-z]+;|&amp;", event_name, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="event_name_html",
                severity="WARN",
                event_id=str(event_id),
                field="event_name",
                message="event_name contains HTML remnants",
                example_value=event_name[:100],
            ))
        # Check for URLs
        if re.search(r"https?://|www\.", event_name, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="event_name_url",
                severity="WARN",
                event_id=str(event_id),
                field="event_name",
                message="event_name contains URL",
                example_value=event_name[:100],
            ))
        # Check for placeholder/template names
        if "event listing" in event_name.lower():
            issues.append(QCIssue(
                check_id="event_name_placeholder",
                severity="WARN",
                event_id=str(event_id),
                field="event_name",
                message="event_name appears to be a placeholder/template",
                example_value=event_name[:100],
            ))
    return issues


def check_event_type(rec: dict) -> list[QCIssue]:
    """Check event_type: must be in valid set or empty."""
    issues = []
    event_id = rec.get("event_id", "")
    event_type = rec.get("event_type", "")

    if event_type and event_type.lower() not in VALID_EVENT_TYPES:
        issues.append(QCIssue(
            check_id="event_type_invalid",
            severity="ERROR",
            event_id=str(event_id),
            field="event_type",
            message=f"event_type must be in {VALID_EVENT_TYPES}",
            example_value=event_type[:50],
        ))
    return issues


def check_location(rec: dict) -> list[QCIssue]:
    """Check location: required, no URLs/emails, not multi-sentence."""
    issues = []
    event_id = rec.get("event_id", "")
    location = rec.get("location", "")

    # Check for broken source or missing location
    is_known_broken = str(event_id) in KNOWN_BROKEN_SOURCE_EVENTS
    is_broken_or_unknown = (
        not location or
        not location.strip() or
        location == BROKEN_SOURCE_MESSAGE or
        location == "Unknown"
    )

    if is_broken_or_unknown:
        # Pre-mirror era (year < 1990) or curated source: no location is expected — downgrade to WARN
        # Curated events have slug-style event_ids (non-numeric, e.g. "1985_worlds_golden").
        _year_val = rec.get("year", "")
        _is_pre_mirror = str(_year_val).isdigit() and int(_year_val) < 1990
        _is_curated = not str(event_id).isdigit()
        issues.append(QCIssue(
            check_id="location_broken_source" if is_known_broken else "location_missing",
            severity=("WARN" if str(event_id).startswith("200") or _is_pre_mirror or _is_curated else "ERROR"),
            event_id=str(event_id),
            field="location",
            message="known broken source (SQL error in HTML)" if is_known_broken else "location is missing or empty",
        ))
        return issues  # Skip other checks for broken/missing
    else:
        # Check for URLs
        if re.search(r"https?://|www\.", location, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="location_url",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message="location contains URL",
                example_value=location[:100],
            ))
        # Check for email
        if re.search(r"\S+@\S+\.\S+", location):
            issues.append(QCIssue(
                check_id="location_email",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message="location contains email address",
                example_value=location[:100],
            ))
        # Check for "Hosted by"
        if re.search(r"hosted\s+by", location, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="location_hosted_by",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message="location contains 'Hosted by' (should be in host_club)",
                example_value=location[:100],
            ))
        # Multi-sentence detection (multiple periods followed by capital)
        sentences = re.split(r"\.\s+[A-Z]", location)
        if len(sentences) > 2:
            issues.append(QCIssue(
                check_id="location_multi_sentence",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message="location appears to contain multiple sentences",
                example_value=location[:100],
            ))
        # Check for overly long locations (>100 chars)
        if len(location) > 100:
            issues.append(QCIssue(
                check_id="location_too_long",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message=f"location too long ({len(location)} chars), should be simplified",
                example_value=location[:100] + "...",
            ))

        # Check for "Site(s) TBA" noise (should be cleaned by canonicalization)
        if re.search(r'\bsite\s*\(?\s*s?\s*\)?\s*tba\b', location, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="location_has_tba",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message="location contains 'Site(s) TBA' noise (canonicalization bug)",
                example_value=location[:100],
            ))

        # Check for "TBD" noise
        if re.search(r'\btbd\b', location, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="location_has_tbd",
                severity="WARN",
                event_id=str(event_id),
                field="location",
                message="location contains 'TBD' noise (canonicalization bug)",
                example_value=location[:100],
            ))

        # Check for narrative text ("see below", "click here", etc.)
        if re.search(r'\b(see\s+below|click\s+here|details?)\b', location, re.IGNORECASE):
            # Exception: "Neusiedlersee" is a German lake name, not narrative
            if 'neusiedlersee' not in location.lower():
                issues.append(QCIssue(
                    check_id="location_has_narrative",
                    severity="WARN",
                    event_id=str(event_id),
                    field="location",
                    message="location contains narrative text (should be cleaned)",
                    example_value=location[:100],
                ))

    return issues


def check_date(rec: dict) -> list[QCIssue]:
    """Check date field: parseable, required if worlds."""
    issues = []
    event_id = rec.get("event_id", "")
    date_str = rec.get("date", "")
    event_type = rec.get("event_type", "")

    # Required if worlds (only for mirror-era events; pre-1990 historical events have no dates)
    if event_type and event_type.lower() == "worlds":
        _year_val = rec.get("year", "")
        _year_int = int(_year_val) if str(_year_val).isdigit() else 9999
        if _year_int >= 1990 and (not date_str or not date_str.strip()):
            issues.append(QCIssue(
                check_id="date_missing_worlds",
                severity="ERROR",
                event_id=str(event_id),
                field="date",
                message="date is required for worlds events",
            ))

    if date_str and date_str.strip():
        # Check for iCal remnants
        if "ical" in date_str.lower():
            issues.append(QCIssue(
                check_id="date_ical_remnant",
                severity="WARN",
                event_id=str(event_id),
                field="date",
                message="date contains iCal remnants",
                example_value=date_str[:100],
            ))
        # Try to parse year from date for consistency check
        year_match = re.search(r"\b(19|20)\d{2}\b", date_str)
        if year_match:
            date_year = int(year_match.group(0))
            rec_year = rec.get("year")
            if rec_year and date_year != rec_year:
                issues.append(QCIssue(
                    check_id="date_year_mismatch",
                    severity="WARN",
                    event_id=str(event_id),
                    field="date",
                    message=f"date year ({date_year}) doesn't match record year ({rec_year})",
                    example_value=date_str[:50],
                    context={"date_year": date_year, "record_year": rec_year},
                ))
    return issues


def check_year(rec: dict) -> list[QCIssue]:
    """Check year field: plausible range, required if worlds."""
    issues = []
    event_id = rec.get("event_id", "")
    year = rec.get("year")
    event_type = rec.get("event_type", "")

    # Required if worlds
    if event_type and event_type.lower() == "worlds":
        if year is None:
            issues.append(QCIssue(
                check_id="year_missing_worlds",
                severity="ERROR",
                event_id=str(event_id),
                field="year",
                message="year is required for worlds events",
            ))

    if year is not None:
        if not (YEAR_MIN <= year <= YEAR_MAX):
            issues.append(QCIssue(
                check_id="year_out_of_range",
                severity="WARN",
                event_id=str(event_id),
                field="year",
                message=f"year {year} outside plausible range ({YEAR_MIN}-{YEAR_MAX})",
                example_value=str(year),
            ))
    return issues


def check_host_club(rec: dict) -> list[QCIssue]:
    """Check host_club: coverage tracking, club-like validation."""
    issues = []
    # We track coverage but don't error on missing - it's optional
    # Just warn on suspicious patterns
    event_id = rec.get("event_id", "")
    host_club = rec.get("host_club", "")

    if host_club and host_club.strip():
        # Check for URLs
        if re.search(r"https?://|www\.", host_club, re.IGNORECASE):
            issues.append(QCIssue(
                check_id="host_club_url",
                severity="WARN",
                event_id=str(event_id),
                field="host_club",
                message="host_club contains URL",
                example_value=host_club[:100],
            ))
    return issues


def check_placements_json(rec: dict) -> list[QCIssue]:
    """Check placements_json: valid JSON, schema validation."""
    issues = []
    event_id = rec.get("event_id", "")
    placements_str = rec.get("placements_json", "[]")

    try:
        placements = json.loads(placements_str)
    except json.JSONDecodeError as e:
        issues.append(QCIssue(
            check_id="placements_json_invalid",
            severity="ERROR",
            event_id=str(event_id),
            field="placements_json",
            message=f"Invalid JSON: {str(e)[:50]}",
            example_value=placements_str[:100],
        ))
        return issues

    # Schema checks on each placement
    for i, p in enumerate(placements):
        place = p.get("place")
        if place is None or place <= 0:
            issues.append(QCIssue(
                check_id="placements_place_invalid",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Placement {i}: place must be > 0",
                example_value=str(place),
                context={"placement_index": i},
            ))

        competitor_type = p.get("competitor_type", "")
        if competitor_type and competitor_type not in {"player", "team"}:
            issues.append(QCIssue(
                check_id="placements_competitor_type_invalid",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Placement {i}: competitor_type must be 'player' or 'team'",
                example_value=competitor_type,
                context={"placement_index": i},
            ))

        player1 = p.get("player1_name", "")
        if not player1 or not player1.strip():
            issues.append(QCIssue(
                check_id="placements_name_empty",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Placement {i}: player1_name is empty",
                context={"placement_index": i},
            ))
        elif len(player1) < 2:
            issues.append(QCIssue(
                check_id="placements_name_short",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Placement {i}: player1_name too short",
                example_value=player1,
                context={"placement_index": i},
            ))

        # Check for noise in player names (phone numbers, schedules, instructions)
        if player1:
            if re.search(r"\d{3}[-.]\d{3}[-.]\d{4}", player1):
                issues.append(QCIssue(
                    check_id="placements_name_noise",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Placement {i}: player name contains phone number",
                    example_value=player1[:60],
                    context={"placement_index": i, "noise_type": "phone"},
                ))
            elif re.search(r"\d{1,2}:\d{2}\s*(am|pm)", player1, re.IGNORECASE):
                issues.append(QCIssue(
                    check_id="placements_name_noise",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Placement {i}: player name contains schedule time",
                    example_value=player1[:60],
                    context={"placement_index": i, "noise_type": "schedule"},
                ))
            # Match admin text but NOT freestyle scoring (e.g., "31 contacts" is valid)
            elif re.search(r"registration|reservations|contact\s+(us|is|me|info)|please\s+contact", player1, re.IGNORECASE):
                issues.append(QCIssue(
                    check_id="placements_name_noise",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Placement {i}: player name contains admin text",
                    example_value=player1[:60],
                    context={"placement_index": i, "noise_type": "admin"},
                ))
            # Check for merged team entries (Player1 [seed] COUNTRY Player2 COUNTRY)
            if re.search(r"\[\d+\]\s+[A-Z]{3}\s+\w+", player1):
                issues.append(QCIssue(
                    check_id="placements_merged_team",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Placement {i}: team entry not properly split (tab-delimited format?)",
                    example_value=player1[:60],
                    context={"placement_index": i},
                ))
            # Check for unsplit team entries (contains " and " or " & " that should have been split)
            # This is a canonical format violation - teams should be split into player1/player2
            # Only flag if it looks like "Name1 & Name2" pattern (both parts start with capital)
            unsplit_match = re.search(r'\s+&\s+', player1)
            if unsplit_match:
                a = player1[:unsplit_match.start()].strip()
                b = player1[unsplit_match.end():].strip()
                # Both parts should look like names (start with capital, no special prefixes)
                a_clean = re.sub(r'^(tie\s*:|\(\s*tie\s*\)|\d+\s*[.)\-:]?\s*place\s*[-:]?)\s*', '', a, flags=re.IGNORECASE).strip()
                if (len(a_clean) >= 2 and len(b) >= 2 and
                    a_clean[0].isupper() and b[0].isupper() and
                    not re.search(r'\$|prize|place|pool|seed', player1, re.IGNORECASE)):
                    issues.append(QCIssue(
                        check_id="placements_unsplit_team",
                        severity="WARN",
                        event_id=str(event_id),
                        field="placements_json",
                        message=f"Placement {i}: team entry may not be properly split (contains '&')",
                        example_value=player1[:60],
                        context={"placement_index": i},
                    ))

        # Check for noise in division names
        div_canon = p.get("division_canon", "")
        if div_canon:
            if re.search(r"\d{1,2}:\d{2}", div_canon):
                issues.append(QCIssue(
                    check_id="placements_division_noise",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Placement {i}: division contains schedule time",
                    example_value=div_canon[:60],
                    context={"placement_index": i},
                ))
            elif re.search(r"registration|contact|email|click", div_canon, re.IGNORECASE):
                issues.append(QCIssue(
                    check_id="placements_division_noise",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Placement {i}: division contains instructions/links",
                    example_value=div_canon[:60],
                    context={"placement_index": i},
                ))

        # Check for player names with leading dashes or other corrupt prefixes
        player1 = p.get("player1_name", "")
        player2 = p.get("player2_name", "")
        for player_name in [player1, player2]:
            if player_name and player_name.startswith(('-', '–', '—')):
                issues.append(QCIssue(
                    check_id="cv_player_name_leading_dash",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Player name starts with dash (parsing error): {player_name[:60]}",
                    example_value=player_name[:60],
                    context={"placement_index": i}
                ))

        # Check for unknown division category when division_raw has keywords
        div_category = p.get("division_category", "")
        div_raw = p.get("division_raw", "")
        if div_category == "unknown" and div_raw:
            div_raw_lower = div_raw.lower()
            # Check if division_raw contains any known keywords
            found_keywords = []
            for kw in ["singles", "doubles", "net", "shred", "freestyle", "routine",
                      "homme", "femme", "feminin", "simple", "doble", "circle"]:
                if kw in div_raw_lower:
                    found_keywords.append(kw)
            if found_keywords:
                issues.append(QCIssue(
                    check_id="placements_unknown_with_keywords",
                    severity="WARN",
                    event_id=str(event_id),
                    field="division_category",
                    message=f"Placement {i}: division '{div_raw}' has keywords {found_keywords} but category=unknown",
                    example_value=div_raw[:60],
                    context={"placement_index": i, "keywords_found": found_keywords},
                ))

    return issues


def check_results_extraction(rec: dict) -> list[QCIssue]:
    """Warn if results_raw has content but no placements extracted."""
    issues = []
    event_id = rec.get("event_id", "")
    results_raw = rec.get("results_raw", "") or ""
    placements = json.loads(rec.get("placements_json", "[]"))

    # Check if results_raw looks like it has results data
    if len(results_raw) > 100:  # Non-trivial content
        # Look for strict placement patterns: "1. Name", "1) Name", "1: Name", "1 - Name"
        # Require explicit separator to avoid matching event format descriptions
        has_placements_pattern = bool(re.search(
            r'^\s*[1-9]\d?\s*[.):\-]\s+[A-Z][a-z]+(?:\s+[A-Z])?',
            results_raw,
            re.MULTILINE
        ))
        # Exclude false positives: event format descriptions
        # These contain patterns like "2 minute Routine", "Shred 30", "Sick 3"
        is_event_format = bool(re.search(
            r'\b\d+\s+minute|\bminute\s+routine|Open:\s+\d|\bShred\s+\d|Sick\s+\d',
            results_raw,
            re.IGNORECASE
        ))
        if has_placements_pattern and not placements and not is_event_format:
            issues.append(QCIssue(
                check_id="results_not_extracted",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message="Results raw has placement patterns but no placements extracted",
                example_value=results_raw[:200],
                context={"results_raw_length": len(results_raw)}
            ))
    return issues


def check_rejected_division_headers(rec: dict) -> list[QCIssue]:
    """INFO when event had lines rejected as division headers by is_valid_division_label (convergence signal)."""
    issues = []
    event_id = rec.get("event_id", "")
    raw = rec.get("rejected_division_headers", 0)
    try:
        rejected = int(raw) if raw not in (None, "") else 0
    except (TypeError, ValueError):
        rejected = 0
    if rejected > 0:
        issues.append(QCIssue(
            check_id="rejected_division_headers",
            severity="INFO",
            event_id=str(event_id),
            field="rejected_division_headers",
            message=f"Parser rejected {rejected} line(s) as division headers (placement/prize/section noise)",
            example_value=str(rejected),
            context={"rejected_division_headers": rejected},
        ))
    return issues


# ------------------------------------------------------------
# QC Cross-Validation Checks (Stage 2 Specific)
# ------------------------------------------------------------
def check_expected_divisions(rec: dict) -> list[QCIssue]:
    """Check if event has expected divisions based on event type."""
    issues = []
    event_id = rec.get("event_id", "")
    event_type = (rec.get("event_type") or "").lower()
    placements = json.loads(rec.get("placements_json", "[]"))

    if not placements or event_type not in EXPECTED_DIVISIONS:
        return issues

    # Get division categories present in placements
    categories_present = set()
    for p in placements:
        cat = p.get("division_category", "unknown")
        if cat and cat != "unknown":
            categories_present.add(cat)

    # Check required divisions
    expected = EXPECTED_DIVISIONS[event_type]
    for required_cat in expected.get("required", []):
        if required_cat not in categories_present:
            if event_type == "worlds" and required_cat == "net":
                # Pre-mirror era Worlds (pre-1990) had different division structures — skip.
                _year_val = rec.get("year", "")
                if str(_year_val).isdigit() and int(_year_val) < 1990:
                    continue
                # Only ERROR if raw page strongly signals net content but we extracted/classified none.
                raw = (
                    rec.get("results_block_raw")
                    or rec.get("results_raw")
                    or ""
                )
                s = str(raw).lower()

                net_signals = (
                    " net" in s
                    or "footbag net" in s
                    or "singles net" in s
                    or "doubles net" in s
                    # common net scoring pattern: "21-16, 21-11"
                    or bool(re.search(r"\b\d{1,2}-\d{1,2}\b.*\b\d{1,2}-\d{1,2}\b", s))
                )

                issues.append(QCIssue(
                    check_id="cv_worlds_missing_net",
                    severity=("ERROR" if net_signals else "WARN"),
                    event_id=str(event_id),
                    field="placements_json",
                    message=(
                        "Worlds event has no net divisions (net signals present in raw text)"
                        if net_signals else
                        "Worlds event has no net divisions (likely partial/variant page or mirror gap)"
                    ),
                    context={
                        "categories_present": list(categories_present),
                        "net_signals": net_signals,
                    }
                ))
            elif event_type == "net" and required_cat == "net":
                issues.append(QCIssue(
                    check_id="cv_net_event_no_net_divs",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message="event_type=net but no net divisions found",
                    context={"categories_present": list(categories_present)}
                ))
            elif event_type == "freestyle" and required_cat == "freestyle":
                issues.append(QCIssue(
                    check_id="cv_freestyle_event_no_freestyle_divs",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message="event_type=freestyle but no freestyle divisions found",
                    context={"categories_present": list(categories_present)}
                ))

    # Check expected (warn if missing)
    # Known Worlds events with external or limited results — suppress freestyle-missing check
    WORLDS_KNOWN_EXTERNAL_RESULTS = {
        "915561090": "1999 Worlds — freestyle results on external linked pages, not in mirror",
        "1587822289": "2020 Online Worlds — results on external wiki, not in mirror",
        "1623054449": "2021 Worlds — pandemic recovery year, freestyle-only championship format",
    }
    for expected_cat in expected.get("expected", []):
        if expected_cat not in categories_present:
            if event_type == "worlds" and expected_cat == "freestyle":
                # Pre-mirror era Worlds (pre-1990) had different division structures — skip.
                _year_val = rec.get("year", "")
                if str(_year_val).isdigit() and int(_year_val) < 1990:
                    continue
                if str(event_id) in WORLDS_KNOWN_EXTERNAL_RESULTS:
                    pass  # Known data gap — suppress warning
                else:
                    issues.append(QCIssue(
                        check_id="cv_worlds_missing_freestyle",
                        severity="WARN",
                        event_id=str(event_id),
                        field="placements_json",
                        message="Worlds event has no freestyle divisions",
                        context={"categories_present": list(categories_present)}
                    ))

    # cv_all_unknown_divisions: All placements have division_category=unknown
    if placements:
        all_unknown = all(p.get("division_category") == "unknown" for p in placements)
        if all_unknown:
            issues.append(QCIssue(
                check_id="cv_all_unknown_divisions",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message="All placements have division_category=unknown",
                context={"placement_count": len(placements)}
            ))

    return issues


def check_misplaced_golf(rec: dict) -> list[QCIssue]:
    """Flag event_type=golf when placements contain net-structural divisions (Mixed Doubles, etc.)."""
    issues = []
    if (rec.get("event_type") or "").lower() != "golf":
        return issues
    placements = []
    try:
        placements = json.loads(rec.get("placements_json", "[]"))
    except Exception:
        return issues
    if not placements:
        return issues
    net_structural_patterns = [
        "mixed double", "mixed single", "open single", "open double",
        "doubles net", "singles net",
    ]
    for p in placements:
        div = (p.get("division_canon") or p.get("division_raw") or "").lower()
        if not div:
            continue
        if "mixed" in div and ("double" in div or "single" in div):
            issues.append(QCIssue(
                check_id="misplaced_golf",
                severity="WARN",
                event_id=str(rec.get("event_id", "")),
                field="event_type",
                message="event_type=golf but placements include net division (e.g. Mixed Doubles); consider override to mixed/net",
                example_value=div[:60],
                context={"division_canon": p.get("division_canon", "")},
            ))
            break
        if any(phrase in div for phrase in net_structural_patterns):
            issues.append(QCIssue(
                check_id="misplaced_golf",
                severity="WARN",
                event_id=str(rec.get("event_id", "")),
                field="event_type",
                message="event_type=golf but placements include net-structural division name",
                example_value=div[:60],
                context={"division_canon": p.get("division_canon", "")},
            ))
            break
    return issues


def check_division_quality(rec: dict) -> list[QCIssue]:
    """Check for division name quality issues."""
    issues = []
    # Note: cv_division_looks_like_player check was removed as it had too many false positives
    # (e.g., "Single Homme" = French for "Men's Singles")

    event_id = rec.get("event_id", "")
    placements = json.loads(rec.get("placements_json", "[]"))

    # Check for non-English division headers (Spanish, Portuguese, etc.)
    spanish_keywords = {
        'resultados', 'dobles', 'individuales', 'mixto', 'mixta',
        'abierto', 'abierta', 'masculino', 'femenino', 'simples'
    }
    portuguese_keywords = {
        'resultados', 'duplas', 'individuais', 'misto', 'mista',
        'aberto', 'aberta', 'masculino', 'feminino'
    }
    french_keywords = {
        'résultats', 'doubles', 'simples', 'mixte', 'ouvert', 'ouverte',
        'homme', 'femme', 'masculin', 'féminin'
    }

    for i, p in enumerate(placements):
        div_raw = p.get("division_raw", "").lower()
        if not div_raw:
            continue

        # Check for Spanish keywords
        if any(keyword in div_raw for keyword in spanish_keywords):
            issues.append(QCIssue(
                check_id="cv_division_spanish",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Division header contains Spanish text: {p.get('division_raw', '')[:60]}",
                example_value=p.get('division_raw', '')[:60],
                context={"placement_index": i, "division_raw": p.get('division_raw', '')}
            ))
        # Check for Portuguese keywords (excluding overlap with Spanish)
        elif any(keyword in div_raw for keyword in portuguese_keywords - spanish_keywords):
            issues.append(QCIssue(
                check_id="cv_division_portuguese",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Division header contains Portuguese text: {p.get('division_raw', '')[:60]}",
                example_value=p.get('division_raw', '')[:60],
                context={"placement_index": i, "division_raw": p.get('division_raw', '')}
            ))
        # Check for French keywords (excluding overlap with English)
        elif any(keyword in div_raw for keyword in french_keywords - {'doubles', 'simples', 'mixte'}):
            issues.append(QCIssue(
                check_id="cv_division_french",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Division header contains French text: {p.get('division_raw', '')[:60]}",
                example_value=p.get('division_raw', '')[:60],
                context={"placement_index": i, "division_raw": p.get('division_raw', '')}
            ))

    return issues


_PLACEMENT_LIKE_PREFIX_RE = re.compile(r"^\s*\d{1,3}\s*[.)\-:]\s+\S")


def check_division_canon_looks_like_placement_line(rec: dict) -> list[QCIssue]:
    """
    WARN if any placement has a division_canon/division_raw that looks like a placement line,
    e.g. "1. LEVEL 2 RANKING". This is almost always division pollution.
    """
    issues: list[QCIssue] = []
    event_id = str(rec.get("event_id", ""))

    placements_json = rec.get("placements_json", "[]") or "[]"
    try:
        placements = json.loads(placements_json)
    except Exception:
        return issues  # existing check_placements_json handles malformed

    bad = []
    for p in placements:
        div = (p.get("division_canon") or p.get("division_raw") or "").strip()
        if not div:
            continue
        if _PLACEMENT_LIKE_PREFIX_RE.match(div):
            bad.append(div)

    if bad:
        # de-dupe but keep stable order
        seen = set()
        uniq = []
        for d in bad:
            if d not in seen:
                seen.add(d)
                uniq.append(d)

        issues.append(QCIssue(
            check_id="division_canon_looks_like_placement_line",
            severity="WARN",
            event_id=event_id,
            field="placements_json",
            message="Found placement-like text in division label (likely not a real division header).",
            example_value=uniq[0][:100],
            context={
                "count": len(bad),
                "unique_examples": uniq[:5],
            }
        ))

    return issues


def _division_looks_name_ish(div: str) -> bool:
    """True if division label looks like a name/narrative line (not a competitive division)."""
    if not div or len(div.strip()) < 3:
        return False
    t = div.strip()
    if _RE_HAS_DASH_NAME.search(t):
        return True
    if _RE_OVERALL.match(t):
        return True
    if _RE_CONTAINS_AND_NAME.search(t) and ("results" not in t.lower()):
        return True
    return False


def check_division_name_ish(rec: dict) -> list[QCIssue]:
    """
    WARN if any placement has a division that looks name-ish (dash+name, Overall, X and Y).
    These are usually headings/award/commentary lines misclassified as divisions.
    """
    issues: list[QCIssue] = []
    event_id = str(rec.get("event_id", ""))

    placements_json = rec.get("placements_json", "[]") or "[]"
    try:
        placements = json.loads(placements_json)
    except Exception:
        return issues

    bad = []
    for i, p in enumerate(placements):
        div = (p.get("division_canon") or p.get("division_raw") or "").strip()
        if _division_looks_name_ish(div):
            bad.append((i, div))

    if bad:
        seen = set()
        uniq = []
        for _idx, d in bad:
            if d not in seen:
                seen.add(d)
                uniq.append(d)
        issues.append(QCIssue(
            check_id="division_name_ish",
            severity="WARN",
            event_id=event_id,
            field="placements_json",
            message="Division label looks name-ish (dash+name, Overall, or 'X and Y' narrative).",
            example_value=uniq[0][:100] if uniq else "",
            context={"count": len(bad), "unique_examples": uniq[:5]},
        ))

    return issues


def check_team_splitting(rec: dict) -> list[QCIssue]:
    """Check for doubles teams that weren't properly split."""
    issues = []
    event_id = rec.get("event_id", "")
    placements = json.loads(rec.get("placements_json", "[]"))

    for i, p in enumerate(placements):
        competitor_type = p.get("competitor_type", "")
        player1 = p.get("player1_name", "")
        player2 = p.get("player2_name", "")
        div_canon = p.get("division_canon", "")

        # cv_doubles_unsplit_team: Doubles division with single player (missed separator)
        is_doubles_div = "doubles" in div_canon.lower() or "double" in div_canon.lower()
        if is_doubles_div and competitor_type == "player" and player1 and not player2:
            # Check if player1 looks like it might contain two names with dash separator
            # Pattern: "Name1 - Name2" where both parts look like names
            # Matches: hyphen-minus (U+002D), en-dash (U+2013), em-dash (U+2014)
            dash_pattern = re.match(r'^(.+?)\s+[-–—]\s+(.+)$', player1)
            if dash_pattern:
                part1, part2 = dash_pattern.groups()
                # Validate both parts look like names (at least 2 chars, start with capital)
                if (len(part1.strip()) >= 2 and len(part2.strip()) >= 2 and
                    part1.strip()[0].isupper() and part2.strip()[0].isupper()):
                    issues.append(QCIssue(
                        check_id="cv_doubles_dash_separator",
                        severity="WARN",
                        event_id=str(event_id),
                        field="placements_json",
                        message=f"Doubles team using dash separator instead of '/': {player1[:60]}",
                        example_value=player1[:60],
                        context={"placement_index": i, "division": div_canon}
                    ))
                    continue

            # Check if player1 looks like it might contain two names with other separators
            if " & " in player1 or " and " in player1.lower():
                issues.append(QCIssue(
                    check_id="cv_doubles_unsplit_team",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Doubles division with unsplit team: {player1[:60]}",
                    example_value=player1[:60],
                    context={"placement_index": i, "division": div_canon}
                ))

    return issues


def check_year_date_consistency(rec: dict) -> list[QCIssue]:
    """Check if year field matches year in date field."""
    issues = []
    event_id = rec.get("event_id", "")
    year = rec.get("year")
    date_str = rec.get("date", "")

    if year and date_str:
        # Extract year from date
        year_match = re.search(r'\b(19|20)\d{2}\b', date_str)
        if year_match:
            date_year = int(year_match.group(0))
            if date_year != year:
                issues.append(QCIssue(
                    check_id="cv_year_date_mismatch",
                    severity="ERROR",
                    event_id=str(event_id),
                    field="year",
                    message=f"Year field ({year}) doesn't match year in date ({date_year})",
                    example_value=date_str,
                    context={"year_field": year, "date_year": date_year}
                ))

    return issues


# ------------------------------------------------------------
# QC Cross-Record Checks
# ------------------------------------------------------------
def check_event_id_uniqueness(records: list[dict]) -> list[QCIssue]:
    """Check that event_id values are unique."""
    issues = []
    seen = {}
    for rec in records:
        event_id = str(rec.get("event_id", ""))
        if event_id in seen:
            issues.append(QCIssue(
                check_id="event_id_duplicate",
                severity="ERROR",
                event_id=event_id,
                field="event_id",
                message=f"Duplicate event_id (first seen at index {seen[event_id]})",
                context={"first_index": seen[event_id]},
            ))
        else:
            seen[event_id] = len(seen)
    return issues


def check_worlds_per_year(records: list[dict]) -> list[QCIssue]:
    """Check exactly one worlds event per year."""
    issues = []
    worlds_by_year = defaultdict(list)

    for rec in records:
        event_type = rec.get("event_type", "")
        if event_type and event_type.lower() == "worlds":
            year = rec.get("year")
            if year:
                worlds_by_year[year].append(rec.get("event_id"))

    for year, event_ids in worlds_by_year.items():
        if len(event_ids) > 1:
            # Pre-mirror era (year < 1990): multiple source records for same event are expected
            _year_int = int(year) if str(year).isdigit() else 9999
            if _year_int < 1990:
                continue
            issues.append(QCIssue(
                check_id="worlds_multiple_per_year",
                severity="ERROR",
                event_id=str(event_ids[0]),
                field="event_type",
                message=f"Multiple worlds events in {year}: {event_ids}",
                context={"year": year, "event_ids": event_ids},
            ))

    return issues


def check_duplicates(records: list[dict]) -> list[QCIssue]:
    """Check for duplicate (year, event_name, location) combinations."""
    issues = []
    seen = {}

    for rec in records:
        year = rec.get("year")
        event_name = (rec.get("event_name") or "").strip().lower()
        location = (rec.get("location") or "").strip().lower()

        if year and event_name:
            key = (year, event_name, location)
            if key in seen:
                issues.append(QCIssue(
                    check_id="duplicate_event",
                    severity="WARN",
                    event_id=str(rec.get("event_id")),
                    field="event_name",
                    message=f"Possible duplicate: same (year, event_name, location) as event {seen[key]}",
                    context={"duplicate_of": seen[key], "year": year},
                ))
            else:
                seen[key] = rec.get("event_id")

    return issues


# ------------------------------------------------------------
# Universal String Hygiene Checks
# ------------------------------------------------------------
def check_string_hygiene(rec: dict) -> list[QCIssue]:
    """Check for string hygiene issues across all text fields."""
    issues = []
    event_id = rec.get("event_id", "")

    # Fields to check
    fields_to_check = {
        'event_name': rec.get('event_name', ''),
        'date': rec.get('date', ''),
        'location': rec.get('location', ''),
        'host_club': rec.get('host_club', '')
    }

    for field_name, value in fields_to_check.items():
        if not value:
            continue

        # Leading/trailing whitespace
        if value != value.strip():
            issues.append(QCIssue(
                check_id="string_whitespace",
                severity="WARN",
                event_id=str(event_id),
                field=field_name,
                message=f"{field_name} has leading/trailing whitespace",
                example_value=repr(value[:60]),
                context={"field": field_name}
            ))

        # Multiple consecutive spaces
        if '  ' in value:
            issues.append(QCIssue(
                check_id="string_double_space",
                severity="INFO",
                event_id=str(event_id),
                field=field_name,
                message=f"{field_name} has multiple consecutive spaces",
                example_value=value[:60],
                context={"field": field_name}
            ))

        # Control characters
        if re.search(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', value):
            issues.append(QCIssue(
                check_id="string_control_chars",
                severity="ERROR",
                event_id=str(event_id),
                field=field_name,
                message=f"{field_name} contains control characters",
                example_value=repr(value[:60]),
                context={"field": field_name}
            ))

        # Unicode replacement character or mojibake patterns (known encoding issues in source HTML)
        if '\ufffd' in value or re.search(r'â€|Ã[^\s]{1,2}\s', value):
            issues.append(QCIssue(
                check_id="string_mojibake",
                severity="INFO",
                event_id=str(event_id),
                field=field_name,
                message=f"{field_name} may contain mojibake/encoding issues",
                example_value=value[:60],
                context={"field": field_name}
            ))

        # HTML remnants
        if re.search(r'<[^>]+>|&nbsp;|&amp;|&lt;|&gt;|&quot;', value):
            issues.append(QCIssue(
                check_id="string_html_remnants",
                severity="WARN",
                event_id=str(event_id),
                field=field_name,
                message=f"{field_name} contains HTML tags or entities",
                example_value=value[:60],
                context={"field": field_name}
            ))

        # URL or email leakage
        if re.search(r'https?://|www\.|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', value):
            issues.append(QCIssue(
                check_id="string_url_email",
                severity="WARN",
                event_id=str(event_id),
                field=field_name,
                message=f"{field_name} contains URL or email address",
                example_value=value[:60],
                context={"field": field_name}
            ))

    return issues


def check_location_semantics(rec: dict) -> list[QCIssue]:
    """Check location field for semantic issues."""
    issues = []
    event_id = rec.get("event_id", "")
    location = rec.get("location", "")

    if not location:
        return issues

    # Street addresses (3+ consecutive digits) - BUT exclude legitimate building numbers
    # FALSE POSITIVES to exclude:
    # - School building numbers: "nr 312", "nr 116" (Polish/European naming convention)
    # - Building/venue numbers in addresses
    # - Actual postal codes should have been removed by canonicalize_location()

    # Check for 3+ consecutive digits (potential address/postal code)
    if re.search(r'\d{3,}', location):
        # Skip if it's a school/building number (e.g., "nr 312" or "no. 116")
        if not re.search(r'\b(?:nr|no\.?|n°|numer)\s*\d+', location, flags=re.IGNORECASE):
            # Skip if it's a venue name with building number like "Malostranske namesti 262/9"
            # where the street name is part of the venue (don't remove it)
            if not re.search(r'\b(?:namesti|plac|plaats|piazza)\b.*\d', location, flags=re.IGNORECASE):
                issues.append(QCIssue(
                    check_id="location_has_street_address",
                    severity="WARN",
                    event_id=str(event_id),
                    field="location",
                    message="Location appears to contain street address/ZIP code",
                    example_value=location[:80],
                    context={"pattern": "digits"}
                ))

    # Multiple venues (semicolons)
    if ';' in location:
        issues.append(QCIssue(
            check_id="location_multiple_venues",
            severity="WARN",
            event_id=str(event_id),
            field="location",
            message="Location contains semicolon (multiple venues?)",
            example_value=location[:80],
            context={"semicolon_count": location.count(';')}
        ))

    # Parenthetical notes (often venue details that should be elsewhere)
    if '(' in location or ')' in location:
        issues.append(QCIssue(
            check_id="location_parenthetical",
            severity="INFO",
            event_id=str(event_id),
            field="location",
            message="Location contains parenthetical note",
            example_value=location[:80],
            context={}
        ))

    # TBA/TBD placeholders
    if re.search(r'\bTBA\b|\bTBD\b', location, re.IGNORECASE):
        issues.append(QCIssue(
            check_id="location_tba",
            severity="WARN",
            event_id=str(event_id),
            field="location",
            message="Location contains TBA/TBD placeholder",
            example_value=location[:80],
            context={}
        ))

    # Narrative/instruction tokens
    if re.search(r'\b(contact|details|see below|hosted by|venue|site|registration)\b', location, re.IGNORECASE):
        issues.append(QCIssue(
            check_id="location_narrative",
            severity="WARN",
            event_id=str(event_id),
            field="location",
            message="Location contains narrative/instruction text",
            example_value=location[:80],
            context={}
        ))

    # Very long location (likely narrative)
    if len(location) > 100:
        issues.append(QCIssue(
            check_id="location_too_long",
            severity="WARN",
            event_id=str(event_id),
            field="location",
            message=f"Location is very long ({len(location)} chars), may contain narrative",
            example_value=location[:80],
            context={"length": len(location)}
        ))

    return issues


def check_date_semantics(rec: dict) -> list[QCIssue]:
    """Check date field for semantic issues beyond basic parsing."""
    issues = []
    event_id = rec.get("event_id", "")
    date_str = rec.get("date", "")

    if not date_str:
        return issues

    # iCal leakage
    if re.search(r'\bical\b|\bsubscribe\b', date_str, re.IGNORECASE):
        issues.append(QCIssue(
            check_id="date_ical_leakage",
            severity="WARN",
            event_id=str(event_id),
            field="date",
            message="Date field contains iCal UI text",
            example_value=date_str[:80],
            context={}
        ))

    # Very long date (narrative schedule)
    if len(date_str) > 100:
        issues.append(QCIssue(
            check_id="date_too_long",
            severity="WARN",
            event_id=str(event_id),
            field="date",
            message=f"Date is very long ({len(date_str)} chars), may contain schedule narrative",
            example_value=date_str[:80],
            context={"length": len(date_str)}
        ))

    # Multiple semicolons (complex multi-date narrative)
    if date_str.count(';') > 2:
        issues.append(QCIssue(
            check_id="date_many_semicolons",
            severity="INFO",
            event_id=str(event_id),
            field="date",
            message="Date contains many semicolons (complex schedule?)",
            example_value=date_str[:80],
            context={"semicolon_count": date_str.count(';')}
        ))

    return issues


def check_host_club_semantics(rec: dict) -> list[QCIssue]:
    """Check host_club field for semantic issues."""
    issues = []
    event_id = rec.get("event_id", "")
    host_club = rec.get("host_club", "")

    if not host_club:
        return issues

    # Numbered list prefix (parsing artifact)
    if re.match(r'^\d+\.', host_club):
        issues.append(QCIssue(
            check_id="host_club_numbered_prefix",
            severity="WARN",
            event_id=str(event_id),
            field="host_club",
            message="Host club starts with number prefix (parsing artifact)",
            example_value=host_club[:80],
            context={}
        ))

    # Very long (narrative or location leakage)
    if len(host_club) > 80:
        issues.append(QCIssue(
            check_id="host_club_too_long",
            severity="INFO",
            event_id=str(event_id),
            field="host_club",
            message=f"Host club is very long ({len(host_club)} chars)",
            example_value=host_club[:80],
            context={"length": len(host_club)}
        ))

    return issues


def check_player_name_quality(rec: dict) -> list[QCIssue]:
    """Check player names within placements for quality issues."""
    issues = []
    event_id = rec.get("event_id", "")
    placements = json.loads(rec.get("placements_json", "[]"))

    for i, p in enumerate(placements):
        player1 = p.get("player1_name", "")
        player2 = p.get("player2_name", "")

        # Check for duplicate same player in team
        if player1 and player2 and player1 == player2:
            issues.append(QCIssue(
                check_id="player_duplicate_in_team",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Team has same player twice: {player1}",
                example_value=f"{player1} / {player2}",
                context={"placement_index": i}
            ))

        for player_name in [player1, player2]:
            if not player_name:
                continue

            # Slash in player name (should be split into team)
            # Skip if all slashes are inside parentheses (country/club info)
            # Skip if it's country codes (e.g., "Name GER/USA" or "Name DE/CH" or "Name (SUI)/(GER)")
            # Skip if it's a score pattern (e.g., "11/3", "9/7" - tournament results embedded in narrative)
            if '/' in player_name:
                # Check for country code pattern: 2-3 uppercase letters separated by slash
                # Matches: "GER/USA", "USA/(GER)", "(SUI)/(GER)", etc.
                is_country_code = bool(re.search(r'[A-Z]{2,3}\s*/\s*[A-Z]{2,3}|\([A-Z]{2,3}\)\s*/\s*\([A-Z]{2,3}\)', player_name))

                # Check for clear team separator with spaces: "Name / Name" or "Name and Name"
                name_no_parens = re.sub(r'\([^)]*\)', '', player_name)
                is_team_separator = ' / ' in name_no_parens or ' and ' in name_no_parens

                # Check if slash only appears inside parentheses
                is_parens_only = '/' not in name_no_parens

                # Check for score pattern (e.g., "11/3", "9/7", "9/4 5/9 9/3")
                # These are tournament match scores, not player names
                is_score_pattern = bool(re.search(r'^\d+/\d+(?:\s+\d+/\d+)*$|[\s\d]/\d+', player_name))

                if not is_country_code and not is_team_separator and not is_parens_only and not is_score_pattern:
                    issues.append(QCIssue(
                        check_id="player_has_slash",
                        severity="WARN",
                        event_id=str(event_id),
                        field="placements_json",
                        message=f"Player name contains slash: {player_name[:60]}",
                        example_value=player_name[:60],
                        context={"placement_index": i}
                    ))

            # Score/numeric patterns in name (scores should be in notes)
            if re.search(r'\(\d{2,}\.\d{2}\)|\(\d{3,}\s+add', player_name, re.IGNORECASE):
                issues.append(QCIssue(
                    check_id="player_has_score",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Player name contains score: {player_name[:60]}",
                    example_value=player_name[:60],
                    context={"placement_index": i}
                ))

            # Admin commentary tokens
            if re.search(r'\b(tie|pool|seed|record|commentary|disqualif|dnf|dns)\b', player_name, re.IGNORECASE):
                # But "tie" at the start might be legitimate for ties
                if not player_name.lower().startswith('tie '):
                    issues.append(QCIssue(
                        check_id="player_has_admin_text",
                        severity="INFO",
                        event_id=str(event_id),
                        field="placements_json",
                        message=f"Player name contains admin text: {player_name[:60]}",
                        example_value=player_name[:60],
                        context={"placement_index": i}
                    ))

            # Month-name date contamination — "january", "of january", etc.
            # These arise when round-date headers ("9th january") are parsed
            # as placements.  A standalone month name is never a valid competitor.
            if re.fullmatch(
                r'(of\s+)?(january|february|march|april|may|june|july|august|'
                r'september|october|november|december)',
                player_name.strip(), re.IGNORECASE
            ):
                issues.append(QCIssue(
                    check_id="player_has_month_name",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Player name is a month/date fragment (date contamination): {player_name!r}",
                    example_value=player_name[:60],
                    context={"placement_index": i}
                ))

            # Semicolons (multiple entries or move descriptions)
            if ';' in player_name:
                issues.append(QCIssue(
                    check_id="player_has_semicolon",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Player name contains semicolon: {player_name[:60]}",
                    example_value=player_name[:60],
                    context={"placement_index": i}
                ))

            # Very long name (narrative commentary)
            if len(player_name) > 60:
                issues.append(QCIssue(
                    check_id="player_name_too_long",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Player name is very long ({len(player_name)} chars): {player_name[:60]}",
                    example_value=player_name[:60],
                    context={"placement_index": i, "length": len(player_name)}
                ))

            # Leading/trailing whitespace
            if player_name != player_name.strip():
                issues.append(QCIssue(
                    check_id="player_name_whitespace",
                    severity="WARN",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Player name has whitespace issues: {repr(player_name[:60])}",
                    example_value=repr(player_name[:60]),
                    context={"placement_index": i}
                ))

    return issues


def check_division_name_quality(rec: dict) -> list[QCIssue]:
    """Check division names for quality issues beyond language detection."""
    issues = []
    event_id = rec.get("event_id", "")
    placements = json.loads(rec.get("placements_json", "[]"))

    seen_divisions = set()
    for i, p in enumerate(placements):
        div_canon = p.get("division_canon", "")

        if not div_canon:
            continue

        seen_divisions.add(div_canon)

        # Very long division name (narrative)
        if len(div_canon) > 60:
            issues.append(QCIssue(
                check_id="division_too_long",
                severity="WARN",
                event_id=str(event_id),
                field="placements_json",
                message=f"Division name is very long ({len(div_canon)} chars): {div_canon[:60]}",
                example_value=div_canon[:60],
                context={"placement_index": i, "length": len(div_canon)}
            ))

        # Schedule time in division name (already checked elsewhere, but be comprehensive)
        if re.search(r'\d{1,2}:\d{2}\s*(am|pm)?', div_canon, re.IGNORECASE):
            # Already handled in check_placements_json, skip to avoid duplicate
            pass

        # Registration/admin text in division name
        if re.search(r'\b(registration|contact|email|click here|register|sign.?up)\b', div_canon, re.IGNORECASE):
            # Already handled in check_placements_json, skip
            pass

    return issues


def check_event_name_quality(rec: dict) -> list[QCIssue]:
    """Check event name for quality issues."""
    issues = []
    event_id = rec.get("event_id", "")
    event_name = rec.get("event_name", "")

    if not event_name:
        return issues

    # Very long event name
    if len(event_name) > 100:
        issues.append(QCIssue(
            check_id="event_name_too_long",
            severity="INFO",
            event_id=str(event_id),
            field="event_name",
            message=f"Event name is very long ({len(event_name)} chars)",
            example_value=event_name[:80],
            context={"length": len(event_name)}
        ))

    return issues


def check_year_range(rec: dict) -> list[QCIssue]:
    """Check if year is in reasonable range."""
    issues = []
    event_id = rec.get("event_id", "")
    year = rec.get("year")

    if not year:
        return issues

    # Year should be between 1980 and 2030 (footbag sport started in late 1970s)
    if year < 1980 or year > 2030:
        issues.append(QCIssue(
            check_id="year_out_of_range",
            severity="ERROR",
            event_id=str(event_id),
            field="year",
            message=f"Year {year} is outside reasonable range (1980-2030)",
            example_value=str(year),
            context={"year": year}
        ))

    return issues


def check_field_leakage(rec: dict) -> list[QCIssue]:
    """Check for field content leaking into wrong fields."""
    issues = []
    event_id = rec.get("event_id", "")
    event_name = rec.get("event_name", "")
    location = rec.get("location", "")
    host_club = rec.get("host_club", "")

    # Check if location contains event name fragments (significant overlap)
    if event_name and location:
        # Check for significant word overlap
        event_words = set(event_name.lower().split())
        location_words = set(location.lower().split())
        # Ignore common words
        common_words = {'the', 'of', 'and', 'in', 'at', 'to', 'a', 'for', 'on', 'with'}
        event_words -= common_words
        location_words -= common_words

        overlap = event_words & location_words
        # If >50% of event name words appear in location, flag it
        if event_words and len(overlap) / len(event_words) > 0.5 and len(overlap) >= 3:
            issues.append(QCIssue(
                check_id="location_contains_event_name",
                severity="INFO",
                event_id=str(event_id),
                field="location",
                message="Location may contain event name fragments",
                example_value=f"Event: {event_name[:40]} | Location: {location[:40]}",
                context={"overlap_words": list(overlap)[:5]}
            ))

    # Check if host_club contains location fragments
    if host_club and location:
        # Simple check: if location city appears in host_club
        if ',' in location:
            city = location.split(',')[0].strip()
            if len(city) > 3 and city.lower() in host_club.lower():
                issues.append(QCIssue(
                    check_id="host_club_contains_location",
                    severity="INFO",
                    event_id=str(event_id),
                    field="host_club",
                    message=f"Host club may contain location: '{city}' found in club name",
                    example_value=host_club[:60],
                    context={"city": city}
                ))

    return issues


def check_place_values(rec: dict) -> list[QCIssue]:
    """Check place values for semantic issues."""
    issues = []
    event_id = rec.get("event_id", "")
    placements = json.loads(rec.get("placements_json", "[]"))

    # Group by division to check place sequences
    by_division = defaultdict(list)
    for i, p in enumerate(placements):
        div_canon = p.get("division_canon", "Unknown")
        place = p.get("place", "")
        by_division[div_canon].append((i, place))

    for div_canon, place_list in by_division.items():
        for i, place in place_list:
            if not place:
                continue

            try:
                # Try to parse place as integer
                if isinstance(place, str):
                    # Handle "1st", "2nd", etc.
                    place_num = int(re.match(r'(\d+)', place).group(1))
                else:
                    place_num = int(place)

                # Zero or negative
                if place_num <= 0:
                    issues.append(QCIssue(
                        check_id="place_zero_or_negative",
                        severity="ERROR",
                        event_id=str(event_id),
                        field="placements_json",
                        message=f"Place is zero or negative: {place}",
                        example_value=str(place),
                        context={"placement_index": i, "division": div_canon}
                    ))

                # Huge outlier (>200 is suspicious)
                if place_num > 200:
                    issues.append(QCIssue(
                        check_id="place_huge_outlier",
                        severity="WARN",
                        event_id=str(event_id),
                        field="placements_json",
                        message=f"Place is unusually large: {place}",
                        example_value=str(place),
                        context={"placement_index": i, "division": div_canon, "place": place_num}
                    ))

            except (ValueError, AttributeError):
                # Non-numeric place
                issues.append(QCIssue(
                    check_id="place_non_numeric",
                    severity="ERROR",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Place is not numeric: {place}",
                    example_value=str(place),
                    context={"placement_index": i, "division": div_canon}
                ))

    return issues


def check_place_sequences(rec: dict) -> list[QCIssue]:
    """Check for issues in place sequences within divisions."""
    issues = []
    event_id = rec.get("event_id", "")
    placements = json.loads(rec.get("placements_json", "[]"))

    # Group by division
    by_division = defaultdict(list)
    for i, p in enumerate(placements):
        div_canon = p.get("division_canon", "Unknown")
        place = p.get("place", "")
        by_division[div_canon].append((i, place, p))

    for div_canon, place_list in by_division.items():
        if len(place_list) < 2:
            continue

        # Extract numeric places
        places_numeric = []
        for i, place, p in place_list:
            try:
                if isinstance(place, str):
                    place_num = int(re.match(r'(\d+)', place).group(1))
                else:
                    place_num = int(place)
                places_numeric.append((i, place_num, p))
            except (ValueError, AttributeError):
                pass

        if not places_numeric:
            continue

        # Sort by place
        places_numeric.sort(key=lambda x: x[1])

        # Check if first place is not 1
        if places_numeric[0][1] != 1:
            issues.append(QCIssue(
                check_id="place_does_not_start_at_1",
                severity="INFO",
                event_id=str(event_id),
                field="placements_json",
                message=f"Division '{div_canon}' places start at {places_numeric[0][1]}, not 1",
                example_value=f"{div_canon}: first place = {places_numeric[0][1]}",
                context={"division": div_canon, "first_place": places_numeric[0][1]}
            ))

        # Check for large gaps (>5) in sequence
        for j in range(1, len(places_numeric)):
            prev_place = places_numeric[j-1][1]
            curr_place = places_numeric[j][1]
            gap = curr_place - prev_place

            if gap > 5:
                issues.append(QCIssue(
                    check_id="place_large_gap",
                    severity="INFO",
                    event_id=str(event_id),
                    field="placements_json",
                    message=f"Large gap in places: {prev_place} -> {curr_place} (gap={gap})",
                    example_value=f"{div_canon}: {prev_place} -> {curr_place}",
                    context={"division": div_canon, "gap": gap, "from": prev_place, "to": curr_place}
                ))

    return issues


def check_missing_required_fields(rec: dict) -> list[QCIssue]:
    """Check for missing values in required fields that weren't caught elsewhere."""
    issues = []
    event_id = rec.get("event_id", "")

    # Date is missing (not already checked by check_date)
    if not rec.get("date"):
        issues.append(QCIssue(
            check_id="date_missing",
            severity="WARN",
            event_id=str(event_id),
            field="date",
            message="Date is missing",
            example_value="",
            context={}
        ))

    # Year is missing
    if not rec.get("year"):
        issues.append(QCIssue(
            check_id="year_missing",
            severity="WARN",
            event_id=str(event_id),
            field="year",
            message="Year is missing",
            example_value="",
            context={}
        ))

    return issues


def check_country_names(rec: dict) -> list[QCIssue]:
    """Check for non-English country names or inconsistent variants."""
    issues = []
    event_id = rec.get("event_id", "")
    location = rec.get("location", "")

    if not location:
        return issues

    # Extract last comma-separated segment (likely country)
    if ',' in location:
        country = location.split(',')[-1].strip()

        # Check for non-English country names (common ones)
        non_english_countries = {
            'Deutschland': 'Germany',
            'Österreich': 'Austria',
            'Schweiz': 'Switzerland',
            'España': 'Spain',
            'México': 'Mexico',
            'Brasil': 'Brazil',
            'Česká republika': 'Czech Republic',
            'Česko': 'Czech Republic',
            'Polska': 'Poland',
            'Italia': 'Italy'
        }

        for non_eng, eng in non_english_countries.items():
            if non_eng.lower() in country.lower():
                issues.append(QCIssue(
                    check_id="location_non_english_country",
                    severity="INFO",
                    event_id=str(event_id),
                    field="location",
                    message=f"Country name may be non-English: '{country}' (expected '{eng}'?)",
                    example_value=location[:80],
                    context={"country_segment": country, "expected": eng}
                ))

    return issues


# ------------------------------------------------------------
# Cross-Record Consistency Checks
# ------------------------------------------------------------
def check_host_club_location_consistency(records: list[dict]) -> list[QCIssue]:
    """Check if same host club appears with different locations."""
    issues = []

    # Map host_club -> set of locations
    club_to_locations = defaultdict(set)
    club_to_event_ids = defaultdict(list)

    for rec in records:
        host_club = rec.get("host_club", "")
        location = rec.get("location", "")
        event_id = rec.get("event_id", "")

        if host_club and location:
            # Normalize host club for comparison
            club_normalized = host_club.strip().lower()
            club_to_locations[club_normalized].add(location)
            club_to_event_ids[club_normalized].append((event_id, location))

    # Check for clubs with multiple different locations
    for club_norm, locations in club_to_locations.items():
        if len(locations) > 3:  # More than 3 different locations is suspicious
            # Get original club name from first event
            first_event_id, _ = club_to_event_ids[club_norm][0]
            first_rec = next((r for r in records if r.get("event_id") == first_event_id), None)
            if first_rec:
                club_name = first_rec.get("host_club", "")
                issues.append(QCIssue(
                    check_id="host_club_multiple_locations",
                    severity="INFO",
                    event_id=str(first_event_id),
                    field="host_club",
                    message=f"Host club '{club_name}' appears with {len(locations)} different locations",
                    example_value=club_name[:60],
                    context={
                        "location_count": len(locations),
                        "locations": list(locations)[:5]
                    }
                ))

    return issues


# ------------------------------------------------------------
# QC Orchestration
# ------------------------------------------------------------
def run_qc(records: list[dict]) -> tuple[dict, list[dict]]:
    """
    Run all QC checks on records.
    Returns (summary_dict, issues_list).
    """
    all_issues = []

    # Field-level checks
    for rec in records:
        # Basic field validation
        all_issues.extend(check_event_id(rec))
        all_issues.extend(check_event_name(rec))
        all_issues.extend(check_event_type(rec))
        all_issues.extend(check_location(rec))
        all_issues.extend(check_date(rec))
        all_issues.extend(check_year(rec))
        all_issues.extend(check_host_club(rec))
        all_issues.extend(check_placements_json(rec))
        all_issues.extend(check_results_extraction(rec))
        all_issues.extend(check_rejected_division_headers(rec))

        # Universal string hygiene
        all_issues.extend(check_string_hygiene(rec))

        # Enhanced field quality checks
        all_issues.extend(check_event_name_quality(rec))
        all_issues.extend(check_year_range(rec))
        all_issues.extend(check_missing_required_fields(rec))

        # Semantic field checks
        all_issues.extend(check_location_semantics(rec))
        all_issues.extend(check_date_semantics(rec))
        all_issues.extend(check_host_club_semantics(rec))
        all_issues.extend(check_country_names(rec))

        # Field leakage checks
        all_issues.extend(check_field_leakage(rec))

        # Placements quality checks
        all_issues.extend(check_player_name_quality(rec))
        all_issues.extend(check_division_name_quality(rec))
        all_issues.extend(check_division_canon_looks_like_placement_line(rec))
        all_issues.extend(check_division_name_ish(rec))
        all_issues.extend(check_place_values(rec))
        all_issues.extend(check_place_sequences(rec))

        # Cross-validation checks (Stage 2 specific)
        all_issues.extend(check_expected_divisions(rec))
        all_issues.extend(check_misplaced_golf(rec))
        all_issues.extend(check_division_quality(rec))
        all_issues.extend(check_team_splitting(rec))
        all_issues.extend(check_year_date_consistency(rec))

    # Cross-record checks
    all_issues.extend(check_event_id_uniqueness(records))
    all_issues.extend(check_worlds_per_year(records))
    all_issues.extend(check_duplicates(records))
    all_issues.extend(check_host_club_location_consistency(records))

    # Slop detection checks (comprehensive field scanning + targeted checks)
    try:
        from qc.qc_master import run_slop_detection_checks_stage2 as _slop
        slop_issues = _slop(records)
    except Exception as e:
        print(f"[QC] WARNING: slop checks unavailable ({e}); skipping slop detection.")
        slop_issues = []
    all_issues.extend(slop_issues)

    # Build summary
    counts_by_check = defaultdict(lambda: {"ERROR": 0, "WARN": 0, "INFO": 0})
    for issue in all_issues:
        counts_by_check[issue.check_id][issue.severity] += 1

    total_errors = sum(1 for i in all_issues if i.severity == "ERROR")
    total_warnings = sum(1 for i in all_issues if i.severity == "WARN")
    total_info = sum(1 for i in all_issues if i.severity == "INFO")

    # Field coverage stats
    field_coverage = {}
    for field in ["event_id", "event_name", "date", "location", "host_club", "event_type", "year"]:
        non_empty = sum(1 for r in records if r.get(field) not in [None, ""])
        field_coverage[field] = {
            "present": non_empty,
            "total": len(records),
            "percent": round(100 * non_empty / len(records), 1) if records else 0,
        }

    summary = {
        "total_records": len(records),
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "total_info": total_info,
        "counts_by_check": dict(counts_by_check),
        "field_coverage": field_coverage,
    }

    return summary, [i.to_dict() for i in all_issues]


def write_qc_outputs(summary: dict, issues: list[dict], out_dir: Path) -> None:
    """Write QC summary and issues to output files."""
    # Write summary JSON
    summary_path = out_dir / "stage2_qc_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Wrote: {summary_path}")

    # Write issues JSONL
    issues_path = out_dir / "stage2_qc_issues.jsonl"
    with open(issues_path, "w", encoding="utf-8") as f:
        for issue in issues:
            f.write(json.dumps(issue, ensure_ascii=False) + "\n")
    print(f"Wrote: {issues_path} ({len(issues)} issues)")


def load_baseline(data_dir: Path) -> Optional[dict]:
    """Load QC baseline if it exists."""
    baseline_path = data_dir / "qc_baseline_stage2.json"
    if baseline_path.exists():
        with open(baseline_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_baseline(summary: dict, data_dir: Path) -> None:
    """Save QC summary as baseline."""
    data_dir.mkdir(parents=True, exist_ok=True)
    baseline_path = data_dir / "qc_baseline_stage2.json"
    with open(baseline_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Saved baseline: {baseline_path}")


def print_qc_delta(current: dict, baseline: dict) -> bool:
    """
    Print delta between current and baseline QC results.
    Returns True if no regressions (ERROR increases), False otherwise.
    """
    print(f"\n{'='*60}")
    print("QC DELTA REPORT (vs baseline)")
    print(f"{'='*60}")

    baseline_checks = baseline.get("counts_by_check", {})
    current_checks = current.get("counts_by_check", {})

    all_checks = set(baseline_checks.keys()) | set(current_checks.keys())
    regressions = []

    for check_id in sorted(all_checks):
        b = baseline_checks.get(check_id, {"ERROR": 0, "WARN": 0, "INFO": 0})
        c = current_checks.get(check_id, {"ERROR": 0, "WARN": 0, "INFO": 0})

        b_err, b_warn, b_info = b.get("ERROR", 0), b.get("WARN", 0), b.get("INFO", 0)
        c_err, c_warn, c_info = c.get("ERROR", 0), c.get("WARN", 0), c.get("INFO", 0)

        err_delta = c_err - b_err
        warn_delta = c_warn - b_warn
        info_delta = c_info - b_info

        if err_delta != 0 or warn_delta != 0 or info_delta != 0:
            err_sign = "+" if err_delta > 0 else ""
            warn_sign = "+" if warn_delta > 0 else ""
            info_sign = "+" if info_delta > 0 else ""
            print(f"  {check_id}:")
            if err_delta != 0:
                print(f"    ERROR: {b_err} -> {c_err} ({err_sign}{err_delta})")
            if warn_delta != 0:
                print(f"    WARN:  {b_warn} -> {c_warn} ({warn_sign}{warn_delta})")
            if info_delta != 0:
                print(f"    INFO:  {b_info} -> {c_info} ({info_sign}{info_delta})")

            if err_delta > 0:
                regressions.append(check_id)

    if not regressions and all_checks:
        # Check for any changes
        has_changes = any(
            baseline_checks.get(c, {}) != current_checks.get(c, {})
            for c in all_checks
        )
        if not has_changes:
            print("  No changes from baseline.")

    print(f"\nTotal: {baseline.get('total_errors', 0)} -> {current.get('total_errors', 0)} errors, "
          f"{baseline.get('total_warnings', 0)} -> {current.get('total_warnings', 0)} warnings")

    if regressions:
        print(f"\n⚠️  REGRESSIONS DETECTED in: {regressions}")
        print(f"{'='*60}\n")
        return False

    print(f"{'='*60}\n")
    return True


def print_qc_summary(summary: dict) -> None:
    """Print QC summary to console."""
    print(f"\n{'='*60}")
    print("QC SUMMARY")
    print(f"{'='*60}")
    print(f"Total records: {summary['total_records']}")
    print(f"Total errors:  {summary['total_errors']}")
    print(f"Total warnings: {summary['total_warnings']}")
    print(f"Total info:     {summary.get('total_info', 0)}")

    print("\nField coverage:")
    for field, stats in summary.get("field_coverage", {}).items():
        print(f"  {field:15s}: {stats['present']:4d}/{stats['total']:4d} ({stats['percent']:5.1f}%)")

    print("\nIssues by check:")
    for check_id, counts in sorted(summary.get("counts_by_check", {}).items()):
        err = counts.get("ERROR", 0)
        warn = counts.get("WARN", 0)
        info = counts.get("INFO", 0)
        if err > 0:
            print(f"  {check_id}: {err} ERROR, {warn} WARN")
        elif warn > 0:
            print(f"  {check_id}: {warn} WARN")
        elif info > 0:
            print(f"  {check_id}: {info} INFO")

    print(f"{'='*60}\n")


def _division_distribution(records: list[dict]) -> tuple[Counter, Counter]:
    """
    Returns:
      (division_canon_counts, division_raw_counts)
    """
    canon = Counter()
    raw = Counter()
    for rec in records:
        try:
            placements = json.loads(rec.get("placements_json", "[]") or "[]")
        except Exception:
            continue
        for p in placements:
            dcanon = (p.get("division_canon") or "").strip()
            draw = (p.get("division_raw") or "").strip()
            if dcanon:
                canon[dcanon] += 1
            if draw:
                raw[draw] += 1
    return canon, raw


def print_verification_stats(records: list[dict]) -> None:
    """Print verification gate statistics."""
    total = len(records)
    print(f"\n{'='*60}")
    print("VERIFICATION GATE: Stage 2 (Canonicalization)")
    print(f"{'='*60}")
    print(f"Total events processed: {total}")

    if total == 0:
        return

    # Count placements
    total_placements = 0
    division_counts = {}
    confidence_counts = {"high": 0, "medium": 0, "low": 0}

    for rec in records:
        placements = json.loads(rec.get("placements_json", "[]"))
        total_placements += len(placements)

        for p in placements:
            div = p.get("division_canon", "Unknown")
            division_counts[div] = division_counts.get(div, 0) + 1
            conf = p.get("parse_confidence", "unknown")
            if conf in confidence_counts:
                confidence_counts[conf] += 1

    print(f"Total placements parsed: {total_placements}")
    print(f"Average placements per event: {total_placements / total:.1f}")

    # Division frequency (top 10)
    print("\nTop 10 divisions by frequency:")
    sorted_divs = sorted(division_counts.items(), key=lambda x: -x[1])[:10]
    for div, count in sorted_divs:
        print(f"  {div:30s}: {count:5d}")

    # Confidence distribution
    print("\nParse confidence distribution:")
    for conf, count in sorted(confidence_counts.items()):
        pct = (count / total_placements * 100) if total_placements > 0 else 0
        print(f"  {conf:10s}: {count:5d} ({pct:5.1f}%)")

    # Low confidence detail
    low_conf_events = []
    for rec in records:
        placements = json.loads(rec.get("placements_json", "[]"))
        low_count = sum(1 for p in placements if p.get("parse_confidence") == "low")
        if low_count > 0:
            low_conf_events.append((rec.get("event_id"), low_count))

    if low_conf_events:
        print(f"\nEvents with low-confidence parses: {len(low_conf_events)}")
        print("Sample low-confidence events (first 5):")
        for eid, count in low_conf_events[:5]:
            print(f"  event_id={eid}: {count} low-confidence placements")

    # Sample output
    print("\nSample events (first 3):")
    for i, rec in enumerate(records[:3]):
        placements = json.loads(rec.get("placements_json", "[]"))
        print(f"  [{i+1}] event_id={rec.get('event_id')}, "
              f"year={rec.get('year')}, "
              f"placements={len(placements)}")

    # ---- Division distribution report (convergence metric)
    div_canon_counts, _ = _division_distribution(records)

    print("\nDivision distribution:")
    print(f"  Unique division_canon: {len(div_canon_counts)}")

    rare = [d for d, n in div_canon_counts.items() if n < 3]
    rare_sorted = sorted(rare, key=lambda d: div_canon_counts[d])
    print(f"  Rare divisions (count < 3): {len(rare_sorted)}")

    # show a small sample of the rarest
    for d in rare_sorted[:20]:
        print(f"    {div_canon_counts[d]:2d}  {d}")

    print(f"{'='*60}\n")


def main():
    """
    Read stage1 CSV, canonicalize, run QC, and output stage2 CSV.
    """
    import argparse
    parser = argparse.ArgumentParser(description="Stage 2: Canonicalize raw event data")
    parser.add_argument("--save-baseline", action="store_true",
                        help="Save current QC results as the new baseline")
    args = parser.parse_args()

    out_dir = REPO_ROOT / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    data_dir = REPO_ROOT / "data"
    overrides_path = REPO_ROOT / "overrides" / "events_overrides.jsonl"
    in_csv = out_dir / "stage1_raw_events.csv"
    out_csv = out_dir / "stage2_canonical_events.csv"

    if not in_csv.exists():
        print(f"ERROR: Input file not found: {in_csv}")
        print("Run 01_parse_mirror.py first.")
        return

    print(f"Reading: {in_csv}")
    records = read_stage1_csv(in_csv)

    location_canon = load_location_canon()
    if location_canon:
        print(f"Location canon: {LOCATION_CANON_PATH} ({len(location_canon)} events)")

    print(f"Canonicalizing {len(records)} events...")
    canonical, players = canonicalize_records(records, location_canon=location_canon)

    # Apply overrides (behavior change only if overrides file exists)
    overrides = load_event_overrides_jsonl(overrides_path)
    canonical, overrides_applied, overrides_excluded = apply_event_overrides(canonical, overrides)
    if overrides:
        print(f"Overrides loaded: {overrides_path} ({len(overrides)} event_ids)")
        print(f"Overrides applied: {overrides_applied}, excluded: {overrides_excluded}")

    # Deduplicate events with same (year, event_name, location)
    canonical, removed_duplicates = deduplicate_events(canonical)
    if removed_duplicates:
        print(f"Removed {len(removed_duplicates)} duplicate events:")
        for dup in removed_duplicates:
            print(f"  - {dup['event_id']}: {dup['event_name'][:50]} ({dup['year']})")

    # Remove junk events with no useful data
    junk_removed = [r for r in canonical if r["event_id"] in JUNK_EVENTS_TO_EXCLUDE]
    canonical = [r for r in canonical if r["event_id"] not in JUNK_EVENTS_TO_EXCLUDE]
    if junk_removed:
        print(f"Removed {len(junk_removed)} junk events (no useful data):")
        for junk in junk_removed:
            print(f"  - {junk['event_id']}: {junk['event_name'][:50]}")

    print(f"Writing to: {out_csv}")
    write_stage2_csv(canonical, out_csv)

    print_verification_stats(canonical)
    print(f"Wrote: {out_csv}")

    # Write players registry
    players_path = out_dir / "stage2_players.csv"
    with open(players_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["player_id", "player_name", "country_observed"])
        w.writeheader()
        for pid, rec in sorted(players.items(), key=lambda kv: kv[1]["player_name"].casefold()):
            countries = rec["countries"]
            country_observed = ""
            if countries:
                # choose most common observed code
                country_observed = countries.most_common(1)[0][0]
            w.writerow({
                "player_id": pid,
                "player_name": rec["player_name"],
                "country_observed": country_observed,
            })

    print(f"Wrote: {players_path}")

    # Run QC checks
    print("\nRunning QC checks...")

    if USE_MASTER_QC:
        # Use consolidated master QC orchestrator
        qc_summary, qc_issues = run_qc_for_stage("stage2", canonical, out_dir=out_dir)
        print_qc_summary_master(qc_summary, "stage2")

        # Delta reporting against baseline
        baseline = load_baseline_master(data_dir, "stage2")
        if baseline:
            no_regressions = print_qc_delta_master(qc_summary, baseline, "stage2")
            if not no_regressions:
                print("WARNING: QC regressions detected!")
        else:
            print("No baseline found. Run with --save-baseline to create one.")

        # Save baseline if requested
        if args.save_baseline:
            save_baseline_master(qc_summary, data_dir, "stage2")
    else:
        # Fallback to embedded QC (old behavior)
        qc_summary, qc_issues = run_qc(canonical)
        write_qc_outputs(qc_summary, qc_issues, out_dir)
        print_qc_summary(qc_summary)

        baseline = load_baseline(data_dir)
        if baseline:
            no_regressions = print_qc_delta(qc_summary, baseline)
            if not no_regressions:
                print("WARNING: QC regressions detected!")
        else:
            print("No baseline found. Run with --save-baseline to create one.")

        if args.save_baseline:
            save_baseline(qc_summary, data_dir)


if __name__ == "__main__":
    main()
