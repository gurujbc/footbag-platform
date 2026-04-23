#!/usr/bin/env python3
"""Seed the `name_variants` table from `inputs/name_variants.csv`.

Draft loader — not yet wired into `run_pipeline.sh`. See
`pipeline/identity/README.md` for the policy summary.

## Policy

The CSV carries a `confidence` column the DB schema does not model. This
loader enforces the confidence contract at load time:

  - **high**-confidence rows are production-eligible and written to
    `name_variants` with `source='mirror_mined'`.
  - **medium**-confidence rows are reported to a staging artifact and
    NOT inserted. They do not participate in registration-time
    auto-linking yet; they are visible for human review.

The `source` tags in the CSV (`alias`, `display_name`, `bap`, `manual`)
describe provenance within the pipeline. They all derive from the
legacy mirror and collapse to DB `source='mirror_mined'`. Future
`admin_added` / `member_submitted` rows will arrive via application
code paths, not this loader.

## DB-side normalization

`name_variants` stores pre-normalized forms:

    NFKC(name).lower().strip() with internal whitespace collapsed.

NFKC preserves diacritics (á → á), so ASCII-folded variants (`Alex
Martinez`) and diacritic canonicals (`Alex Martínez`) produce distinct
normalized rows and can coexist.

Rows whose canonical and variant collapse to the same normalized form
(pure case/whitespace differences) are dropped — the DB CHECK
constraint would reject them anyway.

## Idempotency

`INSERT OR IGNORE` with PK `(canonical_normalized, variant_normalized)`.
Safe to re-run.

## Dry run vs apply

Default is dry-run: summary to stdout, staging artifacts written, DB
untouched. Pass `--apply` with `--db <path>` to actually insert.

## Artifacts

  out/name_variants_production.csv   (HIGH rows in DB format; would-insert)
  out/name_variants_deferred.csv     (MEDIUM rows; for human review)

## Usage

    python legacy_data/scripts/load_name_variants_seed.py           # dry-run
    python legacy_data/scripts/load_name_variants_seed.py --apply --db /path/to/footbag.db
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

try:
    import pysqlite3 as sqlite3  # type: ignore
except ImportError:
    import sqlite3  # type: ignore

SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_ROOT = SCRIPT_DIR.parent

DEFAULT_INPUT_CSV    = LEGACY_ROOT / "inputs" / "name_variants.csv"
DEFAULT_PROD_ARTIFACT = LEGACY_ROOT / "out" / "name_variants_production.csv"
DEFAULT_DEFERRED_ARTIFACT = LEGACY_ROOT / "out" / "name_variants_deferred.csv"

DB_SOURCE_TAG = "mirror_mined"

INPUT_FIELDS = {"variant_name", "canonical_name", "confidence", "source"}
VALID_CONFIDENCE = {"high", "medium"}
VALID_SOURCE = {"alias", "display_name", "bap", "manual"}


def db_normalize(s: str) -> str:
    """NFKC + lowercase + collapse whitespace + trim. Matches the
    application-side contract documented on `name_variants` in schema.sql."""
    s = unicodedata.normalize("NFKC", s or "")
    s = s.lower().strip()
    return " ".join(s.split())


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        missing = INPUT_FIELDS - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"ERROR: {path} missing columns: {sorted(missing)}")
        return list(reader)


def classify_rows(rows: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Split CSV rows into:
      - production: HIGH, valid, distinct normalized forms
      - deferred:   MEDIUM, valid
      - rejected:   anything that would fail DB CHECKs or has bad shape
    """
    production: list[dict] = []
    deferred:   list[dict] = []
    rejected:   list[dict] = []

    for r in rows:
        conf   = (r.get("confidence") or "").strip().lower()
        src    = (r.get("source") or "").strip().lower()
        variant   = r.get("variant_name") or ""
        canonical = r.get("canonical_name") or ""

        if conf not in VALID_CONFIDENCE:
            rejected.append({**r, "_reject_reason": f"confidence not in {sorted(VALID_CONFIDENCE)}"})
            continue
        if src not in VALID_SOURCE:
            rejected.append({**r, "_reject_reason": f"source not in {sorted(VALID_SOURCE)}"})
            continue

        v_norm = db_normalize(variant)
        c_norm = db_normalize(canonical)
        if not v_norm or not c_norm:
            rejected.append({**r, "_reject_reason": "empty normalized form"})
            continue
        if v_norm == c_norm:
            rejected.append({**r, "_reject_reason": "normalized forms identical (DB CHECK would fail)"})
            continue

        enriched = {
            **r,
            "canonical_normalized": c_norm,
            "variant_normalized":   v_norm,
        }
        if conf == "high":
            production.append(enriched)
        else:
            deferred.append(enriched)

    return production, deferred, rejected


