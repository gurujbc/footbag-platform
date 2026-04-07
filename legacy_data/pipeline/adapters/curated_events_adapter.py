#!/usr/bin/env python3
"""
pipeline/adapters/curated_events_adapter.py

Convert placement-level curated CSV/TXT files into stage1-shaped event rows.

Reads:  inputs/curated/events/structured/*.{csv,txt}
Writes: out/stage1_raw_events_curated.csv

Supported input variants:

  Variant A — player_name schema:
    event_name, year, location, division, place, player_name, score, notes
    Doubles: two rows per (division, place) slot — combined as "P1 / P2"

  Variant B — player_1/player_2 schema:
    event_name, year, location, [category,] division, place, player_1, player_2, score, notes
    Doubles: player_2 populated when team

  Variant C — OLD_RESULTS free-text format:
    Same format as OLD_RESULTS.txt / 01b_import_old_results.py.
    Year headers like "1983 NHSA:" or "1985:" delimit event blocks.
    Division headers + ordinal placements ("1st - Name, 2nd - Name, ...").
    Org name used as location token to disambiguate same-year events.
    e.g. "1983 NHSA:" → event_id "1983_worlds_nhsa"
         "1983 WFA:"  → event_id "1983_worlds_wfa"
         "1985:"      → event_id "1985_worlds"

Event IDs use canonical slug format: YYYY_series[_city_or_org]
  e.g. 1986_worlds_golden, 1996_worlds_montreal
Suffix _2, _3 appended only if a collision occurs within the curated set.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

REPO_ROOT   = Path(__file__).resolve().parents[2]
CURATED_DIR = REPO_ROOT / "inputs" / "curated" / "events" / "structured"
OUT_DIR     = REPO_ROOT / "out"

STAGE1_FIELDNAMES = [
    "event_id",
    "year",
    "source_path",
    "source_url",
    "source_file",
    "source_layer",
    "event_name_raw",
    "date_raw",
    "location_raw",
    "host_club_raw",
    "event_type_raw",
    "results_block_raw",
    "results_lines_n",
    "has_results",
    "html_parse_notes",
    "html_warnings",
]

_VARIANT_A_REQUIRED = {"event_name", "year", "division", "place", "player_name"}
_VARIANT_B_REQUIRED = {"event_name", "year", "division", "place", "player_1"}

# Stage1 source files whose IDs must not be duplicated
_EXISTING_STAGE1_FILES = [
    "stage1_raw_events_mirror.csv",
    "stage1_raw_events_old.csv",
    "stage1_raw_events_fbw.csv",
    "stage1_raw_events_magazine.csv",
]

RE_PLACE_LINE = re.compile(r"^\s*\d+\.\s+\S", re.MULTILINE)


# ─────────────────────────────────────────────────────────────────────────────
# Slug / event_id helpers
# ─────────────────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Lowercase, ASCII-safe slug. Mirrors stage05 implementation exactly."""
    s = text.lower().strip()
    s = re.sub(r"['\u2019\u2018\u201c\u201d]", "", s)   # strip apostrophes/quotes
    s = re.sub(r"[^a-z0-9]+", "_", s)                    # non-alphanum → _
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:80]


_WORLDS_RE = re.compile(r"\bworld(s)?\b", re.IGNORECASE)


def _series_slug(event_name: str) -> str:
    """Short series token derived from event_name."""
    if _WORLDS_RE.search(event_name):
        return "worlds"
    # Fallback: first 3 meaningful words of slugified name
    words = [w for w in slugify(event_name).split("_") if len(w) > 2]
    return "_".join(words[:3]) or slugify(event_name)[:30]


def _city_slug(location: str) -> str:
    """First comma-separated token of location, slugified. Empty if blank."""
    if not location or not location.strip():
        return ""
    city = location.split(",")[0].strip()
    # Strip trailing 2-letter state abbreviation: "Golden CO" → "Golden"
    city = re.sub(r"\s+[A-Z]{2}$", "", city).strip()
    return slugify(city)


