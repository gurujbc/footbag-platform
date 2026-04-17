#!/usr/bin/env python3
"""
09_load_enrichment_to_sqlite.py

Loads legacy enrichment pipeline outputs into the footbag platform SQLite DB.
Must run AFTER 08_load_mvfp_seed_full_to_sqlite.py (canonical data already present).

Inputs (paths relative to legacy_data/ unless absolute):
  persons/out/persons_master.csv
  clubs/out/legacy_club_candidates.csv
  clubs/out/legacy_person_club_affiliations.csv

Loads:
  1. historical_persons       — provisional persons (person_type = PROVISIONAL)
  2. legacy_club_candidates   — all 311 mirror-derived club candidates
  3. legacy_person_club_affiliations — scored person→club affiliation graph

Deferred (not loaded here):
  club_bootstrap_leaders — requires live clubs rows (FK NOT NULL to clubs.id).
  Clubs are publicly accessible at /clubs. Creating them is a deliberate next step.

Usage:
  python event_results/scripts/09_load_enrichment_to_sqlite.py \\
    --db path/to/footbag.db \\
    --persons-csv persons/out/persons_master.csv \\
    --candidates-csv clubs/out/legacy_club_candidates.csv \\
    --affiliations-csv clubs/out/legacy_person_club_affiliations.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Utilities (mirror script 08 style)
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stable_id(prefix: str, *parts: str) -> str:
    raw = "||".join(str(p) for p in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return [{k: (v if v is not None else "") for k, v in row.items()} for row in reader]


def opt_int(val: str) -> int | None:
    v = val.strip()
    if not v:
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def opt_float(val: str) -> float | None:
    v = val.strip()
    if not v:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def opt_str(val: str) -> str | None:
    v = val.strip()
    return v if v else None


def parse_bool_col(value: str) -> int:
    v = value.strip().lower()
    if v in ("", "n", "0", "false"):
        return 0
    if v in ("y", "1", "true"):
        return 1
    raise ValueError(f"Unrecognised boolean value: {value!r}")


def normalize_role(role: str) -> str:
    """Normalise CSV role values to DB CHECK values (co_leader → co-leader)."""
    return role.strip().replace("_", "-")


import re as _re
import unicodedata as _unicodedata

# ── Person-likeness gate (mirrors export_canonical_platform.py step 5b) ───────
_PL_MOJIBAKE     = _re.compile(r"[¶¦±¼¿¸¹º³]")
_PL_EMBED_Q      = _re.compile(r"\w\?|\?\w")
_PL_STANDALONE_Q = _re.compile(r"(?:^|\s)\?{1,5}(?:\s|$)")
_PL_BAD_CHARS    = _re.compile(r"[+=\\|/]")
_PL_SCOREBOARD   = _re.compile(r"^[A-Z]{2}\s+\d+$")
_PL_PRIZE        = _re.compile(r"\$\d+")
_PL_MATCH_RESULT = _re.compile(r"\d+-\d+\s+over\b", _re.IGNORECASE)
_PL_BIG_NUMBER   = _re.compile(r"\b\d{3,}\b")
_PL_NON_PERSON   = _re.compile(
    r"\b(Connection|Dimension|Footbag|Spikehammer|head-to-head|"
    r"being determined|Freestyler|round robin|results|"
    r"Champions|Foot Clan|"
    r"whirlygig|whirlwind|spinning|blender|smear|"
    r"clipper|torque|butterfly|mirage|legbeater|ducking|"
    r"eggbeater|ripwalk|hopover|dropless|scorpion|matador|"
    r"symposium|swirl|drifter|vortex|superfly|"
    r"atomic|blurry|whirl|flux|dimwalk|nemesis|bedwetter|"
    r"pixie|rooted|sailing|diving|ripped|warrior|"
    r"paradon|steping|pdx|mullet|"
    r"Big Add Posse|Aerial Zone|Annual Mountain|Be Announced|"
    r"depending|highest.placed|two footbags)\b",
    _re.IGNORECASE,
)
_PL_ALL_CAPS     = _re.compile(r"^[A-Z]{2,}[\s-]+[A-Z]{2,}(?:[\s-]+[A-Z]{2,})*$")
_PL_TRAILING_JUNK = _re.compile(r"[*]+$")
_PL_ABBREVIATED  = _re.compile(r"^[A-Z]\.?\s+\S")
_PL_INCOMPLETE   = _re.compile(r"^\S+\s+[A-Z]$")
_PL_INITIALS     = _re.compile(r"^[A-Z]\.\s+[A-Z]\.$")
_PL_PRIZE_SUFFIX = _re.compile(r"-prizes\b|\bprize\b", _re.IGNORECASE)
_PL_TRICK_ARROW  = _re.compile(r"[>]|\s:\s")
_PL_LONG_TOKEN   = _re.compile(r"\S{21,}")


def _norm_name(name: str) -> str:
    """Strip diacritics, lowercase, collapse whitespace, remove periods."""
    nfkd = _unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in nfkd if not _unicodedata.combining(c))
    s = stripped.lower().strip().replace(".", "")
    return _re.sub(r"\s+", " ", s)


def _aggressive_norm(name: str) -> str:
    """Drop middle names/initials — keep first + last word only."""
    s = _norm_name(name)
    parts = s.split()
    if len(parts) > 2:
        return f"{parts[0]} {parts[-1]}"
    return s


def _is_person_like(name: str) -> bool:
    """Return False if name is clearly not a canonical person name."""
    s = name.strip()
    if not s:                      return False
    if _PL_MOJIBAKE.search(s):     return False
    if _PL_EMBED_Q.search(s):      return False
    if _PL_STANDALONE_Q.search(s): return False
    if _PL_BAD_CHARS.search(s):    return False
    if _PL_SCOREBOARD.match(s):    return False
    if _PL_PRIZE.search(s):        return False
    if _PL_MATCH_RESULT.search(s): return False
    if _PL_BIG_NUMBER.search(s):   return False
    if _PL_NON_PERSON.search(s):   return False
    if "," in s:                   return False
    if _PL_ALL_CAPS.match(s):      return False
    if _PL_TRAILING_JUNK.search(s) and len(s.split()) >= 2: return False
    if " " not in s and "." not in s: return False
    if _PL_ABBREVIATED.match(s):   return False
    if _PL_INCOMPLETE.match(s):    return False
    if _PL_INITIALS.match(s):      return False
    if _PL_PRIZE_SUFFIX.search(s): return False
    if _PL_TRICK_ARROW.search(s):  return False
    if _PL_LONG_TOKEN.search(s):   return False
    if s[0].islower():             return False
    if _re.search(r"\bThe\b", s):  return False
    if '"' in s:                   return False
    if " or " in s.lower():       return False
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Load enrichment CSVs into footbag SQLite DB")
    parser.add_argument("--db", required=True, help="Path to footbag.db")
    parser.add_argument("--persons-csv",      required=True)
    parser.add_argument("--candidates-csv",   required=True)
    parser.add_argument("--affiliations-csv", required=True)
    args = parser.parse_args()

    db_path          = Path(args.db)
    persons_csv      = Path(args.persons_csv)
    candidates_csv   = Path(args.candidates_csv)
    affiliations_csv = Path(args.affiliations_csv)

    for p in [db_path, persons_csv, candidates_csv, affiliations_csv]:
        if not p.exists():
            raise FileNotFoundError(f"Required file not found: {p}")

    ts          = now_iso()
    system_user = "system:enrichment_seed"

    persons_rows      = read_csv(persons_csv)
    candidates_rows   = read_csv(candidates_csv)
    affiliations_rows = read_csv(affiliations_csv)

    print(f"Persons master:       {len(persons_rows):,} rows")
    print(f"Club candidates:      {len(candidates_rows):,} rows")
    print(f"Person affiliations:  {len(affiliations_rows):,} rows")

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")

        # ------------------------------------------------------------------
        # Step 1 — Provisional persons → historical_persons
        # ------------------------------------------------------------------
        print("\nLoading provisional persons → historical_persons...")

        # Build normalized-name index of canonical persons already in DB
        # so we can skip provisional persons that duplicate them.
        _existing_rows = conn.execute(
            "SELECT person_name FROM historical_persons"
        ).fetchall()
        _existing_norm: set[str] = set()
        _existing_aggressive: set[str] = set()
        for (pn,) in _existing_rows:
            if pn:
                _existing_norm.add(_norm_name(pn))
                _existing_aggressive.add(_aggressive_norm(pn))

        provisional_raw = [r for r in persons_rows if r.get("person_type", "") == "PROVISIONAL"]
        # Filter out encoding-corrupted / non-person-like names
        # and names that duplicate an existing canonical person.
        persons_qc_skipped = 0
        persons_dedup_skipped = 0
        provisional = []
        for r in provisional_raw:
            pn = r.get("person_name", "").strip()
            if not _is_person_like(pn):
                persons_qc_skipped += 1
                continue
            if _norm_name(pn) in _existing_norm or _aggressive_norm(pn) in _existing_aggressive:
                persons_dedup_skipped += 1
                continue
            provisional.append(r)
        print(f"  PROVISIONAL rows: {len(provisional):,} (CANONICAL rows skipped — already loaded by script 08)")
        if persons_qc_skipped:
            print(f"  QC filter: {persons_qc_skipped} non-person-like name(s) skipped")
        if persons_dedup_skipped:
            print(f"  Dedup filter: {persons_dedup_skipped} duplicate(s) of existing canonical persons skipped")

        persons_inserted = 0
        persons_skipped  = 0

        for row in provisional:
            pid = row["master_person_id"].strip()
            if not pid:
                persons_skipped += 1
                continue

            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO historical_persons (
                      person_id, person_name, legacy_member_id,
                      country, first_year, last_year,
                      bap_member, bap_nickname, bap_induction_year,
                      hof_member, hof_induction_year,
                      source, source_scope
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        pid,
                        row["person_name"].strip(),
                        opt_str(row.get("legacy_member_id", "")),
                        opt_str(row.get("country", "")),
                        opt_int(row.get("first_year", "")),
                        opt_int(row.get("last_year", "")),
                        parse_bool_col(row.get("bap_member", "0")),
                        opt_str(row.get("bap_nickname", "")),
                        opt_int(row.get("bap_induction_year", "")),
                        parse_bool_col(row.get("hof_member", "0")),
                        opt_int(row.get("hof_induction_year", "")),
                        opt_str(row.get("source_types", "")),
                        row.get("person_type", "PROVISIONAL").strip(),
                    ),
                )
                persons_inserted += 1
            except sqlite3.IntegrityError as e:
                print(f"  WARN: person {pid!r} skipped — {e}")
                persons_skipped += 1

        print(f"  Inserted: {persons_inserted:,}  Skipped/duplicate: {persons_skipped:,}")

        # ------------------------------------------------------------------
        # Step 2 — Legacy club candidates → legacy_club_candidates
        # ------------------------------------------------------------------
        print("\nLoading club candidates → legacy_club_candidates...")

        # Build key → id map for use in step 3
        candidate_id_map: dict[str, str] = {}

        candidates_inserted = 0
        candidates_skipped  = 0

        for row in candidates_rows:
            club_key = row["club_key"].strip()
            if not club_key:
                candidates_skipped += 1
                continue

            lcc_id = stable_id("lcc", club_key)
            candidate_id_map[club_key] = lcc_id

            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO legacy_club_candidates (
                      id, created_at, created_by, updated_at, updated_by, version,
                      legacy_club_key, display_name, city, country,
                      confidence_score, mapped_club_id, bootstrap_eligible
                    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, ?)
                    """,
                    (
                        lcc_id, ts, system_user, ts, system_user,
                        club_key,
                        row["name"].strip(),
                        opt_str(row.get("city", "")),
                        opt_str(row.get("country", "")),
                        opt_float(row.get("confidence_score", "")),
                        parse_bool_col(row.get("bootstrap_eligible", "0")),
                    ),
                )
                candidates_inserted += 1
            except sqlite3.IntegrityError as e:
                print(f"  WARN: candidate {club_key!r} skipped — {e}")
                candidates_skipped += 1

        print(f"  Inserted: {candidates_inserted:,}  Skipped/duplicate: {candidates_skipped:,}")

        # ------------------------------------------------------------------
        # Step 3 — Person-club affiliations → legacy_person_club_affiliations
        # ------------------------------------------------------------------
        print("\nLoading affiliations → legacy_person_club_affiliations...")

        affiliations_inserted  = 0
        affiliations_skipped   = 0
        affiliations_fk_miss   = 0
        affiliations_pid_fallback = 0

        # Pre-load all person_ids present in historical_persons (CANONICAL already
        # loaded by script 08; PROVISIONAL just loaded above).  Matched person IDs
        # that reference membership-only provisional IDs not yet loaded (e.g.
        # membership_only::*) will be treated as unmatched — use legacy_member_id only.
        known_person_ids: set[str] = {
            row[0]
            for row in conn.execute("SELECT person_id FROM historical_persons").fetchall()
        }

        for row in affiliations_rows:
            club_key       = row["club_key"].strip()
            mirror_id      = row.get("mirror_member_id", "").strip()
            matched_pid    = row.get("matched_person_id", "").strip()
            display_name   = row.get("display_name", "").strip()
            inferred_role  = normalize_role(row.get("inferred_role", "member"))
            conf           = opt_float(row.get("affiliation_confidence_score", ""))

            lcc_id = candidate_id_map.get(club_key)
            if not lcc_id:
                affiliations_fk_miss += 1
                continue

            # If matched_person_id is not present in historical_persons, fall back
            # to legacy_member_id only (avoids FK violation for membership_only:: IDs).
            if matched_pid and matched_pid not in known_person_ids:
                affiliations_pid_fallback += 1
                matched_pid = ""

            # At least one of historical_person_id or legacy_member_id must be set
            historical_pid = matched_pid if matched_pid else None
            legacy_mid     = mirror_id   if mirror_id   else None

            if historical_pid is None and legacy_mid is None:
                affiliations_skipped += 1
                continue

            # Stable deterministic ID: keyed on club + member/person + role
            lpca_key = matched_pid or mirror_id
            lpca_id  = stable_id("lpca", club_key, lpca_key, inferred_role)

            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO legacy_person_club_affiliations (
                      id, created_at, created_by, updated_at, updated_by, version,
                      historical_person_id, legacy_member_id,
                      legacy_club_candidate_id, inferred_role,
                      confidence_score, resolution_status,
                      display_name
                    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        lpca_id, ts, system_user, ts, system_user,
                        historical_pid,
                        legacy_mid,
                        lcc_id,
                        inferred_role,
                        conf,
                        opt_str(display_name),
                    ),
                )
                affiliations_inserted += 1
            except sqlite3.IntegrityError as e:
                print(f"  WARN: affiliation {lpca_id!r} skipped — {e}")
                affiliations_skipped += 1

        print(f"  Inserted: {affiliations_inserted:,}  "
              f"Skipped/duplicate: {affiliations_skipped:,}  "
              f"Missing candidate FK: {affiliations_fk_miss:,}  "
              f"PID fallback (unloaded provisional): {affiliations_pid_fallback:,}")

        conn.commit()

        # ------------------------------------------------------------------
        # Row counts
        # ------------------------------------------------------------------
        print("\nDatabase row counts (enrichment tables):")
        for table in [
            "historical_persons",
            "legacy_club_candidates",
            "legacy_person_club_affiliations",
        ]:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count:,}")

        provisional_count = conn.execute(
            "SELECT COUNT(*) FROM historical_persons WHERE source_scope = 'PROVISIONAL'"
        ).fetchone()[0]
        print(f"  historical_persons (PROVISIONAL only): {provisional_count:,}")

    print("\nNote: club_bootstrap_leaders not loaded.")
    print("      Requires live clubs rows (FK NOT NULL). Next step: create clubs from")
    print("      bootstrap-eligible candidates, then load bootstrap leaders.")
    print("\nDone.")


if __name__ == "__main__":
    main()
