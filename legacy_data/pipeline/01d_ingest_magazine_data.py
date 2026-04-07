#!/usr/bin/env python3
"""
pipeline/01d_ingest_magazine_data.py
─────────────────────────────────────
PIPELINE LANE: PRE-1997 HISTORICAL
  Not part of the post-1997 production rebuild.
  Magazine-derived event data belongs to the pre-1997 historical recovery
  pipeline (run_early_pipeline.sh). The post-1997 rebuild uses mirror only.

Ingests inputs/magazine_ingestion_comprehensive.csv into the pipeline.

Actions:
  1. Maps every (raw_year, raw_event_name, raw_location) → event_id
  2. Writes legacy_data/event_results/{event_id}.txt for every event
  3. Appends new event entries to inputs/magazine_scan_index.csv
  4. Prints RESULTS_FILE_OVERRIDE stubs to add to 02_canonicalize_results.py

New synthetic event IDs assigned (pre-mirror, magazine sources):
  2001980002  World Footbag Championships 1980 (IFAB-RB, Memphis)
  2001980003  Western States Footbag Championships 1980
  2001981003  World Footbag Championships 1981 (IFAB-RB/FBW, Camelot Park)
  2001981004  Texas State Footbag Championships 1981
  2001982003  World Footbag Championships 1982 (IFAB-RB, Golden Gate)
  2001982004  Rocky Mountain Open 1982
  2001982005  World Footbag Championships 1982 (FQ, Portland)
  2001983005  World Footbag Championships 1983 (IFAB-RB, Oregon City)
  2001984003  World Footbag Championships 1984 (IFAB-RB, Oregon City)
  2001984004  European Footbag Championships 1984
  2001985004  Western States Footbag Championships 1985
  2001985005  World Footbag Championships 1985 (FBW-V4N2, Golden)
  2001986003  Sunshine State Open 1986
  2001986004  World Footbag Championships 1986
  2001987001  World Footbag Championships 1987
  2001987002  European Footbag Championships 1987
  2001987003  Eastern Regionals 1987
  2001988001  California State Open 1988
  2001989001  World Footbag Championships 1989
  2001990001  World Footbag Championships 1990
  2001991001  World Footbag Championships 1991
  2001992001  World Footbag Championships 1992
  2001994001  World Footbag Championships 1994
  2001995001  World Footbag Championships 1995
  2001995002  European Open 1995

Option A mapping (1986 retrospective rows → existing synthetic IDs):
  "1986 | 1980 World Footbag Championships" → 2001980001
  "1986 | 1981 World Footbag Championships" → 2001981001
  "1986 | 1982 World Footbag Championships" → 2001982001
  "1986 | 1983 World Footbag Championships" → 2001983001

Usage:
    .venv/bin/python pipeline/01d_ingest_magazine_data.py [--dry-run]
"""

from __future__ import annotations
import csv, sys
from collections import defaultdict, OrderedDict
from pathlib import Path

ROOT          = Path(__file__).resolve().parent.parent
INGESTION_CSV = ROOT / "inputs" / "magazine_ingestion_comprehensive_v1.csv"
SCAN_INDEX    = ROOT / "inputs" / "magazine_scan_index.csv"
LEGACY_DIR    = ROOT / "legacy_data" / "event_results"

# ── Event ID mapping ──────────────────────────────────────────────────────────
# 3-tuple keys (year, name_lower, location_lower) take priority over 2-tuple.
# Needed where the same (year, name) resolves to different events by location.

_MAP3: dict[tuple[str, str, str], str] = {
    # 1982 Worlds: three distinct events share the name "World Footbag Championships"
    ("1982", "world footbag championships", "golden gate, san francisco"): "2001982003",
    ("1982", "world footbag championships", "portland or"):                "2001982005",
    # 1981 Worlds: IFAB-RB (Camelot Park) vs FBW-ARCHIVE (Portland) — disambiguate
    ("1981", "world footbag championships", "camelot park, california"):   "2001981003",
}