def make_event_id(year: str, event_name: str, location: str, used: set[str]) -> str:
    """
    Derive canonical event_id: YYYY_series[_city].
    Appends _2, _3, ... if the base candidate is already taken.
    Adds the chosen ID to `used` before returning.
    """
    parts = [year.strip(), _series_slug(event_name)]
    city = _city_slug(location)
    if city:
        parts.append(city)
    base = "_".join(p for p in parts if p)

    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


# ─────────────────────────────────────────────────────────────────────────────
# Event type inference
# ─────────────────────────────────────────────────────────────────────────────

def infer_event_type(results_block: str) -> str:
    t = (results_block or "").upper()
    has_net    = bool(re.search(r"\bNET\b", t))
    has_fs     = bool(re.search(r"\b(FREESTYLE|ROUTINES|SHRED|CIRCLE|SICK|BATTLE|COMBO)\b", t))
    has_golf   = bool(re.search(r"\bGOLF\b", t))
    has_consec = bool(re.search(r"\b(CONSECUTIVE|KICKS)\b", t))
    if has_net and has_fs:
        return "mixed"
    if has_net:
        return "net"
    if has_fs:
        return "freestyle"
    if has_golf:
        return "golf"
    if has_consec:
        return "consecutive"
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# results_block_raw construction
# ─────────────────────────────────────────────────────────────────────────────

def _safe_place_int(s: str) -> int:
    try:
        return int(s)
    except (ValueError, TypeError):
        return 9999


def _build_block_variant_a(rows: list[dict]) -> tuple[str, list[str]]:
    """
    Variant A: player_name schema.
    Two rows per (division, place) for doubles → combined as "P1 / P2".
    Preserves division order of first appearance; sorts placements numerically.
    """
    warnings: list[str] = []
    out_lines: list[str] = []

    # Preserve division order of first appearance
    div_order: list[str] = []
    by_div: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        div = r.get("division", "").strip()
        if not div:
            continue
        if div not in by_div:
            div_order.append(div)
        by_div[div].append(r)

    for div in div_order:
        div_rows = by_div[div]

        # Group players by place
        by_place: dict[str, list[str]] = defaultdict(list)
        for r in div_rows:
            place = r.get("place", "").strip()
            name  = r.get("player_name", "").strip()
            if place and name:
                by_place[place].append(name)

        if not by_place:
            continue

        out_lines.append(div)
        for place in sorted(by_place.keys(), key=_safe_place_int):
            players = by_place[place]
            if len(players) == 1:
                entry = players[0]
            elif len(players) == 2:
                entry = f"{players[0]} / {players[1]}"
            else:
                entry = " / ".join(players)
                warnings.append(
                    f"unexpected_player_count:{div!r}:p{place}:{len(players)} players"
                )
            out_lines.append(f"{place}. {entry}")
        out_lines.append("")

    while out_lines and out_lines[-1] == "":
        out_lines.pop()

    return "\n".join(out_lines).strip(), warnings


def _build_block_variant_b(rows: list[dict]) -> tuple[str, list[str]]:
    """
    Variant B: player_1/player_2 schema.
    player_2 populated → doubles team "P1 / P2".
    """
    warnings: list[str] = []
    out_lines: list[str] = []

    div_order: list[str] = []
    by_div: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        div = r.get("division", "").strip()
        if not div:
            continue
        if div not in by_div:
            div_order.append(div)
        by_div[div].append(r)

    for div in div_order:
        div_rows = sorted(by_div[div], key=lambda r: _safe_place_int(r.get("place", "")))
        out_lines.append(div)
        for r in div_rows:
            p1    = r.get("player_1", "").strip()
            p2    = r.get("player_2", "").strip()
            place = r.get("place", "").strip()
            if not p1:
                warnings.append(f"empty_player_1:{div!r}:p{place}")
                continue
            entry = f"{p1} / {p2}" if p2 else p1
            out_lines.append(f"{place}. {entry}")
        out_lines.append("")

    while out_lines and out_lines[-1] == "":
        out_lines.pop()

    return "\n".join(out_lines).strip(), warnings


