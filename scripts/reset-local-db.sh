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
SCHEMA="database/schema_v0_1.sql"
CANONICAL_INPUT="legacy_data/event_results/canonical_input"
SEED_DIR="legacy_data/event_results/seed/mvfp_full"
VENV="scripts/.venv"
REQUIREMENTS="scripts/requirements.txt"

# Create venv and install dependencies if not already present
if [ ! -f "${VENV}/bin/python3" ]; then
  echo "  → Creating Python venv..."
  python3 -m venv "${VENV}"
  "${VENV}/bin/pip" install --quiet -r "${REQUIREMENTS}"
fi

PYTHON="${VENV}/bin/python3"

echo "Resetting database: ${DB_FILE}"

# Remove existing database and WAL sidecar files
rm -f "${DB_FILE}" "${DB_FILE}-wal" "${DB_FILE}-shm"

# Apply schema
echo "  → Applying schema..."
sqlite3 "${DB_FILE}" < "${SCHEMA}"

# Build full seed CSVs from canonical input
echo "  → Building seed CSVs from canonical input..."
"${PYTHON}" legacy_data/event_results/scripts/07_build_mvfp_seed_full.py \
  --input-dir "${CANONICAL_INPUT}"

# Load seed CSVs into database
echo "  → Loading seed data into database..."
"${PYTHON}" legacy_data/event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py \
  --db "${DB_FILE}" \
  --seed-dir "${SEED_DIR}"

# Sanity check
EVENT_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM events;")
echo "  → Done. ${EVENT_COUNT} events in database."
echo "Reset complete: ${DB_FILE}"
