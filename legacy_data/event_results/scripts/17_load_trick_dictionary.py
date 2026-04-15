"""
Script 17: Load freestyle trick dictionary and modifier reference into SQLite.

Reads:
  legacy_data/inputs/noise/tricks.csv         → freestyle_tricks table
  legacy_data/inputs/noise/trick_modifiers.csv → freestyle_trick_modifiers table

Writes: database/footbag.db

trick_family rules:
  - Modifier tricks (category='modifier'): trick_family = NULL
  - Base tricks (base_trick empty or equals canonical_name): trick_family = own slug
  - Compound/dex tricks with a different base_trick: trick_family = slug(base_trick)

Idempotent: DELETE + INSERT in a single transaction for each table.
Run from legacy_data/ with the venv active:
    python event_results/scripts/17_load_trick_dictionary.py [--db <path>]
"""

import argparse
import csv
import json
import re
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parents[3]  # scripts/ → event_results/ → legacy_data/ → repo root
TRICKS_CSV = SCRIPT_DIR.parents[1] / "inputs" / "noise" / "tricks.csv"
MODIFIERS_CSV = SCRIPT_DIR.parents[1] / "inputs" / "noise" / "trick_modifiers.csv"


def trick_name_to_slug(name: str) -> str:
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def compute_trick_family(canonical_name: str, base_trick: str | None, category: str | None) -> str | None:
    """Compute trick_family slug for a trick.

    - Modifier tricks: NULL (they are the modifiers, not members of a trick family)
    - Base tricks (base_trick empty or equals canonical_name): own slug
    - Compounds/dex with different base_trick: slug of base_trick
    """
    if category == "modifier":
        return None
    if not base_trick:
        return trick_name_to_slug(canonical_name)
    if base_trick.lower() == canonical_name.lower():
        return trick_name_to_slug(canonical_name)
    return trick_name_to_slug(base_trick)


def load_tricks(conn: sqlite3.Connection, tricks_csv: Path, loaded_at: str) -> int:
    if not tricks_csv.exists():
        raise FileNotFoundError(f"Tricks CSV not found: {tricks_csv}")

    rows = []
    with tricks_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            canonical_name = row["trick_canon"].strip()
            if not canonical_name:
                continue
            slug = trick_name_to_slug(canonical_name)
            adds = row.get("adds", "").strip() or None
            base_trick_raw = row.get("base_trick", "").strip() or None
            category = row.get("category", "").strip() or None
            notes = row.get("notes", "").strip() or None
            raw_aliases = row.get("aliases", "").strip()
            aliases = [a.strip() for a in raw_aliases.split("|") if a.strip()] if raw_aliases else []
            trick_family = compute_trick_family(canonical_name, base_trick_raw, category)
            rows.append({
                "slug": slug,
                "canonical_name": canonical_name,
                "adds": adds,
                "base_trick": base_trick_raw,
                "trick_family": trick_family,
                "category": category,
                "description": notes,
                "aliases_json": json.dumps(aliases),
                "sort_order": i,
                "loaded_at": loaded_at,
            })

    conn.execute("DELETE FROM freestyle_tricks")
    conn.executemany(
        """
        INSERT INTO freestyle_tricks
          (slug, canonical_name, adds, base_trick, trick_family, category,
           description, aliases_json, sort_order, loaded_at)
        VALUES
          (:slug, :canonical_name, :adds, :base_trick, :trick_family, :category,
           :description, :aliases_json, :sort_order, :loaded_at)
        """,
        rows,
    )
    return len(rows)


def load_modifiers(conn: sqlite3.Connection, modifiers_csv: Path, loaded_at: str) -> int:
    if not modifiers_csv.exists():
        raise FileNotFoundError(f"Modifiers CSV not found: {modifiers_csv}")

    rows = []
    with modifiers_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            modifier_name = row["modifier"].strip()
            if not modifier_name:
                continue
            slug = trick_name_to_slug(modifier_name)
            rows.append({
                "slug": slug,
                "modifier_name": modifier_name,
                "add_bonus": int(row["add_bonus"].strip()),
                "add_bonus_rotational": int(row["add_bonus_rotational"].strip()),
                "modifier_type": row["modifier_type"].strip(),
                "notes": row.get("notes", "").strip() or None,
                "loaded_at": loaded_at,
            })

    conn.execute("DELETE FROM freestyle_trick_modifiers")
    conn.executemany(
        """
        INSERT INTO freestyle_trick_modifiers
          (slug, modifier_name, add_bonus, add_bonus_rotational, modifier_type, notes, loaded_at)
        VALUES
          (:slug, :modifier_name, :add_bonus, :add_bonus_rotational, :modifier_type, :notes, :loaded_at)
        """,
        rows,
    )
    return len(rows)


def load(db_path: Path, tricks_csv: Path, modifiers_csv: Path) -> None:
    loaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            n_tricks = load_tricks(conn, tricks_csv, loaded_at)
            n_modifiers = load_modifiers(conn, modifiers_csv, loaded_at)

        print(f"Loaded {n_tricks} tricks into freestyle_tricks.")
        # Summary by category
        cur = conn.execute(
            "SELECT category, COUNT(*) AS n FROM freestyle_tricks GROUP BY category ORDER BY n DESC"
        )
        for cat_row in cur.fetchall():
            print(f"  {str(cat_row[0] or '(none)'):20s} {cat_row[1]}")

        print()
        print(f"Loaded {n_modifiers} modifiers into freestyle_trick_modifiers.")
        # Family summary
        print()
        print("Trick families:")
        cur = conn.execute(
            """
            SELECT trick_family, COUNT(*) AS n
            FROM freestyle_tricks
            WHERE trick_family IS NOT NULL
            GROUP BY trick_family ORDER BY n DESC LIMIT 15
            """
        )
        for fam_row in cur.fetchall():
            print(f"  {str(fam_row[0]):25s} {fam_row[1]}")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Load freestyle trick dictionary and modifiers")
    parser.add_argument(
        "--db",
        default=str(REPO_ROOT / "database" / "footbag.db"),
        help="Path to SQLite database (default: repo root database/footbag.db)",
    )
    parser.add_argument(
        "--tricks-csv",
        default=str(TRICKS_CSV),
        help="Path to tricks.csv source",
    )
    parser.add_argument(
        "--modifiers-csv",
        default=str(MODIFIERS_CSV),
        help="Path to trick_modifiers.csv source",
    )
    args = parser.parse_args()

    load(Path(args.db), Path(args.tricks_csv), Path(args.modifiers_csv))


if __name__ == "__main__":
    main()