def count_placement_lines(block: str) -> int:
    return len(RE_PLACE_LINE.findall(block))


# ─────────────────────────────────────────────────────────────────────────────
# Variant C — OLD_RESULTS free-text parser
# (ported from pipeline/01b_import_old_results.py; no runtime import needed)
# ─────────────────────────────────────────────────────────────────────────────

_C0_ILLEGAL = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")
_REPLACEMENT_CHAR = "\ufffd"

# Event header: "1983 NHSA:" / "1984:" / "1985 WFA: "
_OT_RE_EVENT_HEADER = re.compile(r"^\s*(19\d{2}|20\d{2})\s*([^:]{0,40})\s*:\s*$")
# Division header (colon) and (trailing dash)
_OT_RE_DIV_COLON = re.compile(r"^\s*([A-Za-z0-9][^:]{0,120})\s*:\s*$")
_OT_RE_DIV_DASH  = re.compile(r"^\s*([A-Za-z0-9].{0,160}?)\s*-\s*$")
# Ordinal placement on its own line: "1st - Name"
_OT_RE_ORD_LINE  = re.compile(r"^\s*(\d+)(?:st|nd|rd|th)\s*-\s*(.+?)\s*$", re.IGNORECASE)
# Inline placements: "Division - 1st - P1, 2nd - P2, 3rd - P3"
# p1/p2 terminators: comma, 2+ spaces, or a single space immediately before
# the next ordinal indicator ("2nd -", "3rd -", etc.).  The lookahead stops
# the lazy match WITHOUT consuming the space, so the ordinal group can still
# match.  This handles "P1 2nd - P2" (single-space separation) correctly.
_OT_RE_ORD_AHEAD = r"\s+(?=\d+(?:st|nd|rd|th)\s*-)"
_OT_RE_INLINE    = re.compile(
    r"(?P<div>.+?)\s*[-:]\s*1st\s*-\s*(?P<p1>.+?)(?:,|\s{2,}|" + _OT_RE_ORD_AHEAD + r"|$)\s*"
    r"(?:2nd\s*-\s*(?P<p2>.+?)(?:,|\s{2,}|" + _OT_RE_ORD_AHEAD + r"|$)\s*)?"
    r"(?:3rd\s*-\s*(?P<p3>.+?)\s*)?$",
    re.IGNORECASE,
)
# "Div Champion(s) - Name"
_OT_RE_CHAMPION  = re.compile(r"^\s*(.+?)\s+Champions?\s*-\s*(.+?)\s*$", re.IGNORECASE)
# "Div - 1st - Name" (single)
_OT_RE_SINGLE    = re.compile(r"^\s*(.+?)\s*-\s*1st\s*-\s*(.+?)\s*$", re.IGNORECASE)
# Continuation: indented wrap line
_OT_RE_CONT      = re.compile(r"^\s{3,}(.+?)\s*$")
_OT_RE_ADMIN     = re.compile(r"^\s*world\s+record\b", re.IGNORECASE)
_OT_RE_TRAIL_WR  = re.compile(r"\s*-\s*world\s+record\b.*$", re.IGNORECASE)


def _ot_repair_encoding(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"(\w)\ufffd" + r"s\b", r"\1's", s)
    s = re.sub(r"\ufffd(\w+)\ufffd", r'"\1"', s)
    s = s.replace(_REPLACEMENT_CHAR, "")
    return s


