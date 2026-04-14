#!/usr/bin/env python3
"""
detect_team_anomalies.py

Scans canonical + PBP data to produce a ranked anomaly worklist
for team/participant corrections.

Usage (from legacy_data/):
    .venv/bin/python pipeline/detect_team_anomalies.py
    .venv/bin/python pipeline/detect_team_anomalies.py --severity HIGH
    .venv/bin/python pipeline/detect_team_anomalies.py --limit 50

Outputs:
    out/team_anomaly_worklist.csv
    stdout: ranked summary
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PBP_CSV = ROOT / "out" / "Placements_ByPerson.csv"
PARTICIPANTS_CSV = ROOT / "out" / "canonical" / "event_result_participants.csv"
EVENTS_CSV = ROOT / "out" / "canonical" / "events.csv"
DISCIPLINES_CSV = ROOT / "out" / "canonical" / "event_disciplines.csv"
CORRECTIONS_CSV = ROOT / "inputs" / "team_corrections.csv"
OUT_CSV = ROOT / "out" / "team_anomaly_worklist.csv"

csv.field_size_limit(10 * 1024 * 1024)

# ---------------------------------------------------------------------------
# Location / junk detection
# ---------------------------------------------------------------------------

_LOCATIONS = {
    "usa", "canada", "france", "germany", "japan", "finland", "czech",
    "sweden", "denmark", "norway", "brazil", "colombia", "mexico",
    "australia", "poland", "california", "arizona", "colorado", "oregon",
    "texas", "washington", "illinois", "massachusetts", "nebraska",
    "maryland", "connecticut", "minnesota", "virginia", "georgia",
    "quebec", "ontario", "british columbia", "montreal", "toronto",
    "phoenix", "chicago", "denver", "portland", "seattle", "san francisco",
    "san rafael", "mountain view", "berkeley", "chandler", "austin",
    "ellenville", "thornton", "college park", "hebron", "gill",
}
_STATE_ABBREV = {
    "ca", "co", "or", "md", "wa", "mn", "tx", "il", "ny", "nj",
    "fl", "oh", "ga", "az", "ct", "va", "sc", "nc", "pa",
}
_SKIP_NAMES = {
    "[unknown partner]", "__unknown_partner__", "__non_person__",
    "unknown", "(unknown)", "",
}

# Event importance ranking
_EVENT_IMPORTANCE = {
    "worlds": 3,
    "mixed": 1,  # default
}


def _event_importance(etype: str) -> int:
    return _EVENT_IMPORTANCE.get(etype, 1)


def _slug(s: str) -> str:
    s = s.replace("'", "").replace("\u2019", "")
    return re.sub(r"[^a-z0-9]+", "_", s.lower().strip()).strip("_")


# ---------------------------------------------------------------------------
# Detection rules
# ---------------------------------------------------------------------------

def detect_pbp_split_errors(pbp_path: Path) -> list[dict]:
    """Rule A+B: Scan PBP team entries for split parsing errors and missing partners."""
    anomalies = []

    with open(pbp_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("competitor_type") != "team":
                continue
            tdm = (row.get("team_display_name") or "").strip()
            if not tdm or tdm == "__NON_PERSON__":
                continue

            eid = row["event_id"]
            yr = row.get("year", "")
            div = row.get("division_canon", "")
            pl = row["place"]

            parts = [p.strip() for p in tdm.split(" / ") if p.strip()]

            # Rule B: Suspicious "/" splits — location fragments
            has_location_fragment = False
            for p in parts:
                p_clean = p.lower().rstrip(")").strip()
                if p_clean in _LOCATIONS or p_clean in _STATE_ABBREV:
                    has_location_fragment = True
                    break
                if re.match(r"^\w+,\s*(USA|Canada|France|Germany)", p, re.I):
                    has_location_fragment = True
                    break

            # Unbalanced parens = split through annotation
            open_count = tdm.count("(")
            close_count = tdm.count(")")
            unbalanced_parens = open_count != close_count

            if has_location_fragment or unbalanced_parens:
                anomalies.append({
                    "event_id": eid,
                    "year": yr,
                    "discipline": div,
                    "placement": pl,
                    "original_display": tdm,
                    "anomaly_type": "SPLIT_PARSING_ERROR",
                    "severity": "HIGH",
                    "suggested_action": "Strip location annotation, identify missing partner from source",
                    "notes": "",
                })
                continue

            # Rule A: Single name in doubles (no " / " or only one real name)
            if " / " not in tdm:
                # Could be "Name (Location)" with no partner
                if "(" in tdm:
                    anomalies.append({
                        "event_id": eid,
                        "year": yr,
                        "discipline": div,
                        "placement": pl,
                        "original_display": tdm,
                        "anomaly_type": "MISSING_PARTNER",
                        "severity": "HIGH",
                        "suggested_action": "Identify partner from source page",
                        "notes": "Single name with location — partner missing",
                    })

    return anomalies


def detect_canonical_anomalies(
    participants_path: Path,
    disciplines_path: Path,
) -> list[dict]:
    """Rule C+D+E: Scan canonical data for truncated names, single-participant doubles,
    and placement gaps."""
    anomalies = []

    # Load disciplines for team_type lookup
    disc_team_type: dict[tuple[str, str], str] = {}
    with open(disciplines_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            disc_team_type[(row["event_key"], row["discipline_key"])] = row.get("team_type", "")

    # Group participants by (event_key, discipline_key, placement)
    entries: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    with open(participants_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = (row["event_key"], row["discipline_key"], row["placement"])
            entries[key].append(row)

    for (ek, dk, pl), parts in entries.items():
        tt = disc_team_type.get((ek, dk), "")
        if tt != "doubles":
            continue

        yr = ek[:4] if ek[:4].isdigit() else ""

        # Rule: doubles entry with only 1 participant
        real_parts = [p for p in parts if p["display_name"].strip().lower() not in _SKIP_NAMES]
        unknown_parts = [p for p in parts if p["display_name"].strip().lower() in _SKIP_NAMES]

        if len(real_parts) == 1 and len(unknown_parts) >= 1:
            name = real_parts[0]["display_name"]
            anomalies.append({
                "event_id": ek,
                "year": yr,
                "discipline": dk,
                "placement": pl,
                "original_display": name,
                "anomaly_type": "MISSING_PARTNER",
                "severity": "MEDIUM",
                "suggested_action": "Identify partner from source or community",
                "notes": f"Partner is {unknown_parts[0]['display_name']}",
            })

        # Rule D: Truncated name in any doubles entry
        for p in real_parts:
            name = p["display_name"].strip()
            words = name.split()
            if len(words) == 1 and len(name) > 1 and name not in _SKIP_NAMES:
                anomalies.append({
                    "event_id": ek,
                    "year": yr,
                    "discipline": dk,
                    "placement": pl,
                    "original_display": name,
                    "anomaly_type": "TRUNCATED_NAME",
                    "severity": "MEDIUM",
                    "suggested_action": "Resolve to full name via event-local context or alias",
                    "notes": f"Single-token name in doubles: '{name}'",
                })

    return anomalies


def filter_pbp_false_positives(
    pbp_anomalies: list[dict],
    participants_path: Path,
    disciplines_path: Path,
    event_meta: dict[str, dict],
) -> list[dict]:
    """Remove PBP SPLIT_PARSING_ERROR anomalies where canonical data is already correct.

    A PBP entry may show 'Name (Location / State)' due to frozen identity lock display,
    but the canonical participant data may already have the correct name without the
    location artifact. Cross-check and suppress false positives.
    """
    # Load discipline team_type
    disc_team_type: dict[tuple[str, str], str] = {}
    with open(disciplines_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            disc_team_type[(row["event_key"], row["discipline_key"])] = row.get("team_type", "")

    # Load canonical participants grouped by (event_key, discipline_key, placement)
    # Store as list of (participant_order, display_name) tuples
    canon_parts: dict[tuple[str, str, str], list[tuple[str, str]]] = defaultdict(list)
    with open(participants_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row["display_name"].strip()
            order = row.get("participant_order", "1")
            key = (row["event_key"], row["discipline_key"], row["placement"])
            canon_parts[key].append((order, name))

    kept = []
    suppressed = 0
    for a in pbp_anomalies:
        if a["anomaly_type"] != "SPLIT_PARSING_ERROR":
            kept.append(a)
            continue

        # Resolve event_key from event_id (PBP uses legacy_event_id)
        eid = a["event_id"]
        ev = event_meta.get(eid, {})
        ek = ev.get("event_key", eid)

        # Normalize discipline to match canonical keys
        disc_slug = _slug(a["discipline"])

        # Find matching canonical discipline (exact slug, then prefix/substring fallback)
        matching_dk = None
        for (cek, cdk), tt in disc_team_type.items():
            if cek == ek and _slug(cdk) == disc_slug:
                matching_dk = cdk
                break
        if matching_dk is None:
            # Fallback: PBP slug might be a prefix of canonical key (e.g. "novice" → "novice_net")
            for (cek, cdk), tt in disc_team_type.items():
                if cek == ek and (_slug(cdk).startswith(disc_slug) or disc_slug.startswith(_slug(cdk))):
                    matching_dk = cdk
                    break

        if matching_dk is None:
            kept.append(a)
            continue

        tt = disc_team_type.get((ek, matching_dk), "")
        pl = a["placement"]
        parts = canon_parts.get((ek, matching_dk, pl), [])
        real_p1 = [name for order, name in parts
                   if order == "1" and name.strip().lower() not in _SKIP_NAMES]
        all_real = [name for _, name in parts if name.strip().lower() not in _SKIP_NAMES]

        # Singles with a real participant_order=1 → canonical is clean
        # (extra participant_order=2 from parser location splits are harmless artifacts)
        if tt == "singles" and len(real_p1) >= 1:
            suppressed += 1
            continue

        # Doubles with 2 real participants → canonical is clean
        if tt == "doubles" and len(all_real) == 2:
            suppressed += 1
            continue

        kept.append(a)

    if suppressed:
        print(f"  Suppressed {suppressed} PBP false positives (canonical data is clean)")

    return kept


def suggest_partners(anomalies: list[dict], participants_path: Path) -> None:
    """For MISSING_PARTNER anomalies, suggest likely partners based on
    co-occurrence patterns in other events."""

    # Build partnership frequency index
    partner_freq: dict[str, Counter] = defaultdict(Counter)

    by_entry: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    with open(participants_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row["display_name"].strip()
            if name.lower() in _SKIP_NAMES:
                continue
            key = (row["event_key"], row["discipline_key"], row["placement"])
            by_entry[key].append(name)

    for key, names in by_entry.items():
        if len(names) == 2:
            partner_freq[names[0]][names[1]] += 1
            partner_freq[names[1]][names[0]] += 1

    # Annotate anomalies with suggestions
    for a in anomalies:
        if a["anomaly_type"] != "MISSING_PARTNER":
            continue
        name = a["original_display"].split("(")[0].strip()  # strip location annotation
        if name in partner_freq:
            top = partner_freq[name].most_common(3)
            if top:
                suggestions = [f"{n} ({c}x)" for n, c in top]
                a["notes"] = (a["notes"] + "; " if a["notes"] else "") + \
                    f"Likely partners: {', '.join(suggestions)}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Detect team/participant anomalies")
    parser.add_argument("--severity", type=str, default=None,
                        help="Filter by severity: HIGH, MEDIUM, LOW")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit output rows")
    args = parser.parse_args()

    if not PBP_CSV.exists():
        print(f"ERROR: {PBP_CSV} not found")
        sys.exit(1)

    # Load event metadata for importance ranking
    event_meta: dict[str, dict] = {}
    if EVENTS_CSV.exists():
        with open(EVENTS_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                event_meta[row.get("legacy_event_id", "")] = row
                event_meta[row.get("event_key", "")] = row

    # Load existing corrections to exclude.
    # Normalize discipline keys for matching (PBP uses raw names, corrections use slugs).

    corrected: set[tuple[str, str, str]] = set()
    if CORRECTIONS_CSV.exists():
        with open(CORRECTIONS_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("active", "") == "1":
                    corrected.add((row["event_key"], _slug(row["discipline_key"]), row["placement"]))

    # Also exclude disciplines that have been retagged (e.g. doubles→singles)
    # These still appear as doubles in PBP but are corrected in canonical.
    DISC_FIXES = ROOT / "inputs" / "canonical_discipline_fixes.csv"
    retagged_discs: set[tuple[str, str]] = set()
    if DISC_FIXES.exists():
        with open(DISC_FIXES, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("active", "") == "1" and row.get("fix_type", "") == "retag_team_type":
                    retagged_discs.add((row["event_key"], _slug(row["discipline_key"])))

    # Detect anomalies
    print("Scanning PBP for split/missing errors...")
    pbp_anomalies = detect_pbp_split_errors(PBP_CSV)
    print(f"  Found: {len(pbp_anomalies)}")

    # Cross-check PBP anomalies against canonical — suppress false positives
    pbp_anomalies = filter_pbp_false_positives(
        pbp_anomalies, PARTICIPANTS_CSV, DISCIPLINES_CSV, event_meta,
    )

    print("Scanning canonical for doubles anomalies...")
    canon_anomalies = detect_canonical_anomalies(PARTICIPANTS_CSV, DISCIPLINES_CSV)
    print(f"  Found: {len(canon_anomalies)}")

    # Merge and deduplicate
    all_anomalies = pbp_anomalies + canon_anomalies

    # Enrich with event metadata
    for a in all_anomalies:
        eid = a["event_id"]
        ev = event_meta.get(eid, {})
        a["event_name"] = ev.get("event_name", "")
        a["event_key"] = ev.get("event_key", eid)
        a["event_type"] = ev.get("event_type", "")
        if not a.get("year"):
            a["year"] = ev.get("year", "")

    # Suggest partners for MISSING_PARTNER anomalies
    print("Generating partner suggestions...")
    suggest_partners(all_anomalies, PARTICIPANTS_CSV)

    # Remove already-corrected
    before = len(all_anomalies)
    all_anomalies = [
        a for a in all_anomalies
        if (a.get("event_key", ""), _slug(a["discipline"]), a["placement"]) not in corrected
        and (a.get("event_key", ""), _slug(a["discipline"])) not in retagged_discs
    ]
    print(f"  Excluded {before - len(all_anomalies)} already-corrected entries")

    # Filter by severity
    if args.severity:
        all_anomalies = [a for a in all_anomalies if a["severity"] == args.severity]

    # Sort: severity (HIGH first), then event importance, then year desc
    severity_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    all_anomalies.sort(key=lambda a: (
        severity_order.get(a["severity"], 9),
        -_event_importance(a.get("event_type", "")),
        -(int(a.get("year") or "0")),
        a.get("event_key", ""),
        a["discipline"],
        int(a["placement"]),
    ))

    if args.limit:
        all_anomalies = all_anomalies[:args.limit]

    # Write CSV
    fieldnames = [
        "event_key", "event_name", "year", "discipline", "placement",
        "original_display", "anomaly_type", "severity",
        "suggested_action", "notes",
    ]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_anomalies)

    # Print summary
    sep = "=" * 72
    print()
    print(sep)
    print("  TEAM ANOMALY WORKLIST")
    print(sep)
    print()

    type_counts = Counter(a["anomaly_type"] for a in all_anomalies)
    sev_counts = Counter(a["severity"] for a in all_anomalies)

    print(f"Total anomalies: {len(all_anomalies)}")
    print()
    print("By severity:")
    for sev in ["HIGH", "MEDIUM", "LOW"]:
        print(f"  {sev}: {sev_counts.get(sev, 0)}")
    print()
    print("By type:")
    for typ, count in type_counts.most_common():
        print(f"  {typ}: {count}")
    print()

    # Top events
    event_counts = Counter(a.get("event_key", "") for a in all_anomalies)
    print("Top events by anomaly count:")
    for ek, count in event_counts.most_common(15):
        yr = next((a.get("year", "") for a in all_anomalies if a.get("event_key") == ek), "")
        ename = next((a.get("event_name", "") for a in all_anomalies if a.get("event_key") == ek), "")
        print(f"  ({count:>3}) {yr} {ename}")
    print()

    # Sample HIGH severity
    high = [a for a in all_anomalies if a["severity"] == "HIGH"]
    if high:
        print("Sample HIGH severity anomalies:")
        for a in high[:10]:
            print(f"  {a.get('year','')} {a.get('event_key','')} | P{a['placement']} {a['discipline']}")
            print(f"    \"{a['original_display']}\" [{a['anomaly_type']}]")
            if a.get("notes"):
                print(f"    {a['notes']}")
        print()

    print(f"Output: {OUT_CSV}")
    print(sep)


if __name__ == "__main__":
    main()
