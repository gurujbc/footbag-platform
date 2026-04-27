"""
Script 20: Overlay footbag.org provenance onto the trick dictionary.

Reads:
  legacy_data/out/scraped_footbag_moves.csv  (256 scraped rows)

Writes: database/footbag.db
  - freestyle_trick_sources       (UPSERT 'footbag-org-2026-04')
  - freestyle_trick_source_links  (DELETE + INSERT scoped to source_id='footbag-org-2026-04')

Behavior: for each scraped row, try to resolve to an existing canonical trick by:
  1. source_name == freestyle_tricks.canonical_name (case-insensitive)
  2. alt_name == freestyle_tricks.canonical_name
  3. source_name OR alt_name matches freestyle_trick_aliases.alias_text / alias_slug

If matched, insert one freestyle_trick_source_links row carrying:
  external_ref       = showmove_id
  external_url       = source_url
  asserted_adds      = scraped add_value, NULL when it agrees with canonical
  asserted_notation  = scraped notation,  NULL when it agrees with canonical

If NOT matched: skip (this overlay does NOT add new tricks; new tricks wait for
Red's second-pass review).

Pipeline ordering: must run AFTER scripts 17 and 19 (canonical dictionary must
exist). Re-running 17 or 19 wipes nothing in this loader's scope; re-run 20 only
when the scraped CSV changes.

Run from legacy_data/ with the venv active:
    python event_results/scripts/20_link_footbag_org_sources.py [--db <path>]
"""

import argparse
import csv
import re
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parents[3]
SCRAPED_CSV = SCRIPT_DIR.parents[1] / "out" / "scraped_footbag_moves.csv"

FOOTBAG_ORG_SOURCE_ID = "footbag-org-2026-04"
FOOTBAG_ORG_RETRIEVED_AT = "2026-04-15T00:00:00.000Z"