def write_artifact(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def apply_to_db(db_path: Path, production: list[dict]) -> tuple[int, int]:
    """Insert production rows. Returns (inserted, skipped_existing)."""
    if not db_path.exists():
        raise SystemExit(f"ERROR: DB does not exist: {db_path}")
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        cur = conn.cursor()
        inserted = 0
        skipped  = 0
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        for r in production:
            before = conn.total_changes
            cur.execute(
                """
                INSERT OR IGNORE INTO name_variants
                    (canonical_normalized, variant_normalized, source, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (r["canonical_normalized"], r["variant_normalized"], DB_SOURCE_TAG, now),
            )
            if conn.total_changes > before:
                inserted += 1
            else:
                skipped += 1
        conn.commit()
        return inserted, skipped
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT_CSV)
    ap.add_argument("--production-artifact", type=Path, default=DEFAULT_PROD_ARTIFACT)
    ap.add_argument("--deferred-artifact",   type=Path, default=DEFAULT_DEFERRED_ARTIFACT)
    ap.add_argument("--db",    type=Path, default=None,
                    help="Path to footbag.db (only required with --apply).")
    ap.add_argument("--apply", action="store_true",
                    help="Actually insert HIGH rows into the DB. Default is dry-run.")
    args = ap.parse_args()

    rows = read_csv(args.input)
    production, deferred, rejected = classify_rows(rows)

    print(f"Input: {args.input}", file=sys.stderr)
    print(f"  total rows:  {len(rows)}", file=sys.stderr)
    print(f"  production:  {len(production)}  (HIGH, eligible for DB insert)", file=sys.stderr)
    print(f"  deferred:    {len(deferred)}  (MEDIUM, reported only)", file=sys.stderr)
    print(f"  rejected:    {len(rejected)}", file=sys.stderr)

    # Always emit artifacts — this is the "visible/reported" mechanism for
    # MEDIUM rows and a would-insert record for HIGH rows.
    write_artifact(args.production_artifact, production,
                   ["canonical_normalized", "variant_normalized",
                    "canonical_name", "variant_name", "source"])
    write_artifact(args.deferred_artifact, deferred,
                   ["canonical_normalized", "variant_normalized",
                    "canonical_name", "variant_name", "source", "confidence"])
    print(f"  wrote {args.production_artifact}", file=sys.stderr)
    print(f"  wrote {args.deferred_artifact}", file=sys.stderr)

    if rejected:
        print(f"\n  rejected sample (first 5):", file=sys.stderr)
        for r in rejected[:5]:
            print(f"    {r.get('variant_name')!r} -> {r.get('canonical_name')!r}  "
                  f"[{r.get('_reject_reason')}]", file=sys.stderr)

    if not args.apply:
        print("\nDry-run only. Pass --apply --db <path> to insert HIGH rows.", file=sys.stderr)
        return 0

    if args.db is None:
        print("ERROR: --apply requires --db", file=sys.stderr)
        return 2

    inserted, skipped = apply_to_db(args.db, production)
    print(f"\nApplied to {args.db}:", file=sys.stderr)
    print(f"  inserted: {inserted}", file=sys.stderr)
    print(f"  skipped:  {skipped}  (already present)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