def _ot_clean(s: str) -> str:
    if s is None:
        return ""
    s = _ot_repair_encoding(s)
    s = s.replace("\u00A0", " ")
    s = _C0_ILLEGAL.sub("", s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def _ot_norm_div(s: str) -> str:
    s = _ot_clean(s).rstrip(":").strip().upper()
    return s


def _ot_norm_entry(s: str) -> str:
    s = _ot_clean(s)
    s = re.sub(r"\s*/\s*", " / ", s)
    s = s.strip(" ,")
    s = _OT_RE_TRAIL_WR.sub("", s).strip(" ,;-")
    return s


def _ot_extract_inline(line: str) -> Optional[Tuple[str, List[Tuple[int, str]]]]:
    """Return (div, [(ordinal, entry), ...]) preserving p1/p2/p3 positions.
    Ordinals are 1/2/3 so downstream can write '3. X' when p2 is absent."""
    m = _OT_RE_INLINE.match(line)
    if not m:
        return None
    div = _ot_norm_div(m.group("div"))
    places: List[Tuple[int, str]] = []
    for i, k in enumerate(("p1", "p2", "p3"), start=1):
        ent = _ot_norm_entry(m.group(k) or "")
        if ent:
            places.append((i, ent))
    if not div or not places:
        return None
    return div, places


@dataclass
class _OTBlock:
    year: int
    org: str
    raw_lines: List[str] = field(default_factory=list)


def _ot_iter_blocks(lines: List[str]) -> List[_OTBlock]:
    """Split file into event blocks. Stores RAW lines (preserving indentation)
    so that continuation stitching in _ot_build_block() can detect wrapped lines."""
    blocks: List[_OTBlock] = []
    cur: Optional[_OTBlock] = None
    for raw in lines:
        cleaned = _ot_clean(raw)
        if cleaned.strip("/") == "" and "/" in cleaned:
            continue
        m = _OT_RE_EVENT_HEADER.match(cleaned)
        if m:
            if cur is not None:
                blocks.append(cur)
            cur = _OTBlock(year=int(m.group(1)), org=_ot_clean(m.group(2)))
            continue
        if cur is None:
            continue
        # Store the original raw line (with indentation) so _ot_build_block()
        # can stitch continuation wraps via _OT_RE_CONT (requires 3+ spaces).
        if cleaned:
            cur.raw_lines.append(raw.rstrip("\n\r"))
    if cur is not None:
        blocks.append(cur)
    return blocks


def _ot_build_block(event_lines: List[str]) -> Tuple[str, List[str]]:
    """Convert OLD_RESULTS event lines into results_block_raw format."""
    out_lines: List[str] = []
    warnings: List[str] = []
    current_div: Optional[str] = None
    last_div: Optional[str] = None
    buffered: List[str] = []
    # When an inline parse writes to out_lines directly, track how many
    # placements it wrote so continuation ordinal lines can be appended
    # correctly (using the source ordinal, not a re-numbered buffer index).
    _inline_wrote: int = 0

    def flush() -> None:
        nonlocal current_div, buffered, _inline_wrote
        if current_div and buffered:
            out_lines.append(current_div)
            for i, ent in enumerate(buffered, start=1):
                out_lines.append(f"{i}. {ent}")
            out_lines.append("")
        current_div = None
        buffered = []
        _inline_wrote = 0

    # Pre-pass: stitch continuation lines while indentation is still present.
    # Rule 1 (original): 3+ leading spaces → indented wrap.
    # Rule 2 (new): previous line ends with incomplete ordinal "Nth -?" →
    #   the name fragment is on the next line regardless of indent.
    #   e.g. "...3rd -\nGary Lautt" or "...3rd\n- Karen Gunther"
    # Rule 3 (new): current line starts with "- Word" (ordinal-less dash
    #   continuation) → e.g. "\n- Karen Gunther" after "... 3rd"
    # Rule 4 (new): current line is a bare name/doubles-pair continuation
    #   (starts with TitleCase followed immediately by "/") →
    #   e.g. "Hughes/Karen Uppinghouse" after "...2nd - Cheryl"
    _RE_PREV_INCOMPLETE_ORD = re.compile(
        r"\b\d+(?:st|nd|rd|th)\s*-?\s*$", re.IGNORECASE
    )
    _RE_CUR_DASH_CONT  = re.compile(r"^\s*-\s+[A-Za-z]")
    _RE_CUR_SLASH_NAME = re.compile(r"^[A-Z][a-z]+/")

    stitched_raw: List[str] = []
    for raw_line in event_lines:
        stripped_cur = raw_line.strip()
        prev = stitched_raw[-1] if stitched_raw else ""
        if not stripped_cur:
            stitched_raw.append(raw_line)
            continue
        should_stitch = (
            (_OT_RE_CONT.match(raw_line) and stitched_raw)                      # Rule 1
            or (stitched_raw and _RE_PREV_INCOMPLETE_ORD.search(prev))           # Rule 2
            or (stitched_raw and _RE_CUR_DASH_CONT.match(stripped_cur))          # Rule 3
            or (stitched_raw and _RE_CUR_SLASH_NAME.match(stripped_cur))         # Rule 4
        )
        if should_stitch:
            stitched_raw[-1] = stitched_raw[-1].rstrip() + " " + stripped_cur
        else:
            stitched_raw.append(raw_line)

    for raw_line in stitched_raw:
        line = _ot_clean(raw_line)
        if not line:
            continue
        # Strip "- World Record - N,NNN" annotations before pattern matching
        # so they don't prevent inline regex from separating p2/p3.
        line_for_parse = _OT_RE_TRAIL_WR.sub("", line).strip(" ,;-").strip()
        if not line_for_parse:
            continue
        inline = _ot_extract_inline(line_for_parse)
        if inline:
            flush()
            div, place_pairs = inline
            out_lines.append(div)
            last_ord = 0
            for ord_n, ent in place_pairs:
                if _OT_RE_ADMIN.match(ent):
                    warnings.append(f"dropped_admin:{ent[:80]}")
                else:
                    out_lines.append(f"{ord_n}. {ent}")
                    last_ord = ord_n
            out_lines.append("")
            # Track context so continuation ordinal lines (2nd/3rd/4th on a
            # following line) can be spliced in at the correct position.
            last_div = div
            _inline_wrote = last_ord
            continue

        m1 = _OT_RE_SINGLE.match(line_for_parse)
        if m1 and "2nd" not in line_for_parse.lower() and "3rd" not in line_for_parse.lower():
            div = _ot_norm_div(m1.group(1))
            ent = _ot_norm_entry(m1.group(2))
            if div and ent:
                if _OT_RE_ADMIN.match(ent):
                    warnings.append(f"dropped_admin:{ent[:80]}")
                else:
                    flush()
                    out_lines.append(div)
                    out_lines.append(f"1. {ent}")
                    out_lines.append("")
                    last_div = div
                    _inline_wrote = 1
            continue

        mch = _OT_RE_CHAMPION.match(line_for_parse)
        if mch:
            div = _ot_norm_div(mch.group(1))
            ent = _ot_norm_entry(mch.group(2))
            flush()
            if div and ent and not _OT_RE_ADMIN.match(ent):
                out_lines.append(div)
                out_lines.append(f"1. {ent}")
                out_lines.append("")
                last_div = div
                _inline_wrote = 1
            continue

        mhc = _OT_RE_DIV_COLON.match(line_for_parse)
        if mhc:
            flush()
            current_div = _ot_norm_div(mhc.group(1))
            last_div = current_div
            continue

        mhd = _OT_RE_DIV_DASH.match(line_for_parse)
        if mhd and "1st" not in line_for_parse.lower():
            flush()
            current_div = _ot_norm_div(mhd.group(1))
            last_div = current_div
            continue

        mo = _OT_RE_ORD_LINE.match(line_for_parse)
        if mo:
            ord_num = int(mo.group(1))
            ent = _ot_norm_entry(mo.group(2))
            if not ent or _OT_RE_ADMIN.match(ent):
                continue
            # If we just wrote an inline/single div and this ordinal is a
            # continuation (ordinal > what inline wrote), splice it in directly.
            if (current_div is None and _inline_wrote > 0
                    and last_div is not None and ord_num > _inline_wrote):
                # Remove trailing blank line before appending
                if out_lines and out_lines[-1] == "":
                    out_lines.pop()
                out_lines.append(f"{ord_num}. {ent}")
                out_lines.append("")
                _inline_wrote = ord_num
                continue
            # Normal case: buffer under current division
            if not current_div:
                current_div = last_div or "UNKNOWN DIVISION"
                last_div = current_div
                if current_div == "UNKNOWN DIVISION":
                    warnings.append(f"placement_without_division:{line[:80]}")
            buffered.append(ent)
            continue

    flush()
    while out_lines and out_lines[-1] == "":
        out_lines.pop()
    return "\n".join(out_lines).strip(), warnings


def _ot_make_event_name(year: int, org: str) -> str:
    org = _ot_clean(org)
    if org:
        return f"World Championships {year} ({org})"
    return f"World Championships {year}"


def load_freetext_file(
    path: Path,
    used_ids: set[str],
) -> Tuple[List[dict], List[str]]:
    """
    Parse a Variant-C OLD_RESULTS free-text file → list of stage1 rows.
    Returns (stage1_rows, warnings).
    """
    warnings: List[str] = []
    stage1_rows: List[dict] = []

    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()

    blocks = _ot_iter_blocks(lines)
    if not blocks:
        warnings.append(f"{path.name}: no event blocks found (no YYYY: headers)")
        return [], warnings

    for block in blocks:
        year_str = str(block.year)
        org = block.org

        # Use org as location token so same-year events get distinct IDs
        # e.g. "1983 NHSA:" → location="NHSA" → event_id "1983_worlds_nhsa"
        location_for_slug = org if org else ""

        event_name = _ot_make_event_name(block.year, org)
        results_block, block_warns = _ot_build_block(block.raw_lines)
        if block_warns:
            warnings.extend(f"{path.name}:{year_str}:{org}: {w}" for w in block_warns)

        event_id = make_event_id(year_str, event_name, location_for_slug, used_ids)
        n_lines  = count_placement_lines(results_block)
        etype    = infer_event_type(results_block)

        notes = "; ".join([
            "importer:curated_events_adapter",
            "variant:C_freetext",
            f"source:{path.name}",
            f"org:{org}" if org else "org:none",
            f"raw_lines:{len(block.raw_lines)}",
        ])

        stage1_rows.append({
            "event_id":          event_id,
            "year":              year_str,
            "source_path":       str(path.resolve()),
            "source_url":        "",
            "source_file":       path.name,
            "source_layer":      "curated",
            "event_name_raw":    event_name,
            "date_raw":          "",
            "location_raw":      location_for_slug,
            "host_club_raw":     "",
            "event_type_raw":    etype,
            "results_block_raw": results_block,
            "results_lines_n":   str(n_lines),
            "has_results":       "True" if n_lines > 0 else "False",
            "html_parse_notes":  notes,
            "html_warnings":     "; ".join(block_warns),
        })

    return stage1_rows, warnings


def detect_freetext_format(path: Path) -> bool:
    """Return True if the file looks like OLD_RESULTS free-text (has YYYY: event headers)."""
    try:
        sample = path.read_text(encoding="utf-8", errors="replace")
        for line in sample.splitlines()[:40]:
            if _OT_RE_EVENT_HEADER.match(_ot_clean(line)):
                return True
    except Exception:
        pass
    return False


# ─────────────────────────────────────────────────────────────────────────────
# File loading
# ─────────────────────────────────────────────────────────────────────────────

def detect_variant(headers: list[str]) -> Optional[str]:
    h = set(headers)
    if _VARIANT_B_REQUIRED.issubset(h):
        return "B"
    if _VARIANT_A_REQUIRED.issubset(h):
        return "A"
    return None


def load_curated_file(
    path: Path,
) -> tuple[Optional[str], list[dict], list[str]]:
    """
    Returns (variant, rows, warnings).
    variant=None means the file was skipped (not a recognized curated CSV).
    """
    file_warnings: list[str] = []
    try:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = list(reader.fieldnames or [])
            variant = detect_variant(headers)
            if variant is None:
                file_warnings.append(
                    f"skipped {path.name}: unrecognized header "
                    f"{headers[:6]!r} — expected player_name or player_1/player_2 columns"
                )
                return None, [], file_warnings
            rows = [r for r in reader if any(v.strip() for v in r.values())]
    except Exception as exc:
        file_warnings.append(f"skipped {path.name}: read error: {exc}")
        return None, [], file_warnings

    return variant, rows, file_warnings


# ─────────────────────────────────────────────────────────────────────────────
# Per-file processing
# ─────────────────────────────────────────────────────────────────────────────

def process_file(
    path: Path,
    variant: str,
    rows: list[dict],
    used_ids: set[str],
) -> tuple[list[dict], list[str]]:
    """
    Group placement rows by (event_name, year) and produce stage1 rows.
    Returns (stage1_rows, file_level_warnings).
    """
    file_warnings: list[str] = []
    stage1_rows: list[dict] = []

    # Group preserving file order
    group_order: list[tuple[str, str]] = []
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        key = (r.get("event_name", "").strip(), r.get("year", "").strip())
        if key not in groups:
            group_order.append(key)
        groups[key].append(r)

    for (event_name, year) in group_order:
        if not event_name or not year:
            file_warnings.append(
                f"skipped group with blank event_name or year: "
                f"event_name={event_name!r} year={year!r}"
            )
            continue

        group_rows = groups[(event_name, year)]
        rep        = group_rows[0]
        location   = rep.get("location", "").strip()

        event_id = make_event_id(year, event_name, location, used_ids)

        if variant == "A":
            results_block, block_warns = _build_block_variant_a(group_rows)
        else:
            results_block, block_warns = _build_block_variant_b(group_rows)

        if block_warns:
            file_warnings.extend(f"{event_id}: {w}" for w in block_warns)

        n_lines    = count_placement_lines(results_block)
        event_type = infer_event_type(results_block)

        notes = "; ".join([
            "importer:curated_events_adapter",
            f"source:{path.name}",
            f"variant:{variant}",
            f"input_rows:{len(group_rows)}",
        ])

        stage1_rows.append({
            "event_id":          event_id,
            "year":              year,
            "source_path":       str(path.resolve()),
            "source_url":        "",
            "source_file":       path.name,
            "source_layer":      "curated",
            "event_name_raw":    event_name,
            "date_raw":          "",
            "location_raw":      location,
            "host_club_raw":     "",
            "event_type_raw":    event_type,
            "results_block_raw": results_block,
            "results_lines_n":   str(n_lines),
            "has_results":       "True" if n_lines > 0 else "False",
            "html_parse_notes":  notes,
            "html_warnings":     "; ".join(block_warns),
        })

    return stage1_rows, file_warnings


# ─────────────────────────────────────────────────────────────────────────────
# Existing ID collection
# ─────────────────────────────────────────────────────────────────────────────

def load_existing_ids(out_dir: Path) -> set[str]:
    """Return all event_ids already in the known stage1 source files."""
    existing: set[str] = set()
    for name in _EXISTING_STAGE1_FILES:
        p = out_dir / name
        if not p.exists():
            continue
        try:
            with open(p, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    eid = row.get("event_id", "").strip()
                    if eid:
                        existing.add(eid)
        except Exception:
            pass
    return existing


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Convert curated placement-level files into stage1-shaped event rows."
    )
    ap.add_argument(
        "--curated-dir", type=Path, default=CURATED_DIR,
        help="Directory of curated structured files (default: inputs/curated/events/structured/)",
    )
    ap.add_argument(
        "--out", type=Path, default=OUT_DIR / "stage1_raw_events_curated.csv",
        help="Output CSV path (default: out/stage1_raw_events_curated.csv)",
    )
    args = ap.parse_args()

    curated_dir: Path = args.curated_dir
    out_path:    Path = args.out

    if not curated_dir.exists():
        print(f"ERROR: curated dir not found: {curated_dir}", file=sys.stderr)
        return 1

    candidates = sorted(
        p for p in curated_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".csv", ".txt"}
    )
    if not candidates:
        print(f"WARNING: no .csv/.txt files found in {curated_dir}")
        return 0

    # Seed used_ids with all existing stage1 IDs so make_event_id avoids them
    existing_ids = load_existing_ids(out_path.parent)
    used_ids: set[str] = set(existing_ids)

    all_stage1_rows: list[dict] = []
    all_warnings:    list[str]  = []

    for path in candidates:
        # Variant C: free-text OLD_RESULTS format (.txt with YYYY: headers)
        if path.suffix.lower() == ".txt" and detect_freetext_format(path):
            stage1_rows, file_warns = load_freetext_file(path, used_ids)
            all_warnings.extend(file_warns)
            if not stage1_rows:
                print(f"  SKIP  {path.name}: Variant C — no events parsed")
                for w in file_warns:
                    print(f"        {w}")
                continue
            all_stage1_rows.extend(stage1_rows)
            all_warnings.extend(file_warns)
            events_str = ", ".join(r["event_id"] for r in stage1_rows)
            total_placements = sum(int(r["results_lines_n"]) for r in stage1_rows)
            print(
                f"  OK    {path.name}: variant=C_freetext, "
                f"{len(stage1_rows)} event(s), {total_placements} placements: {events_str}"
            )
            continue

        # Variants A / B: CSV placement-level files
        variant, rows, load_warns = load_curated_file(path)
        all_warnings.extend(load_warns)
        if variant is None:
            print(f"  SKIP  {path.name}")
            for w in load_warns:
                print(f"        {w}")
            continue
        if not rows:
            print(f"  SKIP  {path.name}: 0 usable rows")
            continue

        stage1_rows, file_warns = process_file(path, variant, rows, used_ids)
        all_stage1_rows.extend(stage1_rows)
        all_warnings.extend(file_warns)

        events_str = ", ".join(r["event_id"] for r in stage1_rows)
        print(
            f"  OK    {path.name}: variant={variant}, "
            f"{len(rows)} rows → {len(stage1_rows)} event(s): {events_str}"
        )

    if not all_stage1_rows:
        print("ERROR: no stage1 rows produced.", file=sys.stderr)
        return 1

    # Final assertion: no curated ID should match a pre-existing non-curated ID.
    # (make_event_id already prevents this via used_ids seeding, but assert to be safe.)
    curated_ids     = {r["event_id"] for r in all_stage1_rows}
    cross_collision = curated_ids & existing_ids
    if cross_collision:
        print(
            f"FATAL: {len(cross_collision)} curated event_id(s) collide with "
            f"existing stage1 sources:",
            file=sys.stderr,
        )
        for c in sorted(cross_collision):
            print(f"  {c}", file=sys.stderr)
        return 1

    # Validate output header matches STAGE1_FIELDNAMES
    for row in all_stage1_rows:
        missing = [f for f in STAGE1_FIELDNAMES if f not in row]
        if missing:
            print(f"FATAL: output row missing fields: {missing}", file=sys.stderr)
            return 1

    # Write
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=STAGE1_FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_stage1_rows)

    print(f"\nWrote {len(all_stage1_rows)} event(s) → {out_path}")

    if all_warnings:
        print(f"\nWarnings ({len(all_warnings)}):")
        for w in all_warnings[:30]:
            print(f"  {w}")
        if len(all_warnings) > 30:
            print(f"  ... and {len(all_warnings) - 30} more")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
