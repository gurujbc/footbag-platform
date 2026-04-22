"""
QC: alias-duplicate persons detector.

Permanent regression check for the identity pipeline. Loads canonical
persons from either a CSV or a SQLite DB table plus the shared
AliasResolver, and asserts the invariant:

    For every alias whose target person_id exists in the canonical
    persons source, no OTHER person row has a normalized name matching
    that alias.

If a violation is found it means the upstream pipeline emitted a stub or
duplicate person row for a name that should have been alias-resolved to the
canonical person. This is the regression class fixed by the alias-aware
patch in event_results/scripts/07_build_mvfp_seed_full.py — this check
ensures no future change reintroduces it.

Two sources are supported:

    --source db   (default in footbag-platform)
                  reads historical_persons from --db (SQLite)
    --source csv  (used by the canonical-CSV gate in run_qc.py; also
                  the native mode for FOOTBAG_DATA, which is CSV-only)
                  reads legacy_data/out/canonical/persons.csv (or --persons-csv)

Aliases always come from overrides/person_aliases.csv (or --aliases-csv).

Writes: legacy_data/out/alias_duplicate_persons.csv (or --out).

Exit codes:
    0 — no violations (or --warn-only)
    1 — violations found (use as a hard QC gate by default)
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_ROOT = SCRIPT_DIR.parents[1]  # qc/ → pipeline/ → legacy_data/
REPO_ROOT = LEGACY_ROOT.parent

# Make pipeline.identity importable when this script is run directly.
sys.path.insert(0, str(LEGACY_ROOT))
from pipeline.identity.alias_resolver import AliasResolver, normalize_name  # noqa: E402


DEFAULT_PERSONS_CSV = LEGACY_ROOT / "out" / "canonical" / "persons.csv"
DEFAULT_ALIASES_CSV = LEGACY_ROOT / "overrides" / "person_aliases.csv"
DEFAULT_OUT = LEGACY_ROOT / "out" / "alias_duplicate_persons.csv"
DEFAULT_DB = REPO_ROOT / "database" / "footbag.db"


def _load_persons_csv(persons_csv: Path) -> list[tuple[str, str]]:
    """Return (person_id, person_name) pairs from the canonical persons CSV.

    Accepts either `person_name` or `person_canon` as the name column so this
    works against both post-05p5 canonical output and the identity-lock
    Persons_Truth_Final_vN.csv files.
    """
    if not persons_csv.exists():
        raise FileNotFoundError(f"Persons CSV not found: {persons_csv}")
    rows: list[tuple[str, str]] = []
    with persons_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            pid = (r.get("person_id") or "").strip()
            name = (r.get("person_name") or r.get("person_canon") or r.get("name") or "").strip()
            if pid and name:
                rows.append((pid, name))
    return rows


def _load_persons_db(db_path: Path) -> list[tuple[str, str]]:
    """Return (person_id, person_name) pairs from historical_persons in SQLite."""
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite DB not found: {db_path}")
    try:
        import pysqlite3 as sqlite3  # type: ignore[import-not-found]
    except ImportError:
        import sqlite3  # type: ignore[no-redef]
    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            "SELECT person_id, person_name FROM historical_persons "
            "WHERE person_name IS NOT NULL"
        ).fetchall()
    finally:
        conn.close()
    return [(pid, name) for pid, name in rows if pid and name]


def find_violations(
    pairs: list[tuple[str, str]],
    aliases_csv: Path,
) -> list[dict]:
    """Given (person_id, person_name) pairs, flag alias-duplicate persons.

    Source-agnostic: the caller loads `pairs` from CSV or DB.
    """
    resolver = AliasResolver(aliases_csv=aliases_csv, canonical_persons=pairs)

    by_norm: dict[str, list[tuple[str, str]]] = {}
    for pid, name in pairs:
        by_norm.setdefault(normalize_name(name), []).append((pid, name))

    violations: list[dict] = []
    if not aliases_csv.exists():
        return violations

    seen_alias_keys: set[str] = set()
    with aliases_csv.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            alias_raw = (row.get("alias") or "").strip()
            if not alias_raw:
                continue
            alias_norm = normalize_name(alias_raw)
            if alias_norm in seen_alias_keys:
                continue
            seen_alias_keys.add(alias_norm)

            expected_pid = resolver.resolve(alias_raw)
            if not expected_pid:
                # Alias can't resolve (stale target); handled by the retarget
                # data-fix task, not this duplicate-detection check.
                continue

            for matched_pid, matched_name in by_norm.get(alias_norm, []):
                if matched_pid == expected_pid:
                    continue
                violations.append({
                    "alias": alias_raw,
                    "alias_norm": alias_norm,
                    "expected_pid": expected_pid,
                    "expected_name": resolver.canonical_name(expected_pid),
                    "duplicate_pid": matched_pid,
                    "duplicate_name": matched_name,
                })

    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description="QC: alias-duplicate persons detector")
    parser.add_argument("--source", choices=["csv", "db"], default="db",
                        help="Persons source: 'db' (default; SQLite historical_persons) or 'csv'")
    parser.add_argument("--persons-csv", default=str(DEFAULT_PERSONS_CSV),
                        help="Canonical persons CSV (used when --source csv)")
    parser.add_argument("--db", default=str(DEFAULT_DB),
                        help="SQLite DB path (used when --source db)")
    parser.add_argument("--aliases-csv", default=str(DEFAULT_ALIASES_CSV))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--warn-only", action="store_true",
                        help="Always exit 0 even when violations are found")
    args = parser.parse_args()

    aliases_csv = Path(args.aliases_csv)

    if args.source == "csv":
        persons_csv = Path(args.persons_csv)
        pairs = _load_persons_csv(persons_csv)
        source_label = f"csv:{persons_csv}"
    else:
        db_path = Path(args.db)
        pairs = _load_persons_db(db_path)
        source_label = f"db:{db_path}"

    violations = find_violations(pairs, aliases_csv)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "alias", "alias_norm", "expected_pid", "expected_name",
                "duplicate_pid", "duplicate_name",
            ],
        )
        writer.writeheader()
        writer.writerows(violations)

    print(f"alias-duplicate persons report → {out_path}")
    print(f"  source: {source_label}")
    print(f"  persons loaded: {len(pairs)}")
    print(f"  violations: {len(violations)}")
    if violations:
        for v in violations[:10]:
            print(f"    alias='{v['alias']}' expected_pid={v['expected_pid'][:8]}... "
                  f"({v['expected_name']}) duplicate_pid={v['duplicate_pid'][:8]}... "
                  f"({v['duplicate_name']})")
        if len(violations) > 10:
            print(f"    ... and {len(violations) - 10} more (see {out_path})")

    if violations and not args.warn_only:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