_MAP2: dict[tuple[str, str], str] = {
    # ── 1985 stage2 stubs (no legacy files yet) ───────────────────────────
    ("1985", "wfa rocky mountain regionals"):                            "9980521",
    ("1985", "1985 holiday classic"):                                    "9984533",
    ("1985", "greatest lakes footbag open"):                             "9918278",
    ("1985", "st. valentines day footbag massacre"):                     "9958186",
    ("1985", "floodbag finals"):                                         "9972848",
    ("1985", "western national indoor footbag freestyle championship"):  "9940469",
    # ── Existing mirror Worlds (FBW-ARCHIVE, raw_year = competition year) ─
    ("1980", "1980 world footbag championships"):                        "9928572",
    ("1981", "1981 world footbag championships"):                        "9992129",
    ("1982", "1982 world footbag championships"):                        "9998504",
    ("1983", "1983 world footbag championships"):                        "9904297",
    ("1984", "1984 world footbag championships"):                        "9924417",
    # ── Other existing events ─────────────────────────────────────────────
    ("1983", "secret underground jam"):                                  "9934528",
    # ── 1986 retrospective → Option A: merge into existing synthetics ─────
    # raw_year=1986 but these rows describe 1980-1983 championships.
    ("1986", "1980 world footbag championships"):                        "2001980001",
    ("1986", "1981 world footbag championships"):                        "2001981001",
    ("1986", "1982 world footbag championships"):                        "2001982001",
    ("1986", "1983 world footbag championships"):                        "2001983001",
    # ── New synthetics ────────────────────────────────────────────────────
    # 1980
    ("1980", "world footbag championships"):                             "2001980002",
    ("1980", "western states footbag championships"):                    "2001980003",
    # 1981
    ("1981", "world footbag championships"):                             "2001981003",
    ("1981", "texas state footbag championships"):                       "2001981004",
    # 1982
    ("1982", "world footbag championships"):                             "2001982003",
    ("1982", "rocky mountain open"):                                     "2001982004",
    # 1983
    ("1983", "world footbag championships"):                             "2001983005",
    # 1984
    ("1984", "world footbag championships"):                             "2001984003",
    ("1984", "european footbag championships"):                          "2001984004",
    # 1985
    ("1985", "western states footbag championships"):                    "2001985004",
    ("1985", "world footbag championships"):                             "2001985005",
    # 1986
    ("1986", "sunshine state open"):                                     "2001986003",
    ("1986", "world footbag championships"):                             "2001986004",
    # 1987
    ("1987", "world footbag championships"):                             "2001987001",
    ("1987", "european footbag championships"):                          "2001987002",
    ("1987", "eastern regionals"):                                       "2001987003",
    # 1988
    ("1988", "california state open"):                                   "2001988001",
    # 1989–1995 (magazine snippets; distinct from mirror events for these years)
    ("1989", "world footbag championships"):                             "2001989001",
    ("1990", "world footbag championships"):                             "2001990001",
    ("1991", "world footbag championships"):                             "2001991001",
    ("1992", "world footbag championships"):                             "2001992001",
    ("1994", "world footbag championships"):                             "2001994001",
    ("1995", "world footbag championships"):                             "2001995001",
    ("1995", "european open"):                                           "2001995002",
}

# For "1986 retrospective" entries the raw_year is 1986 but the competition
# actually took place in 1980-1983.  Store the true competition year here.
TRUE_YEAR: dict[str, str] = {
    "2001980001": "1980",
    "2001981001": "1981",
    "2001982001": "1982",
    "2001983001": "1983",
}


def get_event_id(year: str, name: str, location: str) -> str:
    k3 = (year, name.lower().strip(), location.lower().strip())
    k2 = (year, name.lower().strip())
    return _MAP3.get(k3) or _MAP2.get(k2) or ""


def scan_rotation(year: str) -> int:
    y = int(year)
    if y <= 1981:
        return 270
    if y == 1984:
        return 90
    return 0


# ── Load and group ────────────────────────────────────────────────────────────

