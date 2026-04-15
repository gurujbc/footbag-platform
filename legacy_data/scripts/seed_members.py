#!/usr/bin/env python3
"""Seed the Footbag Hacky stub account into the platform SQLite database.

This is the only seeded member account. All other members are created via
the registration flow at /register.

Usage:
  python legacy_data/scripts/seed_members.py [--db path/to/footbag.db]

Options:
  --db PATH                  Path to SQLite DB (default: FOOTBAG_DB_PATH env
                             var, then ./database/footbag.db)
  --allow-missing-passwords  Substitute 'dev-placeholder' when STUB_PASSWORD
                             is missing instead of aborting
"""

import argparse
import hashlib
import os
try:
    import pysqlite3 as sqlite3
except ImportError:
    import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from argon2 import PasswordHasher
from dotenv import load_dotenv

# Load .env from project root (two levels above legacy_data/scripts/).
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DEFAULT_DB = "./database/footbag.db"

# Argon2id parameters — match the Node.js `argon2` package defaults so that
# `argon2.verify()` on the Node side can verify hashes produced here.
_PH = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stable_id(prefix: str, *parts: str) -> str:
    raw = "||".join(str(p) for p in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def get_password(env_var: str, allow_missing: bool) -> str:
    value = os.environ.get(env_var, "").strip()
    if value:
        return value
    if allow_missing:
        print(f"  WARNING: {env_var} not set — using 'dev-placeholder'", file=sys.stderr)
        return "dev-placeholder"
    print(f"ERROR: required env var {env_var} is not set.", file=sys.stderr)
    print("Set it in your .env file or pass --allow-missing-passwords for local dev.", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=None, help="Path to SQLite database")
    parser.add_argument(
        "--allow-missing-passwords",
        action="store_true",
        help="Use 'dev-placeholder' when STUB_PASSWORD is missing",
    )
    args = parser.parse_args()

    db_path = args.db or os.environ.get("FOOTBAG_DB_PATH", DEFAULT_DB)
    allow_missing = args.allow_missing_passwords
    ts = now_iso()

    pw_stub = get_password("STUB_PASSWORD", allow_missing)

    print("  → Hashing password (argon2id)...")
    hash_stub = _PH.hash(pw_stub)

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA foreign_keys = ON")
    cur = con.cursor()

    # Footbag Hacky: demo/tester account. login_email='footbag' (non-email identifier).
    member_id = stable_id("member", "footbag-hacky")
    slug = "footbag_hacky"
    email_norm = "footbag"

    cur.execute(
        """
        INSERT OR IGNORE INTO members (
            id, slug,
            login_email, login_email_normalized, email_verified_at,
            password_hash, password_changed_at,
            real_name, display_name, display_name_normalized,
            city, region, country, first_competition_year,
            searchable, is_admin, is_hof, hof_inducted_year,
            created_at, created_by, updated_at, updated_by, version
        ) VALUES (
            :id, :slug,
            :email, :email_norm, :ts,
            :hash, :ts,
            :real_name, :display_name, :display_name_norm,
            :city, :region, :country, :first_comp_year,
            1, 0, 1, 2025,
            :ts, 'seed', :ts, 'seed', 1
        )
        """,
        {
            "id": member_id,
            "slug": slug,
            "email": "footbag",
            "email_norm": email_norm,
            "ts": ts,
            "hash": hash_stub,
            "real_name": "Footbag Hacky",
            "display_name": "Footbag Hacky",
            "display_name_norm": "footbag hacky",
            "city": "Oregon City",
            "region": "OR",
            "country": "USA",
            "first_comp_year": 1972,
        },
    )
    print("  → Seeded stub account: Footbag Hacky (login_email='footbag')")

    # Link Footbag Hacky to any matching historical_persons record.
    # This is a special case for the test stub account. In production, this
    # linkage happens through the claim flow or auto-link at migration.
    hacky_legacy_id = "STUB_FOOTBAG_HACKY"
    cur.execute(
        "UPDATE members SET legacy_member_id = :lid WHERE id = :mid AND legacy_member_id IS NULL",
        {"lid": hacky_legacy_id, "mid": member_id},
    )
    cur.execute(
        """UPDATE historical_persons SET legacy_member_id = :lid
           WHERE person_name = 'Footbag Hacky' AND legacy_member_id IS NULL""",
        {"lid": hacky_legacy_id},
    )
    linked = cur.rowcount
    if linked:
        print(f"  → Linked Footbag Hacky member to historical person (legacy_member_id={hacky_legacy_id})")
    else:
        print("  → No matching historical person found for Footbag Hacky (will link when results are loaded)")

    con.commit()
    con.close()
    print("  → Member seed complete: 1 account (Footbag Hacky).")


if __name__ == "__main__":
    main()
