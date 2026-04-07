#!/usr/bin/env python3
"""
pipeline/adapters/mirror_results_adapter.py — Stage 1: Extract raw facts from HTML mirror

This script:
- Reads local offline mirror under ./mirror
- Extracts raw event data from HTML (no semantic cleaning)
- Outputs: out/stage1_raw_events_mirror.csv

Input: ./mirror/www.footbag.org/events/show/*/index.html
Output: out/stage1_raw_events_mirror.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd
from bs4 import BeautifulSoup


def norm_text(x) -> str:
    """Coerce None/NaN/non-string to a safe string for QC + CSV writing."""
    if x is None:
        return ""
    if isinstance(x, float) and math.isnan(x):
        return ""
    if isinstance(x, (int, float, bool)):
        return str(x)
    return str(x)


def _read_text_best_effort(p: Path) -> str:
    # HTML in the wild can be messy. Decode best-effort:
    # Try strict UTF-8 first (valid for most modern pages).
    # Fall back to latin-1 (ISO-8859-1) for older pages with accented chars
    # (ä, ü, ö, etc.) that are not valid UTF-8.
    # Final fallback: UTF-8 with replacement chars (never crash).
    try:
        return p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, Exception):
        pass
    try:
        return p.read_text(encoding="latin-1")
    except Exception:
        return p.read_text(encoding="utf-8", errors="replace")


def resolve_event_html(root: Path, mirror_name: str, repairs_name: str, event_id: str, use_repairs: bool = True) -> tuple[Path | None, str | None]:
    """
    Returns (path, html_text) using precedence:
      repairs/index.html -> mirror/index.html -> mirror/<id>.html
    """
    rel = Path("www.footbag.org") / "events" / "show" / str(event_id)

    if use_repairs:
        p = root / repairs_name / rel / "index.html"
        if p.exists():
            return p, _read_text_best_effort(p)

    base = root / mirror_name / rel
    p = base / "index.html"
    if p.exists():
        return p, _read_text_best_effort(p)

    # Some mirrors store as <id>.html
    p2 = base / f"{event_id}.html"
    if p2.exists():
        return p2, _read_text_best_effort(p2)

    return None, None


# Place line detection for has_results (lines starting with a number)
PLACE_LINE_RE = re.compile(r"^\s*\d+\s+", re.M)


def compute_has_results(results_block_raw: str, min_lines: int) -> bool:
    if not results_block_raw:
        return False

    # If placement-like lines exist, always count as results
    if PLACE_LINE_RE.search(results_block_raw):
        return True

    # Otherwise require minimum line count
    lines = [ln.strip() for ln in results_block_raw.splitlines() if ln.strip()]
    return len(lines) >= min_lines


# CSV safety: remove control chars that could cause issues
_ILLEGAL_CSV_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")

# Detect placement-like lines in a text block.
# Matches numbered formats: "1. Name", "1) Name", "1- Name", "1: Name"
# Also English ordinals: "1st -", "2nd -", "3rd -"
# Also Spanish/Portuguese ordinals: "1° LUGAR", "2°", "1º"
_PLACEMENT_LINE_RE = re.compile(
    r'^\s*[1-9]\d?\s*'        # leading number (1-99)
    r'(?:'
    r'[.)\-:]\s*\S'            # numbered: 1. Name, 1) Name, 1- Name, 1: Name
    r'|'
    r'(?:st|nd|rd|th)\b'       # English ordinal: 1st, 2nd, 3rd, 4th
    r'|'
    r'[°º]'                    # degree/ordinal sign: 1°, 1º
    r')',
    re.MULTILINE
)

# Year overrides for events where year cannot be extracted from HTML
# These event IDs are missing structured date/year info in the mirror HTML
# Years were found by checking which results_year_YYYY directory lists each event
YEAR_OVERRIDES = {
    860082052: 1997,      # Texas State Footbag Championships
    941066992: 2000,      # WESTERN REGIONAL FOOTBAG CHAMPIONSHIPS
    959094047: 2000,      # Battle of the Year Switzerland
    1023993464: 2002,     # Funtastik Summer Classic Footbag Tournament
    1030642331: 2002,     # Seattle Juggling and Footbag Festival
    1278991986: 2010,     # 23rd Annual Vancouver Open Footbag Championships
}

# Date overrides for events where date cannot be extracted from HTML
# These event IDs have broken HTML with missing structured date fields
# Dates were manually looked up from footbag.org
DATE_OVERRIDES = {
    1099545007: "January 21 - 23",               # Seapa NZ Footbag Nationals 2005
    1151949245: "July 21 - 23",                  # ShrEdmonton 2006
    1299244521: "April 30 - May 1",              # Warsaw Footbag Open 2011
    1023993464: "August 31 - September 2",       # Funtastik Summer Classic 2002
    1030642331: "November 15 - 17",              # Seattle Juggling and Footbag Festival 2002
    1278991986: "August 14 - 15",                # 23rd Annual Vancouver Open 2010
    860082052: "October 11 - 12",                # Texas State Footbag Championships 1997
    941066992: "May 29",                         # WESTERN REGIONAL FOOTBAG CHAMPIONSHIPS 2000
    959094047: "May 27",                         # Battle of the Year Switzerland 2000
}


# --- Recovery override: results blocks recovered from mirror pages ---
def _load_recovered_results_overrides(path: str | Path = "overrides/recovered_results.jsonl") -> dict[str, str]:
    p = Path(path) if isinstance(path, str) else path
    if not p.exists():
        print(f"[Stage1] recovered_results overrides: file not found: {p}")
        return {}
    overrides: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        eid = str(obj.get("event_id", "")).strip()
        txt = obj.get("results_block_raw_override", "")
        if eid and txt:
            overrides[eid] = txt
    print(f"[Stage1] recovered_results overrides loaded: {len(overrides)} from {p}")
    return overrides


def sanitize_csv_string(s: str) -> str:
    """Remove control characters for CSV safety."""
    if not isinstance(s, str):
        return s
    return _ILLEGAL_CSV_RE.sub("", s)


def fix_encoding_corruption(s: str) -> str:
    """
    Fix systematic encoding corruption in the HTML mirror.

    The mirror has three types of corruption:

    1. Visible character corruption (UTF-8 misinterpretation):
       - © (copyright symbol) should be Š (Czech S with caron)
       - £ (pound sign) should be Ł (Polish L with stroke)

    2. C1 control characters (CP1252 misinterpretation):
       - U+0092 (chr 146) should be ' (apostrophe) - appears in "Women's"
       - U+0093 (chr 147) should be " (left double quote)
       - U+0094 (chr 148) should be " (right double quote)
       - U+009A (chr 154) should be š (small s with caron)

    3. Unicode replacement character (�) from pre-existing corruption in HTML:
       - � before 's (possessive) should be ' (apostrophe)
       - Pattern: "Women�s" → "Women's", "Men�s" → "Men's"

    Note: ? characters represent unknown/unrecoverable characters from the original mirror
    and cannot be fixed without manual context.
    """
    if not isinstance(s, str):
        return s

    # Map of corrupted character -> correct character
    fixes = {
        # Visible character corruption
        '©': 'Š',  # Czech S with caron (U+0160)
        '£': 'Ł',  # Polish L with stroke (U+0141)

        # C1 control characters (CP1252 corruption)
        '\x92': "'",  # U+0092 → apostrophe (most common: "Women's")
        '\x93': '"',  # U+0093 → left double quote
        '\x94': '"',  # U+0094 → right double quote
        '\x9a': 'š',  # U+009A → s with caron
    }

    result = s
    for wrong, right in fixes.items():
        result = result.replace(wrong, right)

    # Fix Unicode replacement character (�) in possessive context
    # Pattern: word�s → word's (e.g., "Women�s" → "Women's")
    import re
    result = re.sub(r'(\w)\ufffd' + r's\b', r"\1's", result)

    # Fix replacement character used as nickname quotes
    # Pattern: Name �Nickname� Surname → Name "Nickname" Surname
    result = re.sub(r'\ufffd(\w+)\ufffd', r'"\1"', result)

    return result


# ------------------------------------------------------------
# Mirror discovery
# ------------------------------------------------------------
def find_events_show_dir(mirror_dir: Path) -> Path:
    """Find the events/show directory in the mirror."""
    mirror_dir = mirror_dir.resolve()
    candidates = [
        mirror_dir / "www.footbag.org" / "events" / "show",
        mirror_dir / "events" / "show",
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(f"No events/show directory found under {mirror_dir}")


def iter_event_html_files(events_show: Path) -> Iterable[Path]:
    """Iterate over event HTML files in the mirror."""
    for subdir in sorted(events_show.iterdir()):
        if not subdir.is_dir():
            continue
        if not subdir.name.isdigit():
            continue

        html_file = subdir / "index.html"
        if not html_file.exists():
            html_file = subdir / f"{subdir.name}.html"

        if html_file.exists():
            yield html_file.resolve()


# ------------------------------------------------------------
# HTML extraction helpers
# ------------------------------------------------------------
def _text_or_none(node) -> Optional[str]:
    """Extract text from a BeautifulSoup node."""
    if not node:
        return None
    txt = node.get_text(" ", strip=True)
    return txt.strip() if txt else None


def extract_by_bold_label(soup: BeautifulSoup, label: str) -> Optional[str]:
    """
    Extract value following bold label like:
      <b>Host Club:</b> VALUE
    Best-effort only.
    """
    b = soup.find("b", string=re.compile(rf"^{label}\s*:?\s*$", re.I))
    if not b:
        return None

    sib = b.find_next_sibling()
    if sib:
        v = _text_or_none(sib)
        if v:
            return v

    parent = b.parent
    if parent:
        full = parent.get_text(" ", strip=True)
        full = re.sub(rf"^{label}\s*:?\s*", "", full, flags=re.I).strip()
        return full or None

    return None


def extract_event_record(html: str, source_path: str, source_url: str, soup: BeautifulSoup = None) -> dict:
    """
    Extract raw event data from HTML.
    Returns dict with raw fields and parse notes/warnings.
    """
    if soup is None:
        soup = BeautifulSoup(html, "html.parser")

    parse_notes = []
    warnings = []

    # event_id from URL path
    parts = source_url.split("/")
    event_id = next((p for p in reversed(parts) if p.isdigit()), None)
    if not event_id:
        warnings.append("event_id: not found in path")

    # event name from title
    event_name_raw = None
    if soup.title and soup.title.string:
        event_name_raw = soup.title.string.strip()
        parse_notes.append("event_name: <title> tag")
    else:
        warnings.append("event_name: <title> tag missing")

    # Date from DOM block or overrides
    date_raw = None
    date_node = soup.select_one("div.eventsDateHeader")
    if date_node:
        date_raw = _text_or_none(date_node)
        if date_raw:
            date_raw = re.sub(r"\(\s*concluded\s*\)$", "", date_raw, flags=re.I).strip()
            parse_notes.append("date: div.eventsDateHeader")
    # Check date overrides if HTML parsing didn't find it
    if not date_raw:
        date_raw = DATE_OVERRIDES.get(int(event_id)) if event_id else None
        if date_raw:
            parse_notes.append("date: override")
        else:
            warnings.append("date: div.eventsDateHeader missing")

    # Location from DOM block
    location_raw = None
    location_node = soup.select_one("div.eventsLocationInner")
    if location_node:
        location_raw = _text_or_none(location_node)
        parse_notes.append("location: div.eventsLocationInner")
    if not location_raw:
        warnings.append("location: div.eventsLocationInner missing")

    # Host Club - try DOM first, then bold label
    host_club_raw = None
    host_club_node = soup.select_one("div.eventsHostClubInner")
    if host_club_node:
        host_club_raw = _text_or_none(host_club_node)
        parse_notes.append("host_club: div.eventsHostClubInner")
    if not host_club_raw:
        host_club_raw = extract_by_bold_label(soup, "Host Club") or extract_by_bold_label(soup, "Host")
        if host_club_raw:
            parse_notes.append("host_club: bold label")
    if not host_club_raw:
        warnings.append("host_club: not found")

    # Event Type from bold label
    event_type_raw = extract_by_bold_label(soup, "Event Type") or extract_by_bold_label(soup, "Type")
    if event_type_raw:
        parse_notes.append("event_type: bold label")
    else:
        warnings.append("event_type: not found")

    # Year detection: comprehensive multi-source extraction
    def extract_year_from_sources(*sources):
        """Extract year from multiple text sources. Returns first valid year found."""
        for source in sources:
            if not source:
                continue
            m = re.search(r"\b(19\d{2}|20\d{2})\b", str(source))
            if m:
                year_val = int(m.group(1))
                # Validate reasonable year range
                if 1970 <= year_val <= 2030:
                    return year_val
        return None

    # First pass: check overrides and early-extracted fields
    year = YEAR_OVERRIDES.get(int(event_id)) if event_id else None
    if not year:
        # Check URL path for year (sometimes in path like /events/show/123/2003)
        if source_url:
            url_year = extract_year_from_sources(source_url)
            if url_year:
                year = url_year
                parse_notes.append("year: URL path")
        
        # Check date, title, location, host_club (in order of reliability)
        if not year:
            year = extract_year_from_sources(date_raw, event_name_raw, location_raw, host_club_raw)
            if year:
                # Determine which source had the year for parse notes
                if date_raw and re.search(r"\b(19\d{2}|20\d{2})\b", date_raw):
                    parse_notes.append("year: date_raw")
                elif event_name_raw and re.search(r"\b(19\d{2}|20\d{2})\b", event_name_raw):
                    parse_notes.append("year: event_name_raw")
                elif location_raw and re.search(r"\b(19\d{2}|20\d{2})\b", location_raw):
                    parse_notes.append("year: location_raw")
                elif host_club_raw and re.search(r"\b(19\d{2}|20\d{2})\b", host_club_raw):
                    parse_notes.append("year: host_club_raw")

    # Raw results blob - look specifically in eventsResults div for actual results
    # This div may contain:
    #   1. Structured results in <h2> headers with <br> separated entries (preferred)
    #   2. "Manually Entered Results" in a <pre> block (fallback)
    results_block_raw = None
    results_div = soup.select_one("div.eventsResults")
    if results_div:
        # PREFERRED: Try extracting structured results from <h2> division headers first
        # These have proper division names like "Open Singles Net:" with <br>-separated entries
        # Note: Mixed <br> and <br/> in HTML causes BeautifulSoup issues, so we extract
        # the full text and parse it line by line instead of walking the DOM
        h2_tags = results_div.find_all("h2")
        division_headers = [h2.get_text(strip=True).replace('\u00a0', ' ') for h2 in h2_tags
                           if h2.get_text(strip=True) and "manually" not in h2.get_text(strip=True).lower()]

        if division_headers:
            # Get full text of results div and parse it
            full_text = results_div.get_text("\n", strip=False).replace('\u00a0', ' ')
            lines = full_text.splitlines()
            structured_results = []
            in_structured_section = False
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                # Check if this line is a division header we found
                if line in division_headers or line.rstrip(":") in division_headers:
                    in_structured_section = True
                    structured_results.append(line)
                    continue
                # Stop completely at "Manually Entered Results" — the pre block after this
                # often contains the SAME results, and continuing would re-extract them
                if "manually entered" in line.lower() or line.startswith("Related Photos"):
                    break
                # Collect numbered entries (use full placement regex to handle all separator styles)
                if in_structured_section and _PLACEMENT_LINE_RE.match(line):
                    structured_results.append(line)

            if structured_results and len(structured_results) > len(division_headers):
                results_block_raw = "\n".join(structured_results)
                parse_notes.append("results: div.eventsResults > h2 + structured")

        # FALLBACK: If no structured results, look for <pre> tags with placements
        if not results_block_raw:
            all_pres = results_div.find_all("pre")
            for pre in all_pres:
                pre_text = pre.get_text("\n", strip=False).replace('\u00a0', ' ')
                # Check if this pre contains actual results (numbered placements)
                if _PLACEMENT_LINE_RE.search(pre_text):
                    results_block_raw = pre_text
                    parse_notes.append("results: div.eventsResults > pre (with placements)")
                    break

        # HYBRID: If we have structured results, also check if <pre> has additional content
        # This handles cases where h2 has only NET but <pre> has NET + FREESTYLE
        if results_block_raw:
            results_pre = results_div.select_one("pre.eventsPre")
            if results_pre:
                pre_text = results_pre.get_text("\n", strip=False).replace('\u00a0', ' ')
                has_placements = _PLACEMENT_LINE_RE.search(pre_text)

                if has_placements:
                    # Strategy 1: If <pre> is significantly larger (2x+), prefer it entirely
                    if len(pre_text) > len(results_block_raw) * 2:
                        results_block_raw = pre_text
                        parse_notes.append("results: div.eventsResults > pre.eventsPre (much larger than structured)")
                    # Strategy 2: If <pre> contains "freestyle" but structured doesn't:
                    #   - If pre is larger → prefer pre (h2 had incomplete coverage)
                    #   - If pre is smaller → merge: structured already has more content (e.g.
                    #     full net results), but pre has unique freestyle/special divisions
                    elif (re.search(r'\bfreestyle\b', pre_text, re.I) and
                          not re.search(r'\bfreestyle\b', results_block_raw, re.I)):
                        if len(pre_text) >= len(results_block_raw):
                            results_block_raw = pre_text
                            parse_notes.append("results: div.eventsResults > pre.eventsPre (has freestyle, structured doesn't)")
                        else:
                            # Merge: keep structured (comprehensive) and append pre so
                            # unique divisions in pre (e.g. Shred:30, Sick 3, Golf) are parsed
                            results_block_raw = results_block_raw + "\n" + pre_text
                            parse_notes.append("results: merged h2-structured + pre.eventsPre (structured larger, pre has unique freestyle divs)")

        # Final fallback: any pre.eventsPre in eventsResults
        if not results_block_raw:
            results_pre = results_div.select_one("pre.eventsPre")
            if results_pre:
                results_block_raw = results_pre.get_text("\n", strip=False).replace('\u00a0', ' ')
                parse_notes.append("results: div.eventsResults > pre.eventsPre")

    # Fallback to first pre.eventsPre if no eventsResults div
    # BUT: Avoid extracting from div.eventsEvents (Events Offered section)
    # which contains division names, not actual results
    if not results_block_raw:
        pre = soup.select_one("pre.eventsPre")
        if pre:
            # Check if this pre is inside div.eventsEvents (Events Offered)
            # If so, skip it - it's division names, not results
            events_offered_div = soup.select_one("div.eventsEvents")
            if events_offered_div and pre in events_offered_div.find_all("pre"):
                parse_notes.append("results: skipped pre.eventsPre (inside Events Offered, not results)")
            else:
                results_block_raw = pre.get_text("\n", strip=False).replace('\u00a0', ' ')
                parse_notes.append("results: pre.eventsPre (fallback)")

    if not results_block_raw:
        warnings.append("results: no results found in HTML")

    # Second pass: if year still not found, check results_block_raw and full page body
    if not year:
        # Check results block (sometimes contains year in headers or text)
        if results_block_raw:
            year = extract_year_from_sources(results_block_raw)
            if year:
                parse_notes.append("year: results_block_raw")
        
        # Last resort: check full page body text (but prefer first 2000 chars to avoid noise)
        if not year:
            body_text = soup.get_text(" ", strip=True)
            if body_text:
                # Check first part of body (header area) and last part (footer area)
                # Skip middle which is usually results and can have false positives
                header_sample = body_text[:2000]
                footer_sample = body_text[-1000:] if len(body_text) > 1000 else ""
                year = extract_year_from_sources(header_sample, footer_sample)
                if year:
                    parse_notes.append("year: page body text")
    
    if not year:
        warnings.append("year: not found in any source")

    # Helper to apply both sanitization and encoding fix
    def clean_field(s):
        if not s:
            return None
        return fix_encoding_corruption(sanitize_csv_string(s))

    return {
        "event_id": event_id,
        "year": year,
        "source_path": source_path,
        "source_url": source_url,
        "event_name_raw": clean_field(event_name_raw),
        "date_raw": clean_field(date_raw),
        "location_raw": clean_field(location_raw),
        "host_club_raw": clean_field(host_club_raw),
        "event_type_raw": clean_field(event_type_raw),
        "results_block_raw": clean_field(results_block_raw),
        "html_parse_notes": "; ".join(parse_notes),
        "html_warnings": "; ".join(warnings),
        "_html": html,  # Store for QC checks
        "_soup": soup,  # Store parsed soup for QC checks
    }


def parse_mirror(mirror_dir: Path) -> list[dict]:
    """Parse all event HTML files from the mirror."""
    events_show = find_events_show_dir(mirror_dir)
    records = []

    for html_file in iter_event_html_files(events_show):
        # Use surrogateescape to preserve bytes for fix_encoding_corruption()
        # Don't use errors="replace" as it converts invalid bytes to � before we can fix them
        html = html_file.read_text(encoding="utf-8", errors="surrogateescape")
        source_path = str(html_file)
        source_url = "file://" + source_path.replace("\\", "/")

        rec = extract_event_record(html, source_path, source_url)
        records.append(rec)

    return records


def write_stage1_csv(records: list[dict], out_path: Path) -> None:
    """Write records to stage1 CSV file."""
    if not records:
        print("No records to write!")
        return

    fieldnames = [
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

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)


# ------------------------------------------------------------
# Stage 1 QC System
# ------------------------------------------------------------
def check_results_extraction(rec: dict) -> list[dict]:
    """Check if results were properly extracted."""
    issues = []
    event_id = rec.get("event_id", "")
    location = rec.get("location_raw", "")
    date = rec.get("date_raw", "")
    results = rec.get("results_block_raw", "")
    if not isinstance(results, str):
        results = norm_text(results)
    html = rec.get("_html", "")

    # s1_results_empty: Event has location/date but no results
    if (location or date) and not results:
        issues.append({
            "check_id": "s1_results_empty",
            "severity": "WARN",
            "event_id": event_id,
            "field": "results_block_raw",
            "message": "Event has location/date but no results_block_raw"
        })

    # s1_results_short: results_block_raw < 50 chars (may be incomplete)
    if results and len(results) < 50:
        issues.append({
            "check_id": "s1_results_short",
            "severity": "INFO",
            "event_id": event_id,
            "field": "results_block_raw",
            "message": f"results_block_raw is short ({len(results)} chars, may be incomplete)",
            "example_value": results[:50]
        })

    # s1_results_has_patterns_but_empty: HTML has numbered entries but extraction failed
    if not results and html:
        # Look for placement patterns in HTML
        has_placement_pattern = bool(re.search(r'^\s*[1-9]\d?\s*[.):\-]\s+[A-Z]', html, re.MULTILINE))
        if has_placement_pattern:
            issues.append({
                "check_id": "s1_results_has_patterns_but_empty",
                "severity": "ERROR",
                "event_id": event_id,
                "field": "results_block_raw",
                "message": "HTML contains numbered entries but extraction failed"
            })

    return issues


def check_html_structure(rec: dict) -> list[dict]:
    """Check if expected HTML structure elements were found."""
    issues = []
    event_id = rec.get("event_id", "")
    soup = rec.get("_soup")

    if not soup:
        return issues

    # s1_html_no_events_results_div: Could not find div.eventsResults
    results_div = soup.select_one("div.eventsResults")
    if not results_div:
        issues.append({
            "check_id": "s1_html_no_events_results_div",
            "severity": "WARN",
            "event_id": event_id,
            "field": "html_structure",
            "message": "Could not find div.eventsResults in HTML"
        })

    # s1_html_no_pre_block: No pre.eventsPre found
    pre_block = soup.select_one("pre.eventsPre")
    if not pre_block:
        issues.append({
            "check_id": "s1_html_no_pre_block",
            "severity": "INFO",
            "event_id": event_id,
            "field": "html_structure",
            "message": "No pre.eventsPre found in HTML"
        })

    return issues


def check_field_extraction(rec: dict) -> list[dict]:
    """Check if core fields were extracted."""
    issues = []
    event_id = rec.get("event_id", "")

    # Known broken source events (SQL errors) - don't error on these
    KNOWN_BROKEN = {
        "1023993464", "1030642331", "1099545007", "1151949245",
        "1278991986", "1299244521", "860082052", "941066992", "959094047"
    }
    is_known_broken = str(event_id) in KNOWN_BROKEN

    # s1_location_missing: location_raw empty (not a known broken source)
    if not rec.get("location_raw") and not is_known_broken:
        issues.append({
            "check_id": "s1_location_missing",
            "severity": "ERROR",
            "event_id": event_id,
            "field": "location_raw",
            "message": "location_raw is empty"
        })

    # s1_date_missing: date_raw empty
    if not rec.get("date_raw"):
        issues.append({
            "check_id": "s1_date_missing",
            "severity": "WARN",
            "event_id": event_id,
            "field": "date_raw",
            "message": "date_raw is empty"
        })

    # s1_year_not_found: No year in date or title
    if not rec.get("year"):
        issues.append({
            "check_id": "s1_year_not_found",
            "severity": "WARN",
            "event_id": event_id,
            "field": "year",
            "message": "No year found in date or title"
        })

    # s1_event_name_missing: No event name extracted
    if not rec.get("event_name_raw"):
        issues.append({
            "check_id": "s1_event_name_missing",
            "severity": "ERROR",
            "event_id": event_id,
            "field": "event_name_raw",
            "message": "No event name extracted"
        })

    return issues


def run_stage1_qc(records: list[dict]) -> tuple[dict, list[dict]]:
    """
    Run all Stage 1 QC checks.
    Returns (summary_dict, issues_list).
    """
    all_issues = []

    # Run checks on each record
    for rec in records:
        all_issues.extend(check_results_extraction(rec))
        all_issues.extend(check_html_structure(rec))
        all_issues.extend(check_field_extraction(rec))

    # Build summary
    from collections import defaultdict
    counts_by_check = defaultdict(lambda: {"ERROR": 0, "WARN": 0, "INFO": 0})
    for issue in all_issues:
        counts_by_check[issue["check_id"]][issue["severity"]] += 1

    total_errors = sum(1 for i in all_issues if i["severity"] == "ERROR")
    total_warnings = sum(1 for i in all_issues if i["severity"] == "WARN")
    total_info = sum(1 for i in all_issues if i["severity"] == "INFO")

    # Field coverage stats
    field_coverage = {}
    for field in ["event_id", "event_name_raw", "date_raw", "location_raw", "year", "results_block_raw"]:
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

    return summary, all_issues


def write_stage1_qc_outputs(summary: dict, issues: list[dict], out_dir: Path) -> None:
    """Write Stage 1 QC summary and issues to output files."""
    # Write summary JSON
    summary_path = out_dir / "stage1_qc_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"Wrote: {summary_path}")

    # Write issues JSONL
    issues_path = out_dir / "stage1_qc_issues.jsonl"
    with open(issues_path, "w", encoding="utf-8") as f:
        for issue in issues:
            f.write(json.dumps(issue, ensure_ascii=False) + "\n")
    print(f"Wrote: {issues_path} ({len(issues)} issues)")


def print_stage1_qc_summary(summary: dict) -> None:
    """Print Stage 1 QC summary to console."""
    print(f"\n{'='*60}")
    print("STAGE 1 QC SUMMARY")
    print(f"{'='*60}")
    print(f"Total records: {summary['total_records']}")
    print(f"Total errors:  {summary['total_errors']}")
    print(f"Total warnings: {summary['total_warnings']}")
    print(f"Total info:    {summary['total_info']}")

    print("\nField coverage:")
    for field, stats in summary.get("field_coverage", {}).items():
        print(f"  {field:20s}: {stats['present']:4d}/{stats['total']:4d} ({stats['percent']:5.1f}%)")

    print("\nIssues by check:")
    for check_id, counts in sorted(summary.get("counts_by_check", {}).items()):
        err = counts.get("ERROR", 0)
        warn = counts.get("WARN", 0)
        info = counts.get("INFO", 0)
        parts = []
        if err > 0:
            parts.append(f"{err} ERROR")
        if warn > 0:
            parts.append(f"{warn} WARN")
        if info > 0:
            parts.append(f"{info} INFO")
        if parts:
            print(f"  {check_id}: {', '.join(parts)}")

    print(f"{'='*60}\n")


def print_verification_stats(records: list[dict]) -> None:
    """Print verification gate statistics."""
    total = len(records)
    print(f"\n{'='*60}")
    print("VERIFICATION GATE: Stage 1 (HTML Parsing)")
    print(f"{'='*60}")
    print(f"Total events parsed: {total}")

    if total == 0:
        return

    # Calculate % missing per field
    fields = [
        "event_id", "year", "event_name_raw", "date_raw",
        "location_raw", "host_club_raw", "event_type_raw", "results_block_raw"
    ]

    print("\nField coverage:")
    for field in fields:
        missing = sum(1 for r in records if not r.get(field))
        pct_present = ((total - missing) / total) * 100
        print(f"  {field:20s}: {pct_present:5.1f}% present ({total - missing}/{total})")

    # Year distribution
    years = [r["year"] for r in records if r.get("year")]
    if years:
        min_year, max_year = min(years), max(years)
        print(f"\nYear range: {min_year} - {max_year}")
        print(f"Events with year: {len(years)}/{total}")

        # QC: Check for year gaps (CRITICAL - detects data loss)
        year_set = set(years)
        expected_years = set(range(min_year, max_year + 1))
        missing_years = expected_years - year_set

        if missing_years:
            print(f"\n⚠️  WARNING: Missing years detected!")
            print(f"   Expected continuous range: {min_year}-{max_year}")
            print(f"   Missing years: {sorted(missing_years)}")
            print(f"   This may indicate incomplete mirror data or parsing issues.")

        # Expected: Full footbag history should span ~1970s-present
        # If we only have recent years, flag it
        if min_year > 2010:
            print(f"\n⚠️  WARNING: Suspiciously recent data!")
            print(f"   Oldest event is from {min_year}")
            print(f"   Expected footbag history data from 1990s or earlier")
            print(f"   Check if mirror contains full historical dataset")

    # Sample output (first 3 events)
    print("\nSample events (first 3):")
    for i, rec in enumerate(records[:3]):
        print(f"  [{i+1}] event_id={rec.get('event_id')}, "
              f"year={rec.get('year')}, "
              f"name={str(rec.get('event_name_raw', ''))[:40]}...")

    # Count events with warnings
    with_warnings = sum(1 for r in records if r.get("html_warnings"))
    print(f"\nEvents with parse warnings: {with_warnings}/{total}")

    print(f"{'='*60}\n")


def main():
    """
    Parse HTML mirror and output stage1_raw_events_mirror.csv
    """
    REPO_ROOT = Path(__file__).resolve().parents[2]
    repo_dir = REPO_ROOT

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Project root containing mirror_full/ mirror_repairs/ etc")
    ap.add_argument("--mirror", default="mirror_full", help="Mirror directory under root (default mirror_full)")
    ap.add_argument("--repairs", default="mirror_repairs", help="Repairs overlay directory under root (default mirror_repairs)")
    ap.add_argument("--no-repairs", action="store_true", help="Disable overlay from repairs directory")
    ap.add_argument(
        "--mode",
        choices=["all", "results"],
        default="results",
        help="all = every event page, results = only pages with real results",
    )
    ap.add_argument(
        "--min-results-lines",
        type=int,
        default=5,
        help="Minimum non-empty lines in results block to count as results",
    )
    ap.add_argument(
        "--out",
        default=str(REPO_ROOT / "out"),
        help="Output directory. Default: repo root /out",
    )
    args = ap.parse_args()

    ROOT = Path(args.root).resolve()
    MIRROR_DIR = ROOT / args.mirror / "www.footbag.org" / "events" / "show"
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_csv = out_dir / "stage1_raw_events_mirror.csv"

    event_ids = sorted([p.name for p in MIRROR_DIR.iterdir() if p.is_dir() and p.name.isdigit()])
    print(f"Parsing mirror at: {ROOT / args.mirror} ({len(event_ids)} event dirs)")

    records = []
    for eid in event_ids:
        source_path, html = resolve_event_html(
            ROOT,
            mirror_name=args.mirror,
            repairs_name=args.repairs,
            event_id=eid,
            use_repairs=(not args.no_repairs),
        )
        DEBUG_EIDS = {"1023993464"}  # add more later
        if eid in DEBUG_EIDS:
            print(f"[DEBUG] {eid} using source_path={source_path}")
        if html is None:
            records.append({
                "event_id": eid,
                "year": None,
                "source_path": "",
                "source_url": "",
                "source_file": "",
                "source_layer": args.mirror,
                "event_name_raw": None,
                "date_raw": None,
                "location_raw": None,
                "host_club_raw": None,
                "event_type_raw": None,
                "results_block_raw": None,
                "html_parse_notes": "",
                "html_warnings": "missing_html",
                "results_lines_n": "0",
                "has_results": "False",
            })
            continue
        source_url = "file://" + str(source_path).replace("\\", "/")
        rec = extract_event_record(html, str(source_path), source_url)
        rec["source_file"] = str(source_path) if source_path else ""
        rec["source_layer"] = ("repairs" if (source_path and args.repairs in str(source_path)) else args.mirror)
        results_block_raw = rec.get("results_block_raw") or ""
        rec["results_lines_n"] = str(len([ln for ln in results_block_raw.splitlines() if ln.strip()])) if results_block_raw else "0"
        rec["has_results"] = "True" if compute_has_results(results_block_raw, args.min_results_lines) else "False"
        records.append(rec)

    # --- Recovery override: results blocks recovered from mirror pages ---
    _over = _load_recovered_results_overrides(repo_dir / "overrides" / "recovered_results.jsonl")
    if _over:
        n = 0
        for rec in records:
            eid = str(rec.get("event_id", "")).strip()
            if eid in _over:
                rec["results_block_raw"] = _over[eid]
                n += 1
        print(f"[Stage1] recovered_results overrides applied to rows: {n}")

    # Recompute has_results / results_lines_n after overrides (overrides can add results_block_raw)
    for rec in records:
        results_block_raw = rec.get("results_block_raw") or ""
        rec["results_lines_n"] = str(len([ln for ln in results_block_raw.splitlines() if ln.strip()])) if results_block_raw else "0"
        rec["has_results"] = "True" if compute_has_results(results_block_raw, args.min_results_lines) else "False"

    df = pd.DataFrame(records)
    if args.mode == "results":
        df = df[df["has_results"] == "True"].copy()
    records_to_write = df.to_dict("records")

    print(f"Writing to: {out_csv} (mode={args.mode}, rows={len(records_to_write)})")
    write_stage1_csv(records_to_write, out_csv)

    print_verification_stats(records_to_write)
    print(f"Wrote: {out_csv}")

    # Normalize text fields to real strings before QC (avoids float has no len() etc.)
    TEXT_FIELDS = [
        "event_name_raw", "date_raw", "location_raw", "host_club_raw",
        "event_type_raw", "results_block_raw",
    ]
    for rec in records_to_write:
        for k in TEXT_FIELDS:
            rec[k] = norm_text(rec.get(k))

    # Run Stage 1 QC checks
    print("\nRunning Stage 1 QC checks...")
    qc_summary, qc_issues = run_stage1_qc(records_to_write)
    write_stage1_qc_outputs(qc_summary, qc_issues, out_dir)
    print_stage1_qc_summary(qc_summary)


if __name__ == "__main__":
    main()