def load_rows() -> list[dict]:
    with open(INGESTION_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def group_by_event(rows: list[dict]) -> dict[str, dict]:
    """Return OrderedDict[event_id → event_meta] preserving first-seen order."""
    events: dict[str, dict] = OrderedDict()
    unmapped: list[tuple] = []

    for row in rows:
        year = row["raw_year"].strip()
        name = row["raw_event_name"].strip()
        loc  = row["raw_location"].strip()
        eid  = get_event_id(year, name, loc)
        if not eid:
            unmapped.append((year, name, loc, row.get("source_ref", "")))
            continue

        true_year = TRUE_YEAR.get(eid, year)

        if eid not in events:
            events[eid] = {
                "event_id":    eid,
                "year":        true_year,
                "name":        name,
                "location":    loc,
                "source_refs": [],
                "source_files": [],
                "rows":        [],
            }

        ev = events[eid]
        sr = row.get("source_ref", "").strip()
        if sr and sr not in ev["source_refs"]:
            ev["source_refs"].append(sr)
        sf = row.get("source_file", "").strip()
        if sf and sf not in ev["source_files"]:
            ev["source_files"].append(sf)
        ev["rows"].append(row)

    if unmapped:
        print(f"\nWARN: {len(unmapped)} rows had no event_id mapping:", file=sys.stderr)
        for u in unmapped:
            print(f"  year={u[0]!r}  name={u[1]!r}  loc={u[2]!r}  src={u[3]!r}",
                  file=sys.stderr)

    return events


# ── Legacy .txt generation ────────────────────────────────────────────────────

def format_legacy_txt(ev: dict) -> str:
    lines: list[str] = []
    lines.append(f"# {ev['name']}")
    if ev["location"]:
        lines.append(f"# {ev['location']}")
    lines.append(f"# Year: {ev['year']}")
    srefs = ", ".join(ev["source_refs"])
    lines.append(f"# Source: {srefs}")
    if ev["source_files"]:
        lines.append(f"# Scan: {', '.join(ev['source_files'])}")
    lines.append("")

    # Group by discipline, preserving first-seen order
    by_div: dict[str, list[dict]] = OrderedDict()
    for row in ev["rows"]:
        div = row["raw_discipline"].strip()
        by_div.setdefault(div, []).append(row)

    # Deduplicate within each division by (placement, player_names)
    for div_name, div_rows in by_div.items():
        seen: set[tuple] = set()
        deduped = []
        for row in div_rows:
            key = (row["placement"].strip(), row["raw_player_names"].strip())
            if key not in seen:
                seen.add(key)
                deduped.append(row)
        # Sort by placement integer
        deduped.sort(key=lambda r: int(r["placement"]) if r["placement"].strip().isdigit() else 999)

        lines.append(div_name)
        for row in deduped:
            place   = row["placement"].strip()
            players = row["raw_player_names"].strip().replace(" / ", " & ")
            lines.append(f"{place}. {players}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# ── Scan index helpers ────────────────────────────────────────────────────────

def load_existing_scan_index() -> set[str]:
    """Return set of event_ids already in the scan index."""
    existing: set[str] = set()
    if not SCAN_INDEX.exists():
        return existing
    with open(SCAN_INDEX, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            existing.add(r["event_id"].strip())
    return existing


# ── Main ──────────────────────────────────────────────────────────────────────

def main(dry_run: bool = False) -> None:
    prefix = "[DRY RUN] " if dry_run else ""
    LEGACY_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading ingestion CSV…")
    rows = load_rows()
    print(f"  {len(rows)} rows")

    print("Grouping by event…")
    events = group_by_event(rows)
    print(f"  {len(events)} distinct events mapped")

    existing_scan = load_existing_scan_index()
    new_scan_entries: list[dict] = []
    override_stubs:   list[str]  = []
    written = 0
    updated = 0

    for eid, ev in events.items():
        txt       = format_legacy_txt(ev)
        out_path  = LEGACY_DIR / f"{eid}.txt"
        is_update = out_path.exists()

        if not dry_run:
            out_path.write_text(txt, encoding="utf-8")

        tag = "UPD" if is_update else "NEW"
        placements = sum(1 for r in ev["rows"])
        print(f"  [{tag}] {eid}  {ev['year']}  {ev['name'][:48]:48}  {placements} rows")
        if is_update:
            updated += 1
        else:
            written += 1

        # RESULTS_FILE_OVERRIDE stub (always print — needed for both new and updated)
        override_stubs.append(
            f'        "{eid}": {{\n'
            f'            "file":    "legacy_data/event_results/{eid}.txt",\n'
            f'            "replace": True,\n'
            f'        }},'
        )

        # Scan index: only add if has a source image AND not already indexed
        primary_jpg = ev["source_files"][0] if ev["source_files"] else ""
        if primary_jpg and eid not in existing_scan:
            new_scan_entries.append({
                "event_id":   eid,
                "event_name": ev["name"],
                "year":       ev["year"],
                "source_jpg": primary_jpg,
                "rotation":   scan_rotation(ev["year"]),
                "notes":      f"{', '.join(ev['source_refs'])} — {ev['name']} ({ev['year']})",
            })

    print(f"\n{prefix}Legacy files: {written} created, {updated} updated")

    # ── Append new scan index entries ─────────────────────────────────────────
    if new_scan_entries:
        if not dry_run:
            with open(SCAN_INDEX, "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(
                    f,
                    fieldnames=["event_id", "event_name", "year",
                                "source_jpg", "rotation", "notes"],
                )
                for entry in new_scan_entries:
                    w.writerow(entry)
            print(f"{prefix}Appended {len(new_scan_entries)} entries to magazine_scan_index.csv")
        else:
            print(f"{prefix}Would append {len(new_scan_entries)} entries to magazine_scan_index.csv:")
            for e in new_scan_entries:
                print(f"    {e['event_id']}  {e['year']}  {e['source_jpg']}")

    # ── Print RESULTS_FILE_OVERRIDE stubs ─────────────────────────────────────
    print(f"\n{'='*72}")
    print("Add these to RESULTS_FILE_OVERRIDE in pipeline/02_canonicalize_results.py")
    print("(skip any event_ids already present in the dict):")
    print("=" * 72)
    for stub in override_stubs:
        print(stub)


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
