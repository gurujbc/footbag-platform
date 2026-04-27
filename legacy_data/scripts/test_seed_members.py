#!/usr/bin/env python3
"""Integration test for seed_members.py.

Asserts the Footbag Hacky stub account row lands against a fresh schema.
Catches the regression class where INSERT OR IGNORE silently drops on a new
NOT NULL or CHECK constraint added to the members table without updating the
seed INSERT (loader-invariant violation per legacy_data/CLAUDE.md).

Run directly: `python3 legacy_data/scripts/test_seed_members.py`.
"""

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA = REPO_ROOT / "database" / "schema.sql"
SCRIPT = REPO_ROOT / "legacy_data" / "scripts" / "seed_members.py"
PYTHON = REPO_ROOT / "scripts" / ".venv" / "bin" / "python3"


def test_seed_members_creates_footbag_hacky_against_fresh_schema() -> None:
    if not PYTHON.exists():
        raise RuntimeError(
            f"venv python missing at {PYTHON}; run `bash scripts/reset-local-db.sh` "
            f"once or `python3 -m venv scripts/.venv && scripts/.venv/bin/pip install "
            f"-r scripts/requirements.txt` to bootstrap."
        )

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"

        # Apply current schema.sql to a fresh DB.
        subprocess.run(
            ["sqlite3", str(db_path)],
            input=SCHEMA.read_text(),
            text=True,
            check=True,
        )

        # Run seed_members.py with --allow-missing-passwords and STUB_PASSWORD
        # cleared from env, exercising the placeholder branch reset-local-db.sh
        # uses on a fresh clone.
        env = os.environ.copy()
        env.pop("STUB_PASSWORD", None)
        result = subprocess.run(
            [
                str(PYTHON), str(SCRIPT),
                "--db", str(db_path),
                "--allow-missing-passwords",
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            f"seed_members.py exited {result.returncode}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

        con = sqlite3.connect(db_path)
        try:
            # Loud-failure backstop: a future INSERT OR IGNORE silent drop
            # (e.g. unmet NOT NULL on a new column) leaves count=0.
            (count,) = con.execute(
                "SELECT COUNT(*) FROM members"
            ).fetchone()
            assert count == 1, f"expected 1 member row after seed, got {count}"

            row = con.execute(
                "SELECT login_email, slug, "
                "       password_hash IS NOT NULL AS has_pw, "
                "       legacy_member_id, "
                "       historical_person_id IS NULL AS hp_unset "
                "FROM members WHERE display_name = 'Footbag Hacky'"
            ).fetchone()
            assert row is not None, "Footbag Hacky member row not present"
            login_email, slug, has_pw, legacy_member_id, hp_unset = row
            assert login_email == "footbag", f"login_email={login_email!r}"
            assert slug == "footbag_hacky", f"slug={slug!r}"
            assert has_pw == 1, "password_hash must be populated"
            assert legacy_member_id == "STUB_FOOTBAG_HACKY", (
                f"legacy_member_id={legacy_member_id!r}"
            )
            # historical_person_id is nullable here: this test runs against a
            # bare schema with no canonical historical_persons rows, so the
            # script's UPDATE...FROM historical_persons leaves it NULL. Asserted
            # so a future regression that flips this to NOT NULL surfaces.
            assert hp_unset == 1, (
                "historical_person_id should be NULL when no canonical HP "
                "row exists; got non-NULL — schema or seed flow changed."
            )

            # legacy_members must contain the stub row the members FK points
            # at; otherwise the members.legacy_member_id FK would have failed
            # the INSERT silently under foreign_keys=ON.
            (lm_count,) = con.execute(
                "SELECT COUNT(*) FROM legacy_members "
                "WHERE legacy_member_id = 'STUB_FOOTBAG_HACKY'"
            ).fetchone()
            assert lm_count == 1, (
                f"expected stub legacy_members row, got {lm_count}"
            )
        finally:
            con.close()


if __name__ == "__main__":
    test_seed_members_creates_footbag_hacky_against_fresh_schema()
    print("OK: seed_members.py produces the Footbag Hacky stub against fresh schema")
