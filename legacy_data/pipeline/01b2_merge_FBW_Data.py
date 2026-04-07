#!/usr/bin/env python3
"""
01b2_merge_FBW_Data.py — Prepare FBW magazine data for the stage-1 merge

PIPELINE LANE: PRE-1997 HISTORICAL
  Not part of the post-1997 production rebuild.
  Magazine-derived event data belongs to the pre-1997 historical recovery
  pipeline (run_early_pipeline.sh). The post-1997 rebuild uses mirror only.

Converts inputs/magazine_ingestion.csv into a stage1-compatible CSV
(out/stage1_raw_events_fbw.csv) that 01c_merge_stage1.py can merge
alongside mirror and legacy-results sources.

Column conventions (must match stage1_raw_events_mirror.csv exactly):
  event_id        — synthetic "99XXXX" ID, MD5-deterministic per (name|year|source_ref)
  source_layer    — "magazine"
  results_block_raw — plain "Division: X\nN. Player\n..." text for the 02 parser
"""

from __future__ import annotations
import argparse
import csv
import hashlib
import re
import pandas as pd
from pathlib import Path

# Must match stage1_raw_events_mirror.csv exactly so 01c passes schema validation
STAGE1_FIELDNAMES = [
    "event_id", "year", "source_path", "source_url", "source_file", "source_layer",
    "event_name_raw", "date_raw", "location_raw", "host_club_raw", "event_type_raw",
    "results_block_raw", "results_lines_n", "has_results",
    "html_parse_notes", "html_warnings",
]


def make_event_id(event_name: str, year, source_ref: str, location: str = "") -> str:
    """Deterministic 6-digit synthetic event_id with '99' prefix.

    Uses MD5 so the same (name, year, source_ref, location) always yields the
    same ID regardless of Python hash-seed randomisation (PYTHONHASHSEED).
    Location is included to differentiate events with the same name/year/source
    but different venues (e.g. two sources disagree on where the 1980 Worlds was).
    The '99' prefix keeps these IDs far from real Footbag.org IDs (10 digits)
    and from the pre-mirror stubs (200YYYYNNN format).
    """
    key = f"{event_name}|{year}|{source_ref}|{location}"
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    event_hash = int(digest[:8], 16) % 100000
    return f"99{event_hash:05d}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="inputs/magazine_ingestion.csv")
    parser.add_argument("--out", default="out/stage1_raw_events_fbw.csv")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"No magazine data found at {input_path}. Writing empty output.")
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=STAGE1_FIELDNAMES).writeheader()
        return

    df = pd.read_csv(input_path, dtype=str)

    # Auto-correct year BEFORE grouping so retrospective articles and direct records
    # for the same event (e.g. both year=1986 and year=1983 rows for the 1983 Worlds)
    # are merged into one group rather than producing ID collisions.
    def _correct_year(row):
        ev = str(row["raw_event_name"]) if pd.notna(row["raw_event_name"]) else ""
        yr = str(row["raw_year"]) if pd.notna(row["raw_year"]) else ""
        m = re.match(r"^(\d{4})\s+", ev)
        if m and yr.isdigit() and m.group(1) != yr:
            return m.group(1)
        return yr
    df["raw_year"] = df.apply(_correct_year, axis=1)

    # Group rows into events
    group_cols = ["raw_event_name", "raw_year", "raw_location", "source_ref", "verification_level"]
    # dropna=False preserves events with missing location (e.g. Secret Underground Jam)
    grouped = df.groupby(group_cols, dropna=False)

    stage1_rows = []
    seen_ids: dict[str, str] = {}   # id → event_key (collision detection)

    for (event_name, year, location, source_ref, ver_level), group in grouped:
        event_name_s = str(event_name) if pd.notna(event_name) else ""
        year_s       = str(year)       if pd.notna(year)       else ""
        location_s   = str(location)   if pd.notna(location)   else ""
        source_ref_s = str(source_ref) if pd.notna(source_ref) else ""

        # Auto-correct year for retrospective magazine articles.
        # A 1986 magazine covering "1980 World Footbag Championships" should use
        # year=1980 (the event year) so it appears in the correct workbook sheet.
        name_year_m = re.match(r"^(\d{4})\s+", event_name_s)
        if name_year_m and year_s.isdigit() and name_year_m.group(1) != year_s:
            corrected = name_year_m.group(1)
            print(f"[01b2] Year correction: {event_name_s!r} {year_s} → {corrected}")
            year_s = corrected

        event_id = make_event_id(event_name_s, year_s, source_ref_s, location_s)

        # Collision detection within magazine batch (key includes location)
        event_key = f"{event_name_s}|{year_s}|{location_s}|{source_ref_s}"
        if event_id in seen_ids and seen_ids[event_id] != event_key:
            print(f"WARNING: ID collision {event_id}: '{seen_ids[event_id]}' vs '{event_key}'")
        seen_ids[event_id] = event_key

        # Build results_block_raw in the plain format the stage-02 parser handles:
        #   Division: <name>
        #   1. Player One
        #   2. Player Two / Player Three   ← doubles use " / " separator
        #   (blank line between divisions)
        blocks: list[str] = []
        for disc, disc_group in group.groupby("raw_discipline", dropna=False):
            disc_s = str(disc) if pd.notna(disc) else "Unknown"
            blocks.append(f"Division: {disc_s}")
            for _, row in disc_group.sort_values("placement").iterrows():
                placement = row.get("placement", "")
                player    = row.get("raw_player_names", "")
                try:
                    placement_int = int(float(str(placement)))
                except (ValueError, TypeError):
                    placement_int = 0
                blocks.append(f"{placement_int}. {player}")
            blocks.append("")   # blank spacer between divisions

        results_block = "\n".join(blocks)

        full_row = {
            "event_id":        event_id,
            "year":            year_s,
            "source_path":     f"Magazine/{source_ref_s}",
            "source_url":      "",
            "source_file":     input_path.name,
            "source_layer":    "magazine",
            "event_name_raw":  event_name_s,
            "date_raw":        "",
            "location_raw":    location_s,
            "host_club_raw":   "",
            "event_type_raw":  "",
            "results_block_raw": results_block,
            "results_lines_n": str(len(group)),
            "has_results":     "True",
            "html_parse_notes": f"source_ref={source_ref_s}; verification_level={ver_level}",
            "html_warnings":   "",
        }
        stage1_rows.append(full_row)

    # Write output
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=STAGE1_FIELDNAMES)
        writer.writeheader()
        writer.writerows(stage1_rows)

    print(f"[01b2] Processed {len(stage1_rows)} magazine events → {out_path}")


if __name__ == "__main__":
    main()
