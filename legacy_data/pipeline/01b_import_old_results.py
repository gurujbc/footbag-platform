#!/usr/bin/env python3
"""
01b_import_old_results.py — Import OLD_RESULTS.txt into stage-1 format

PIPELINE LANE: PRE-1997 HISTORICAL
  Not part of the post-1997 production rebuild.
  The pre-1997 pipeline (early_data/scripts/05_build_historical_dataset.py)
  reads OLD_RESULTS.txt directly. This script exists as a utility for
  feeding legacy data into the stage-1 merge if needed.

Goal:
  Convert OLD_RESULTS.txt into rows that look like out/stage1_raw_events.csv
  so Stage 02 (02_canonicalize_results.py) can parse placements normally.

Reads:
  OLD_RESULTS.txt (default: ./OLD_RESULTS.txt)

Writes:
  out/stage1_raw_events_old.csv  (default)

Notes:
- Produces synthetic numeric event_id values (digits-only) to satisfy Stage 02 QC.
- Does NOT invent date/location/host/type; leaves *_raw blank unless present.
- Builds results_block_raw in a "Division Header" + "N. Entry" format.

Stage 1 fieldnames are taken from 01_parse_mirror.py::write_stage1_csv().
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]

# Stage 1 fieldnames (must match 01_parse_mirror.py)
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


# --------------------------------------------------------------------
# Text cleanup (keep conservative; don't "fix" meaning)
# --------------------------------------------------------------------
_C0_ILLEGAL = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")
_REPLACEMENT_CHAR = "\ufffd"


def repair_old_results_encoding(s: str) -> str:
    """
    Repair common Unicode replacement character corruption in OLD_RESULTS.txt.
    - Drop U+FFFD everywhere (e.g., 'Mike Harding\uFFFD' -> 'Mike Harding')
    - Also apply two conservative contextual repairs borrowed from Stage 1:
        word\uFFFDs -> word's
        Name \uFFFDNick\uFFFD Surname -> Name "Nick" Surname
    """
    if not isinstance(s, str) or not s:
        return ""

    # 1) Contextual repairs first (in case you want to preserve meaning)
    # Possessive: Womens -> Women's
    s = re.sub(r"(\w)\ufffd" + r"s\b", r"\1's", s)

    # Nickname quotes: NameNick Surname -> Name "Nick" Surname
    s = re.sub(r"\ufffd(\w+)\ufffd", r'"\1"', s)

    # 2) Then remove any remaining replacement chars (always junk)
    s = s.replace(_REPLACEMENT_CHAR, "")

    return s


def _clean(s: str) -> str:
    """Normalize whitespace + remove C0 controls that can break CSV."""
    if s is None:
        return ""
    s = repair_old_results_encoding(s)
    s = s.replace("\u00A0", " ")  # NBSP
    s = _C0_ILLEGAL.sub("", s)
    # normalize runs of spaces on a single line, but preserve newlines at caller level
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


# Count placement lines in results_block_raw produced by this importer.
# Matches "1. Name", "2. Name", etc. (our canonical output format)
RE_PLACE_DOT_LINE = re.compile(r"^\s*\d+\.\s+\S", re.MULTILINE)


def compute_results_lines_n(results_block_raw: str) -> int:
    if not results_block_raw:
        return 0
    return len(RE_PLACE_DOT_LINE.findall(results_block_raw))


# --------------------------------------------------------------------
# Parsing patterns
# --------------------------------------------------------------------
RE_ADMIN_ONLY = re.compile(r"^\s*world\s+record\b", re.IGNORECASE)
RE_TRAIL_WORLD_RECORD = re.compile(r"\s*-\s*world\s+record\b.*$", re.IGNORECASE)

# Event header: "1983 NHSA:" / "1984:" / "1985 WFA: "
RE_EVENT_HEADER = re.compile(r"^\s*(19\d{2}|20\d{2})\s*([^:]{0,40})\s*:\s*$")

# Division header: "Singles:" / "Team:" or "Women's Doubles Consecutive Kicks -"
RE_DIV_HEADER_COLON = re.compile(r"^\s*([A-Za-z0-9][^:]{0,120})\s*:\s*$")
RE_DIV_HEADER_DASH = re.compile(r"^\s*([A-Za-z0-9].{0,160}?)\s*-\s*$")

# Ordinal placements in their own line: "1st - Name", "2nd - Name", "3rd - Name"
RE_ORD_LINE = re.compile(r"^\s*(\d+)(?:st|nd|rd|th)\s*-\s*(.+?)\s*$", re.IGNORECASE)

# Inline placements: "... - 1st - Name, 2nd - Name, 3rd - Name"
RE_INLINE_ORD = re.compile(
    r"(?P<div>.+?)\s*[-:]\s*1st\s*-\s*(?P<p1>.+?)(?:,|\s{2,}|$)\s*"
    r"(?:2nd\s*-\s*(?P<p2>.+?)(?:,|\s{2,}|$)\s*)?"
    r"(?:3rd\s*-\s*(?P<p3>.+?)\s*)?$",
    re.IGNORECASE
)

# Champion lines: "Intermediate Singles Net Champion - Steve Femmel"
RE_CHAMPION = re.compile(r"^\s*(.+?)\s+Champion\s*-\s*(.+?)\s*$", re.IGNORECASE)

# Variant: "Singles Consecutive Kicks - 1st - Ken Shults" (no 2nd/3rd)
RE_SINGLE_ORD_IN_LINE = re.compile(r"^\s*(.+?)\s*-\s*1st\s*-\s*(.+?)\s*$", re.IGNORECASE)

# Sometimes a line continues with indent (e.g., wrapped 2nd/3rd lines)
RE_CONTINUATION = re.compile(r"^\s{3,}(.+?)\s*$")


@dataclass
class EventBlock:
    year: int
    org: str
    start_line: int
    end_line: int
    raw_lines: List[str]


def _iter_event_blocks(lines: List[str]) -> List[EventBlock]:
    """
    Split file into blocks starting at a year header (e.g., "1983 NHSA:").
    Tracks "Freestyle World Championships Results" section (1982-1986) for
    Singles/Team → freestyle mapping.
    """
    blocks: List[EventBlock] = []
    cur: Optional[EventBlock] = None
    in_freestyle_section = False

    for idx, raw in enumerate(lines, start=1):
        line = _clean(raw)

        # Detect freestyle section header
        if "FREESTYLE WORLD CHAMPIONSHIPS RESULTS" in line.upper():
            in_freestyle_section = True

        # Treat "///" as a harmless separator; do not start a new event.
        if line.strip("/") == "" and "/" in line:
            continue

        m = RE_EVENT_HEADER.match(line)
        if m:
            # close previous
            if cur is not None:
                cur.end_line = idx - 1
                blocks.append(cur)
            year = int(m.group(1))
            org = _clean(m.group(2))
            if year < 1982:
                in_freestyle_section = False
            if in_freestyle_section:
                org = (org + " FREESTYLE").strip()
            cur = EventBlock(
                year=year,
                org=org,
                start_line=idx,
                end_line=idx,
                raw_lines=[],
            )
            continue

        if cur is None:
            # ignore prologue lines before first event header
            continue

        # keep raw (but cleaned) lines inside the event
        if line:
            cur.raw_lines.append(line)

    if cur is not None:
        cur.end_line = len(lines)
        blocks.append(cur)

    return blocks


def _normalize_div_title(s: str) -> str:
    s = _clean(s)
    s = s.rstrip(":").strip()
    # keep original words but normalize spacing; CAPS helps Stage 2 heuristics
    return s.upper()


def _normalize_entry(s: str) -> str:
    s = _clean(s)
    # normalize separators between team members: prefer " / "
    s = re.sub(r"\s*/\s*", " / ", s)
    s = s.strip(" ,")

    # remove trailing admin annotation after a real name
    s = RE_TRAIL_WORLD_RECORD.sub("", s).strip(" ,;-")

    return s


def _extract_inline_placements(line: str) -> Optional[Tuple[str, List[str]]]:
    """
    Parse lines like:
      "Singles Net - 1st - John..., 2nd - Walt..., 3rd - Ken..."
    Returns (division_title, [p1, p2, p3]) with any missing removed.
    """
    m = RE_INLINE_ORD.match(line)
    if not m:
        return None
    div = _normalize_div_title(m.group("div"))
    p1 = _normalize_entry(m.group("p1") or "")
    p2 = _normalize_entry(m.group("p2") or "")
    p3 = _normalize_entry(m.group("p3") or "")
    placements = [p for p in [p1, p2, p3] if p]
    if not div or not placements:
        return None
    return div, placements


def _build_results_block(
    event_lines: List[str],
    *,
    context: str = "",
) -> Tuple[str, List[str]]:
    """
    Convert event lines to the canonical results_block_raw:
      DIVISION
      1. Name
      2. Name
      ...
    Also returns warnings.
    """
    out_lines: List[str] = []
    warnings: List[str] = []

    current_div: Optional[str] = None
    last_seen_div: Optional[str] = None
    buffered: List[str] = []  # placement entries for current_div

    def flush():
        nonlocal current_div, buffered
        if current_div and buffered:
            out_lines.append(current_div)
            for i, ent in enumerate(buffered, start=1):
                out_lines.append(f"{i}. {ent}")
            out_lines.append("")  # blank line between divisions
        current_div = None
        buffered = []

    # Pre-pass: stitch continuation lines (indented wraps)
    stitched: List[str] = []
    for line in event_lines:
        mcont = RE_CONTINUATION.match(line)
        if mcont and stitched:
            stitched[-1] = stitched[-1].rstrip() + " " + _clean(mcont.group(1))
        else:
            stitched.append(line)

    for line in stitched:
        # 1) Inline placements with 1st/2nd/3rd in one line
        inline = _extract_inline_placements(line)
        if inline:
            flush()
            div, places = inline
            # drop pure admin-text "names"
            filtered_places = []
            for ent in places:
                if RE_ADMIN_ONLY.match(ent):
                    warnings.append(f"dropped_admin_only_entry: {ent[:80]}")
                else:
                    filtered_places.append(ent)
            out_lines.append(div)
            for i, ent in enumerate(filtered_places, start=1):
                out_lines.append(f"{i}. {ent}")
            out_lines.append("")
            continue

        # 2) "X - 1st - Name" only
        m1 = RE_SINGLE_ORD_IN_LINE.match(line)
        if m1 and "2nd" not in line.lower() and "3rd" not in line.lower():
            div = _normalize_div_title(m1.group(1))
            ent = _normalize_entry(m1.group(2))
            if div and ent:
                if RE_ADMIN_ONLY.match(ent):
                    warnings.append(f"dropped_admin_only_entry: {ent[:80]}")
                else:
                    flush()
                    out_lines.append(div)
                    out_lines.append(f"1. {ent}")
                    out_lines.append("")
                continue

        # 3) Champion line: treat as a division with single winner
        mch = RE_CHAMPION.match(line)
        if mch:
            div = _normalize_div_title(mch.group(1))
            ent = _normalize_entry(mch.group(2))
            flush()
            if div and ent:
                if RE_ADMIN_ONLY.match(ent):
                    warnings.append(f"dropped_admin_only_entry: {ent[:80]}")
                else:
                    out_lines.append(div)
                    out_lines.append(f"1. {ent}")
                    out_lines.append("")
            continue

        # 4) Division header with colon ("Singles:")
        mh = RE_DIV_HEADER_COLON.match(line)
        if mh:
            flush()
            title = mh.group(1)
            title_norm = _normalize_div_title(title)
            if context == "freestyle" and title_norm in {"SINGLES", "TEAM"}:
                current_div = "SINGLES FREESTYLE" if title_norm == "SINGLES" else "TEAM FREESTYLE"
            else:
                current_div = title_norm
            last_seen_div = current_div
            continue

        # 5) Division header with trailing dash ("Women's Doubles ... -" or "Singles -")
        md = RE_DIV_HEADER_DASH.match(line)
        if md and "1st" not in line.lower() and "2nd" not in line.lower() and "3rd" not in line.lower():
            flush()
            title_norm = _normalize_div_title(md.group(1))
            if context == "freestyle" and title_norm in {"SINGLES", "TEAM"}:
                current_div = "SINGLES FREESTYLE" if title_norm == "SINGLES" else "TEAM FREESTYLE"
            else:
                current_div = title_norm
            last_seen_div = current_div
            continue

        # 6) Ordinal lines within a division
        mo = RE_ORD_LINE.match(line)
        if mo:
            if not current_div:
                if last_seen_div:
                    current_div = last_seen_div
                    warnings.append(f"implicit_division_reused: {current_div}")
                else:
                    current_div = "UNKNOWN DIVISION"
                    warnings.append(f"placement_without_division: {line[:80]}")
                last_seen_div = current_div
            ent = _normalize_entry(mo.group(2))
            if ent:
                if RE_ADMIN_ONLY.match(ent):
                    warnings.append(f"dropped_admin_only_entry: {ent[:80]}")
                else:
                    buffered.append(ent)
            continue

        # 7) Otherwise ignore (titles, blank separators, etc.)
        # But keep a small breadcrumb for weird lines that look meaningful
        if any(tok in line.lower() for tok in ["1st", "2nd", "3rd"]) and not inline and not mo:
            warnings.append(f"unparsed_placement_like_line: {line[:120]}")

    flush()

    # Trim trailing blank line
    while out_lines and out_lines[-1] == "":
        out_lines.pop()

    return "\n".join(out_lines).strip(), warnings


def _make_event_name(year: int, org: str) -> str:
    org = _clean(org)
    if org:
        return f"World Championships {year} ({org})"
    return f"World Championships {year}"


def _synthetic_event_id(year: int, seq_in_year: int) -> str:
    """
    Digits-only synthetic ID to satisfy Stage 02's event_id digit pattern check.
    Scheme: 2000000000 + year*1000 + seq  (stable, non-overlapping with 100xxxxxxx)
    """
    return str(2000000000 + year * 1000 + seq_in_year)


def build_stage1_rows_from_old_results(
    txt_path: Path,
    audit_path: Optional[Path] = None,
) -> List[dict]:
    raw = txt_path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()

    blocks = _iter_event_blocks(lines)

    # ------------------------------------------------------------------
    # NEW: merge duplicate sections inside OLD_RESULTS.txt by (year, org)
    # ------------------------------------------------------------------
    def org_norm(org: str) -> str:
        o = _clean(org or "")
        o = o.upper()
        return o if o else "UNKNOWN"

    merged: Dict[Tuple[int, str], dict] = {}
    for b in blocks:
        key = (b.year, org_norm(b.org))
        if key not in merged:
            merged[key] = {
                "year": b.year,
                "org_raw": _clean(b.org),
                "start_line": b.start_line,
                "end_line": b.end_line,
                "raw_lines": list(b.raw_lines),
                "block_count": 1,
            }
        else:
            m = merged[key]
            m["start_line"] = min(m["start_line"], b.start_line)
            m["end_line"] = max(m["end_line"], b.end_line)
            m["raw_lines"].extend(b.raw_lines)
            m["block_count"] += 1

    # deterministic ordering: by year then org
    merged_items = sorted(merged.items(), key=lambda kv: (kv[0][0], kv[0][1]))

    rows: List[dict] = []
    audit: List[dict] = []
    per_year_seq: Dict[int, int] = {}

    # ------------------------------------------------------------------
    # infer event_type_raw from divisions present (avoid "worlds" QC)
    # ------------------------------------------------------------------
    def infer_event_type(results_block_raw: str) -> str:
        t = (results_block_raw or "").upper()
        has_net = " NET" in t or t.startswith("NET") or "\nNET" in t
        has_fs = "FREESTYLE" in t or "ROUTINES" in t
        has_golf = "GOLF" in t
        has_consec = "CONSECUTIVE" in t or "KICKS" in t
        # keep conservative and simple
        if has_net and has_fs:
            return "mixed"
        if has_net:
            return "net"
        if has_fs:
            return "freestyle"
        if has_golf and not (has_net or has_fs):
            return "golf"
        if has_consec and not (has_net or has_fs):
            return "consecutive"
        return ""

    for (year, _orgN), m in merged_items:
        # Skip standalone "NHSA/WFA FREESTYLE" sub-events — their content is
        # duplicated (or a subset of) the main NHSA/WFA event for the same year.
        if (m.get("org_raw") or "").upper().endswith("FREESTYLE"):
            continue

        per_year_seq[year] = per_year_seq.get(year, 0) + 1
        eid = _synthetic_event_id(year, per_year_seq[year])

        ctx = "freestyle" if "FREESTYLE" in (m.get("org_raw") or "").upper() else ""
        results_block_raw, warnings = _build_results_block(
            m["raw_lines"],
            context=ctx,
        )
        event_type_raw = infer_event_type(results_block_raw)

        parse_notes = [
            "importer:01b_import_old_results",
            f"source:{txt_path.name}",
            "results:normalized_from_text",
        ]
        if m["org_raw"]:
            parse_notes.append(f"org:{m['org_raw']}")
        if m["block_count"] > 1:
            parse_notes.append(f"merged_blocks:{m['block_count']}")

        # merged line span for traceability
        src = f"{txt_path.name}#L{m['start_line']}-{m['end_line']}"

        n_lines = compute_results_lines_n(results_block_raw)

        row = {
            "event_id": eid,
            "year": str(year),

            # traceability
            "source_path": src,
            "source_url": "",                 # keep blank (no real URL); avoids downstream "url-like" confusion
            "source_file": txt_path.name,     # "OLD_RESULTS.txt"
            "source_layer": "old_results",

            # raw fields
            "event_name_raw": _make_event_name(year, m["org_raw"]),
            "date_raw": "",
            "location_raw": "",
            "host_club_raw": "",
            "event_type_raw": event_type_raw,

            # results
            "results_block_raw": results_block_raw,
            "results_lines_n": str(n_lines),
            "has_results": "True" if n_lines > 0 else "False",

            # notes / warnings
            "html_parse_notes": "; ".join(parse_notes),
            "html_warnings": "; ".join(warnings),
        }
        rows.append(row)

        audit.append({
            "year": year,
            "org": m["org_raw"],
            "lines_in": len(m["raw_lines"]),
            "chars_out": len(results_block_raw),
            "warnings": warnings[:10],
        })

    if audit_path:
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with open(audit_path, "w", encoding="utf-8") as f:
            for rec in audit:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    return rows


def write_stage1_csv(rows: List[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=STAGE1_FIELDNAMES, extrasaction="raise")
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description="Import OLD_RESULTS.txt into stage1_raw_events-shaped CSV.")
    ap.add_argument(
        "--old-results",
        dest="old_results_path",
        default=str(REPO_ROOT / "inputs" / "OLD_RESULTS.txt"),
        help="Path to OLD_RESULTS.txt (default: <repo_root>/inputs/OLD_RESULTS.txt)",
    )
    ap.add_argument("--out", dest="out_path", default="out/stage1_raw_events_old.csv", help="Output CSV path")
    args = ap.parse_args()

    in_path = Path(args.old_results_path)
    out_path = Path(args.out_path)

    if not in_path.exists():
        raise SystemExit(f"Input file not found: {in_path}")

    audit_path = out_path.parent / "old_results_import_audit.jsonl"
    rows = build_stage1_rows_from_old_results(in_path, audit_path=audit_path)
    write_stage1_csv(rows, out_path)

    # Minimal stdout summary
    years = sorted({r["year"] for r in rows if r.get("year")})
    print(f"Imported events: {len(rows)}")
    if years:
        print(f"Year range: {years[0]}–{years[-1]}")
    print(f"Wrote: {out_path}")
    print(f"Audit: {audit_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
