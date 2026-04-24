#!/usr/bin/env bash
# =============================================================================
# deploy-local-data.sh
#
# Orchestrator for local SQLite database preparation. Wraps
# legacy_data/run_pipeline.sh and scripts/reset-local-db.sh into a single
# entry point with explicit modes, safe defaults, and preflight checks.
#
# Does NOT push anything to AWS. Use scripts/deploy-rebuild.sh for that.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

usage() {
  cat <<'USAGE'
Usage: bash scripts/deploy-local-data.sh <mode> [--dry-run]

Modes (exactly one required):
  --from-mirror   Full rebuild from the legacy mirror. Regenerates canonical
                  CSVs and rebuilds the local DB with all enrichment phases
                  (C, D, E, F, G) plus phase NET and V. Delegates to
                  legacy_data/run_pipeline.sh full.
                  Requires: legacy_data/mirror_footbag_org/ present.

  --from-csv      Rebuild the local DB from existing canonical CSVs. Does
                  not require mirror access. Runs all enrichment phases.
                  Delegates to legacy_data/run_pipeline.sh csv_only.
                  Requires: legacy_data/event_results/canonical_input/*.csv
                            and legacy_data/event_results/seed/mvfp_full/*.csv
                            present.

  --db-only       Fast platform DB rebuild from canonical CSVs plus mirror-
                  derived club extraction. Skips enrichment phases
                  C, D, E, F, G. Clubs and members are seeded directly from
                  the mirror. Delegates to scripts/reset-local-db.sh.
                  Requires: mirror present (for club extractors).
                  Use --from-csv if you need phase C/D/E/F/G populated.

  --help, -h      Show this message.

Options:
  --dry-run       Print what would be executed without running anything.

This script orchestrates LOCAL DB preparation only. For AWS staging deploy,
see scripts/deploy-rebuild.sh.
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

MODE=""
DRY_RUN="no"
for arg in "$@"; do
  case "$arg" in
    --from-mirror|--from-csv|--db-only)
      if [[ -n "$MODE" ]]; then
        echo "ERROR: only one mode may be specified (got '$MODE' and '$arg')" >&2
        exit 1
      fi
      MODE="$arg"
      ;;
    --dry-run)
      DRY_RUN="yes"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument '$arg'" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "ERROR: no mode specified" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

run_or_print() {
  if [[ "$DRY_RUN" == "yes" ]]; then
    echo "    DRY RUN: would exec: $*"
    exit 0
  fi
  exec "$@"
}

run_from_mirror() {
  echo "==> deploy-local-data: --from-mirror"
  local mirror_dir="${REPO_ROOT}/legacy_data/mirror_footbag_org"
  if [[ ! -d "$mirror_dir" ]]; then
    echo "ERROR: mirror not found at ${mirror_dir}" >&2
    echo "       The legacy mirror must be present for --from-mirror." >&2
    echo "       Use --from-csv if you do not have the mirror." >&2
    exit 1
  fi
  echo "    Mirror present: $mirror_dir"
  cd "${REPO_ROOT}/legacy_data"
  run_or_print ./run_pipeline.sh full
}

run_from_csv() {
  echo "==> deploy-local-data: --from-csv"
  local missing=()
  local ci="${REPO_ROOT}/legacy_data/event_results/canonical_input"
  local seed="${REPO_ROOT}/legacy_data/event_results/seed/mvfp_full"

  for f in events event_disciplines event_results event_result_participants persons; do
    [[ -f "${ci}/${f}.csv" ]] || missing+=("legacy_data/event_results/canonical_input/${f}.csv")
  done
  for f in seed_events seed_event_disciplines seed_event_results seed_event_result_participants seed_persons; do
    [[ -f "${seed}/${f}.csv" ]] || missing+=("legacy_data/event_results/seed/mvfp_full/${f}.csv")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: csv_only preflight failed. Missing:" >&2
    for m in "${missing[@]}"; do echo "  MISSING: $m" >&2; done
    echo "" >&2
    echo "These CSVs are produced by a prior --from-mirror run or obtained" >&2
    echo "from a collaborator." >&2
    exit 1
  fi

  echo "    Canonical CSVs present"
  cd "${REPO_ROOT}/legacy_data"
  run_or_print ./run_pipeline.sh csv_only
}

run_db_only() {
  echo "==> deploy-local-data: --db-only"
  echo ""
  echo "    WARNING: --db-only skips phase C/D/E/F/G enrichment."
  echo "    Use --from-csv if you need those tables populated."
  echo ""
  local mirror_dir="${REPO_ROOT}/legacy_data/mirror_footbag_org"
  if [[ ! -d "$mirror_dir" ]]; then
    echo "ERROR: mirror not found at ${mirror_dir}" >&2
    echo "       --db-only still requires the mirror for club extractors." >&2
    exit 1
  fi
  echo "    Mirror present: $mirror_dir"
  run_or_print bash "${SCRIPT_DIR}/reset-local-db.sh"
}

case "$MODE" in
  --from-mirror) run_from_mirror ;;
  --from-csv)    run_from_csv ;;
  --db-only)     run_db_only ;;
esac
