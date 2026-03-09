#!/usr/bin/env bash
# reset-local-db.sh
# Drops and rebuilds the local SQLite database from schema + seed data.
# Safe to run repeatedly — destroys all local data each time.
#
# Usage:
#   ./scripts/reset-local-db.sh
#   FOOTBAG_DB_PATH=./custom.db ./scripts/reset-local-db.sh

set -euo pipefail

# sqlite3 CLI is a documented prerequisite (see docs/DEV_ONBOARDING_V0_1.md §13.3)
if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 CLI not found. Install it first:"
  echo "  Ubuntu/Debian: sudo apt-get install sqlite3"
  echo "  macOS:         brew install sqlite3"
  exit 1
fi

DB_FILE="${FOOTBAG_DB_PATH:-./database/footbag.db}"
SCHEMA="database/schema_v0_1.sql"
SEED="database/seeds/seed_mvfp_v0_1.sql"

echo "Resetting database: ${DB_FILE}"

# Remove existing database and WAL sidecar files
rm -f "${DB_FILE}" "${DB_FILE}-wal" "${DB_FILE}-shm"

# Apply schema
echo "  → Applying schema..."
sqlite3 "${DB_FILE}" < "${SCHEMA}"

# Apply seed data
echo "  → Applying seed data..."
sqlite3 "${DB_FILE}" < "${SEED}"

# Sanity check
EVENT_COUNT=$(sqlite3 "${DB_FILE}" "SELECT COUNT(*) FROM events;")
echo "  → Done. ${EVENT_COUNT} events in database."
echo "Reset complete: ${DB_FILE}"
