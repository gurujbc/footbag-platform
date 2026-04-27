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
RECORDS_MASTER_CSV="legacy_data/inputs/curated/records/records_master.csv"
MIRROR_DIR="legacy_data/mirror_footbag_org"
VENV="scripts/.venv"
REQUIREMENTS="scripts/requirements.txt"

# Preflight: required local files. This script does NOT regenerate canonical
# inputs or the mirror; it loads existing artifacts. On a fresh clone, run
# `bash scripts/deploy-local-data.sh --from-mirror` (or --from-csv) first.
_missing=()
for _f in "${CANONICAL_INPUT_DIR}/events.csv" \
          "${CANONICAL_INPUT_DIR}/event_disciplines.csv" \
          "${CANONICAL_INPUT_DIR}/event_results.csv" \
          "${CANONICAL_INPUT_DIR}/event_result_participants.csv" \
          "${CANONICAL_INPUT_DIR}/persons.csv" \
          "${RECORDS_MASTER_CSV}" \
          "${SCHEMA}"; do
  [[ -f "${_f}" ]] || _missing+=("${_f}")
done
[[ -d "${MIRROR_DIR}" ]] || _missing+=("${MIRROR_DIR}/  (legacy site mirror; needed for clubs / club_members extract)")
if [[ ${#_missing[@]} -gt 0 ]]; then
  echo "ERROR: required local file(s) not present:" >&2
  for _f in "${_missing[@]}"; do echo "  MISSING: ${_f}" >&2; done
  echo "" >&2
  echo "Recommendation: bash scripts/deploy-local-data.sh --from-mirror   (or --from-csv if mirror is unavailable)." >&2
  exit 1
fi

# Mirror staleness warning. Configurable via FOOTBAG_MIRROR_MAX_AGE_DAYS;
# bypass via FOOTBAG_MIRROR_AGE_ACK=1 when intentional.
_max_age="${FOOTBAG_MIRROR_MAX_AGE_DAYS:-90}"
_sentinel="${MIRROR_DIR}/index.html"
if [[ -f "${_sentinel}" && "${FOOTBAG_MIRROR_AGE_ACK:-}" != "1" ]]; then
  _age_days=$(( ( $(date +%s) - $(stat -c %Y "${_sentinel}") ) / 86400 ))
  if (( _age_days > _max_age )); then
    echo "WARNING: legacy mirror is ${_age_days} days old (threshold: ${_max_age})." >&2
    echo "Recommendation: refresh via 'cd legacy_data && ./create_mirror.sh', or set FOOTBAG_MIRROR_AGE_ACK=1 to proceed." >&2
    exit 1
  fi
fi

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

# Load freestyle trick dictionary (tricks + modifiers + aliases + curated-v1 source).
# Script 17 must run BEFORE script 19 (Red expert additions) and script 20 (footbag.org
# overlay) because both layer source-scoped rows on top of script 17's base load.
# All three must run BEFORE the freestyle media loaders below (21/22/23) so that
# media_links.entity_id='trick' rows resolve to existing freestyle_tricks.slug.
echo "  → Loading freestyle trick dictionary..."
"${PYTHON}" legacy_data/event_results/scripts/17_load_trick_dictionary.py \
  --db "${DB_FILE}"

echo "  → Loading Red Husted expert-review trick additions..."
"${PYTHON}" legacy_data/event_results/scripts/19_load_red_additions.py \
  --db "${DB_FILE}"

echo "  → Overlaying footbag.org trick provenance..."
"${PYTHON}" legacy_data/event_results/scripts/20_link_footbag_org_sources.py \
  --db "${DB_FILE}"

# Load freestyle media: sources → assets → links (FK-safe order).
# Sources first (FK target for assets.source_id); assets next (FK target for
# links.media_id); links last. Each loader cascade-deletes its dependents in
# reverse FK order so re-running the chain rebuilds cleanly.
echo "  → Loading freestyle media sources..."
"${PYTHON}" legacy_data/event_results/scripts/21_load_freestyle_media_sources.py \
  --db "${DB_FILE}"

echo "  → Loading freestyle media assets..."
"${PYTHON}" legacy_data/event_results/scripts/22_load_freestyle_media_assets.py \
  --db "${DB_FILE}"

echo "  → Loading freestyle media links..."
"${PYTHON}" legacy_data/event_results/scripts/23_load_freestyle_media_links.py \
  --db "${DB_FILE}"

# Seed name_variants (HIGH-confidence only; MEDIUM rows are deferred to a
# review artifact). Required for verify-time auto-link tier1/tier2 matching.
echo "  → Loading name_variants seed..."
"${PYTHON}" legacy_data/scripts/load_name_variants_seed.py \
  --db "${DB_FILE}" \
  --apply

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