def trick_name_to_slug(name: str) -> str:
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def upsert_footbag_source(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO freestyle_trick_sources (id, source_type, source_label, source_url, retrieved_at, notes)
        VALUES (:id, :source_type, :source_label, :source_url, :retrieved_at, :notes)
        ON CONFLICT(id) DO UPDATE SET
          source_type=excluded.source_type,
          source_label=excluded.source_label,
          source_url=excluded.source_url,
          retrieved_at=excluded.retrieved_at,
          notes=excluded.notes
        """,
        {
            "id": FOOTBAG_ORG_SOURCE_ID,
            "source_type": "scraped",
            "source_label": "footbag.org /newmoves/list scrape (April 2026)",
            "source_url": "http://www.footbag.org/newmoves/list/1-7",
            "retrieved_at": FOOTBAG_ORG_RETRIEVED_AT,
            "notes": "256 scraped rows. This loader links only exact and alias matches; ambiguous and new tricks are deferred to Red's second-pass review.",
        },
    )


def build_resolver(conn: sqlite3.Connection) -> dict[str, str]:
    """Build a normalized-name → trick_slug map for resolution.

    Index includes:
      - canonical_name (lowercased, slug form)
      - every alias_text and alias_slug
    """
    resolver: dict[str, str] = {}

    for slug, canonical_name in conn.execute(
        "SELECT slug, canonical_name FROM freestyle_tricks WHERE is_active = 1"
    ):
        resolver.setdefault(canonical_name.strip().lower(), slug)
        resolver.setdefault(trick_name_to_slug(canonical_name), slug)

    for alias_slug, alias_text, trick_slug in conn.execute(
        "SELECT alias_slug, alias_text, trick_slug FROM freestyle_trick_aliases"
    ):
        # only set if not already pointing somewhere — canonical wins on collision
        resolver.setdefault(alias_text.strip().lower(), trick_slug)
        resolver.setdefault(alias_slug, trick_slug)

    return resolver


def resolve_scraped_row(row: dict, resolver: dict[str, str]) -> str | None:
    """Try source_name first, then alt_name. Returns trick_slug or None."""
    for field in ("source_name", "alt_name"):
        raw = (row.get(field) or "").strip()
        if not raw:
            continue
        # Try lowercased canonical text, then slug form
        if raw.lower() in resolver:
            return resolver[raw.lower()]
        slug = trick_name_to_slug(raw)
        if slug and slug in resolver:
            return resolver[slug]
    return None


def overlay_footbag_sources(conn: sqlite3.Connection, scraped_csv: Path) -> dict:
    if not scraped_csv.exists():
        raise FileNotFoundError(f"Scraped CSV not found: {scraped_csv}")

    resolver = build_resolver(conn)

    # Pull current canonical adds + notation per slug for divergence comparison.
    canonical = {
        slug: (adds, notation)
        for slug, adds, notation in conn.execute(
            "SELECT slug, adds, notation FROM freestyle_tricks"
        )
    }

    matched_rows: list[dict] = []
    unmatched: list[str] = []

    with scraped_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            trick_slug = resolve_scraped_row(row, resolver)
            if trick_slug is None:
                unmatched.append((row.get("source_name") or "").strip())
                continue

            scraped_adds_raw = (row.get("add_value") or "").strip()
            scraped_notation = (row.get("notation") or "").strip() or None
            try:
                scraped_adds = int(scraped_adds_raw) if scraped_adds_raw else None
            except ValueError:
                scraped_adds = None

            canonical_adds_raw, canonical_notation = canonical.get(trick_slug, (None, None))
            canonical_adds = None
            if canonical_adds_raw is not None:
                try:
                    canonical_adds = int(canonical_adds_raw)
                except (ValueError, TypeError):
                    canonical_adds = None

            asserted_adds = scraped_adds if (scraped_adds is not None and scraped_adds != canonical_adds) else None
            asserted_notation = scraped_notation if (scraped_notation and scraped_notation != canonical_notation) else None

            matched_rows.append({
                "trick_slug": trick_slug,
                "source_id": FOOTBAG_ORG_SOURCE_ID,
                "external_ref": (row.get("showmove_id") or "").strip() or None,
                "external_url": (row.get("source_url") or "").strip() or None,
                "asserted_adds": asserted_adds,
                "asserted_notation": asserted_notation,
                "asserted_category": None,
                "notes": None,
            })

    # Dedupe: a single trick may match multiple scraped rows (e.g. via both
    # source_name and alias_text); PRIMARY KEY on (trick_slug, source_id) means
    # we collapse to the first hit per slug.
    seen = set()
    deduped = []
    for r in matched_rows:
        if r["trick_slug"] in seen:
            continue
        seen.add(r["trick_slug"])
        deduped.append(r)

    conn.execute(
        "DELETE FROM freestyle_trick_source_links WHERE source_id = ?",
        (FOOTBAG_ORG_SOURCE_ID,),
    )
    conn.executemany(
        """
        INSERT INTO freestyle_trick_source_links
          (trick_slug, source_id, external_ref, external_url, asserted_adds, asserted_notation, asserted_category, notes)
        VALUES
          (:trick_slug, :source_id, :external_ref, :external_url, :asserted_adds, :asserted_notation, :asserted_category, :notes)
        """,
        deduped,
    )

    n_divergent = sum(1 for r in deduped if r["asserted_adds"] is not None or r["asserted_notation"] is not None)

    return {
        "matched": len(deduped),
        "unmatched": len(unmatched),
        "divergent": n_divergent,
    }


def load(db_path: Path, scraped_csv: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            upsert_footbag_source(conn)
            stats = overlay_footbag_sources(conn, scraped_csv)

        print(f"footbag.org overlay: {stats['matched']} tricks linked")
        print(f"  divergent (asserted_adds or asserted_notation differs from canonical): {stats['divergent']}")
        print(f"  unmatched (deferred to Red's second-pass review): {stats['unmatched']}")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Overlay footbag.org provenance onto trick dictionary")
    parser.add_argument(
        "--db",
        default=str(REPO_ROOT / "database" / "footbag.db"),
        help="Path to SQLite database (default: repo root database/footbag.db)",
    )
    parser.add_argument(
        "--scraped-csv",
        default=str(SCRAPED_CSV),
        help="Path to scraped_footbag_moves.csv",
    )
    args = parser.parse_args()

    scraped_path = Path(args.scraped_csv)
    if not scraped_path.exists():
        print(
            f"  (skip: {scraped_path.name} not present; "
            f"run legacy_data/run_pipeline.sh full to populate via script 18)"
        )
        return

    load(Path(args.db), scraped_path)


if __name__ == "__main__":
    main()
