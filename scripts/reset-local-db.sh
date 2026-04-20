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
CANONICAL_INPUT_DIR="legacy_data/event_results/canonical_input"
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

# Ensure mirror-derived club_members.csv exists (idempotent; script skips
# when CSV newer than source). Needed as input for the legacy_members seed.
echo "  → Extracting club member data from mirror (for legacy_members seed)..."
"${PYTHON}" legacy_data/scripts/extract_club_members.py

# Seed legacy_members BEFORE historical_persons is loaded, so the FK
# historical_persons.legacy_member_id -> legacy_members(legacy_member_id)
# is satisfied by script 08 below. This is a TEMPORARY mirror-based
# population; Steve Goldberg's dump will supersede it.
echo "  → Loading legacy_members seed (temporary, mirror-derived)..."
"${PYTHON}" legacy_data/scripts/load_legacy_members_seed.py --db "${DB_FILE}"

# Build seed CSVs from canonical input. Script 07 stamps source_scope='CANONICAL'
# on persons, which the /history Players query requires. This replaces the prior
# cp-based shortcut, which dropped source_scope and broke the /history listing.
echo "  → Building seed CSVs from canonical input..."
"${PYTHON}" legacy_data/event_results/scripts/07_build_mvfp_seed_full.py \
  --input-dir "${CANONICAL_INPUT_DIR}" \
  --output-dir "${SEED_DIR}"

# Load seed CSVs into database
echo "  → Loading seed data into database..."
"${PYTHON}" legacy_data/event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py \
  --db "${DB_FILE}" \
  --seed-dir "${SEED_DIR}"

# Load freestyle passback records
echo "  → Loading freestyle passback records..."
"${PYTHON}" legacy_data/event_results/scripts/10_load_freestyle_records_to_sqlite.py \
  --db "${DB_FILE}" \
  --records-csv legacy_data/inputs/curated/records/records_master.csv

# Load consecutive kicks records
echo "  → Loading consecutive kicks records..."
"${PYTHON}" legacy_data/event_results/scripts/11_load_consecutive_records_to_sqlite.py \
  --db "${DB_FILE}"

# Phase NET: net enrichment layer (discipline groups, teams, appearances, review queue).
# Reads canonical tables, writes net_* tables. Must run after script 08.
echo "  → Building net discipline groups..."
"${PYTHON}" legacy_data/event_results/scripts/12_build_net_discipline_groups.py \
  --db "${DB_FILE}"

echo "  → Building net teams..."
"${PYTHON}" legacy_data/event_results/scripts/13_build_net_teams.py \
  --db "${DB_FILE}"

echo "  → Importing net review queue..."
"${PYTHON}" legacy_data/event_results/scripts/14_import_net_review_queue.py \
  --db "${DB_FILE}"

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

# Seed test member accounts (passwords from env vars)
echo "  → Seeding member accounts..."
"${PYTHON}" legacy_data/scripts/seed_members.py --db "${DB_FILE}" --allow-missing-passwords

# Sanity check
EVENT_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM events;")
CLUB_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM clubs;")
MEMBER_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM legacy_person_club_affiliations;")
echo "  → Done. ${EVENT_COUNT} events, ${CLUB_COUNT} clubs, ${MEMBER_COUNT} club affiliations in database."
echo "Reset complete: ${DB_FILE}"
