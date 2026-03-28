#!/usr/bin/env bash
# reset-local-db.sh
# Drops and rebuilds the local SQLite database from schema + full seed pipeline.
# Safe to run repeatedly — destroys all local data each time.
#
# Usage:
#   ./scripts/reset-local-db.sh
#   FOOTBAG_DB_PATH=./custom.db ./scripts/reset-local-db.sh

set -euo pipefail

if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 CLI not found. Install it first:"
  echo "  Ubuntu/Debian: sudo apt-get install sqlite3"
  echo "  macOS:         brew install sqlite3"
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found. Install it first."
  exit 1
fi

DB_FILE="${FOOTBAG_DB_PATH:-./database/footbag.db}"
SCHEMA="database/schema.sql"
CANONICAL_INPUT="legacy_data/event_results/canonical_input"
SEED_DIR="legacy_data/event_results/seed/mvfp_full"
VENV="scripts/.venv"
REQUIREMENTS="scripts/requirements.txt"

# Create venv if not present; always sync dependencies
if [ ! -f "${VENV}/bin/python3" ]; then
  echo "  → Creating Python venv..."
  python3 -m venv "${VENV}"
fi
"${VENV}/bin/pip" install --quiet -r "${REQUIREMENTS}"

PYTHON="${VENV}/bin/python3"

echo "Resetting database: ${DB_FILE}"

# Remove existing database and WAL sidecar files
rm -f "${DB_FILE}" "${DB_FILE}-wal" "${DB_FILE}-shm"

# Apply schema
echo "  → Applying schema..."
sqlite3 "${DB_FILE}" < "${SCHEMA}"

# Persons come from the canonical list — authoritative, James-curated.
# Overwrite seed_persons.csv so 08_load picks up the clean source.
# (Extra columns in canonical are ignored by the loader's row.get() calls.)
cp "${CANONICAL_INPUT}/persons.csv" "${SEED_DIR}/seed_persons.csv"

# Load seed CSVs into database
echo "  → Loading seed data into database..."
"${PYTHON}" legacy_data/event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py \
  --db "${DB_FILE}" \
  --seed-dir "${SEED_DIR}"

# Extract club seed data from legacy mirror
echo "  → Extracting club seed data from mirror..."
"${PYTHON}" legacy_data/scripts/extract_clubs.py

# Load club seed data into database
echo "  → Loading club seed data into database..."
"${PYTHON}" legacy_data/scripts/load_clubs_seed.py --db "${DB_FILE}"

# Extract club member data from legacy mirror
echo "  → Extracting club member data from mirror..."
"${PYTHON}" legacy_data/scripts/extract_club_members.py

# Load club member data into database
echo "  → Loading club member data into database..."
"${PYTHON}" legacy_data/scripts/load_club_members_seed.py --db "${DB_FILE}"

# Sanity check
EVENT_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM events;")
CLUB_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM clubs;")
MEMBER_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM legacy_person_club_affiliations;")
echo "  → Done. ${EVENT_COUNT} events, ${CLUB_COUNT} clubs, ${MEMBER_COUNT} club affiliations in database."
echo "Reset complete: ${DB_FILE}"
