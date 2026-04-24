#!/usr/bin/env bash
# =============================================================================
# deploy-to-aws.sh
#
# Two-step AWS staging deploy orchestrator:
#   Step 1: optional local database prep
#   Step 2: push to AWS staging (code, and optionally DB)
#
# Composes:
#   scripts/deploy-local-data.sh   local DB prep modes
#   scripts/deploy-code.sh         code + images only
#   scripts/deploy-rebuild.sh      code + images + DB replacement
#
# This orchestrator requires an explicit mode flag. For a fully back-compat
# no-flag invocation (rebuild DB via reset-local-db.sh, then push) keep using
# scripts/deploy-rebuild.sh directly.
#
# TODO (future migration support): once scripts/deploy-migrate.sh is
# implemented (see that file for the plan), this orchestrator will grow a
# --migrate mode that runs schema migrations against the staging DB while
# preserving live data, replacing --with-db as the safe default for schema
# changes.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: bash scripts/deploy-to-aws.sh <password> <mode flags> [options]

Args:
  <password>     Sudo password for the footbag account on the staging host.

Mode flags (exactly one required):

  --code-only                    Ship code + images; leave staging DB
                                 untouched.
                                 Delegates to scripts/deploy-code.sh.

  --with-db --db-only            Ship code + images AND replace staging DB.
                                 Rebuild local DB via
                                 scripts/reset-local-db.sh (fast; skips
                                 phase C/D/E/F/G enrichment).
                                 Delegates to scripts/deploy-rebuild.sh.

  --with-db --from-mirror        Ship code + images AND replace staging DB.
                                 Rebuild local DB via the full legacy
                                 pipeline (mirror required).
                                 Runs deploy-local-data.sh --from-mirror
                                 then deploy-rebuild.sh with
                                 SKIP_DB_REBUILD=yes.

  --with-db --from-csv           Ship code + images AND replace staging DB.
                                 Rebuild local DB from existing canonical
                                 CSVs (mirror not required).
                                 Runs deploy-local-data.sh --from-csv then
                                 deploy-rebuild.sh with SKIP_DB_REBUILD=yes.

  --with-db --skip-local-data    Ship code + images AND replace staging DB
                                 using database/footbag.db as-is (no local
                                 rebuild).
                                 Equivalent to SKIP_DB_REBUILD=yes bash
                                 scripts/deploy-rebuild.sh <pass>.

Options:
  --skip-tests                   Skip the local npm test preflight.
  --dry-run                      Print what would be executed without
                                 running anything.
  --no-staleness-check           Skip the pre-deploy check that BLOCKS
                                 when canonical CSVs are older than
                                 pipeline code or curated inputs.
                                 (Check is skipped automatically for
                                 --code-only and --with-db --from-mirror.)
  --help, -h                     Show this message.

Env overrides:
  DEPLOY_TARGET=footbag-staging  Override SSH config alias used by
                                 the delegated deploy-code.sh /
                                 deploy-rebuild.sh.

Examples:
  bash scripts/deploy-to-aws.sh <pass> --code-only
  bash scripts/deploy-to-aws.sh <pass> --with-db --db-only
  bash scripts/deploy-to-aws.sh <pass> --with-db --from-csv
  bash scripts/deploy-to-aws.sh <pass> --with-db --from-mirror --skip-tests
  bash scripts/deploy-to-aws.sh <pass> --with-db --skip-local-data --dry-run

Safety: this orchestrator does not choose a default deploy mode. If you
supply no mode flag it errors out. Destructive DB replacement requires
explicit --with-db.
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

PASSWORD=""
DEPLOY_MODE=""
DB_SOURCE=""
SKIP_TESTS_FLAG="no"
DRY_RUN="no"
STALENESS_CHECK="yes"

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    --code-only)
      [[ -z "$DEPLOY_MODE" ]] || { echo "ERROR: --code-only conflicts with prior mode flag" >&2; exit 1; }
      DEPLOY_MODE="--code-only"
      ;;
    --with-db)
      [[ -z "$DEPLOY_MODE" ]] || { echo "ERROR: --with-db conflicts with prior mode flag" >&2; exit 1; }
      DEPLOY_MODE="--with-db"
      ;;
    --db-only|--from-mirror|--from-csv|--skip-local-data)
      [[ -z "$DB_SOURCE" ]] || { echo "ERROR: $arg conflicts with prior DB source flag" >&2; exit 1; }
      DB_SOURCE="$arg"
      ;;
    --skip-tests)
      SKIP_TESTS_FLAG="yes"
      ;;
    --dry-run)
      DRY_RUN="yes"
      ;;
    --no-staleness-check)
      STALENESS_CHECK="no"
      ;;
    -*)
      echo "ERROR: unknown flag '$arg'" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
    *)
      [[ -z "$PASSWORD" ]] || { echo "ERROR: unexpected positional argument '$arg'" >&2; exit 1; }
      PASSWORD="$arg"
      ;;
  esac
done

if [[ -z "$PASSWORD" ]]; then
  echo "ERROR: password required as first positional argument" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

if [[ -z "$DEPLOY_MODE" ]]; then
  echo "ERROR: no deploy mode specified (use --code-only or --with-db)" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

if [[ "$DEPLOY_MODE" == "--code-only" && -n "$DB_SOURCE" ]]; then
  echo "ERROR: $DB_SOURCE is only valid with --with-db" >&2
  exit 1
fi

if [[ "$DEPLOY_MODE" == "--with-db" && -z "$DB_SOURCE" ]]; then
  echo "ERROR: --with-db requires one of: --db-only, --from-mirror, --from-csv, --skip-local-data" >&2
  exit 1
fi

if [[ "$SKIP_TESTS_FLAG" == "yes" ]]; then
  export SKIP_TESTS="yes"
fi

run_step() {
  if [[ "$DRY_RUN" == "yes" ]]; then
    echo "    DRY RUN: would run: $*"
    return 0
  fi
  "$@"
}

exec_step() {
  if [[ "$DRY_RUN" == "yes" ]]; then
    echo "    DRY RUN: would exec: $*"
    if [[ -n "${SKIP_DB_REBUILD:-}" ]]; then
      echo "             with SKIP_DB_REBUILD=$SKIP_DB_REBUILD"
    fi
    if [[ -n "${SKIP_TESTS:-}" ]]; then
      echo "             with SKIP_TESTS=$SKIP_TESTS"
    fi
    exit 0
  fi
  exec "$@"
}

check_canonical_freshness() {
  if [[ "$STALENESS_CHECK" == "no" ]]; then
    return 0
  fi
  local ci_dir="${REPO_ROOT}/legacy_data/event_results/canonical_input"
  [[ -d "$ci_dir" ]] || return 0

  local ci_oldest
  ci_oldest=$(find "$ci_dir" -maxdepth 1 -name '*.csv' -printf '%T@\n' 2>/dev/null | sort -n | head -1)
  [[ -n "$ci_oldest" ]] || return 0

  local inputs_latest
  inputs_latest=$({
    find "${REPO_ROOT}/legacy_data/pipeline" -name '*.py' -type f -printf '%T@\n' 2>/dev/null
    find "${REPO_ROOT}/legacy_data/overrides" -type f -printf '%T@\n' 2>/dev/null
    find "${REPO_ROOT}/legacy_data/inputs/curated" -type f -printf '%T@\n' 2>/dev/null
    find "${REPO_ROOT}/legacy_data/inputs/identity_lock" -type f -printf '%T@\n' 2>/dev/null
    stat -c '%Y' "${REPO_ROOT}/legacy_data/inputs/canonical_discipline_fixes.csv" 2>/dev/null
  } | sort -rn | head -1)
  [[ -n "$inputs_latest" ]] || return 0

  if awk -v a="$inputs_latest" -v b="$ci_oldest" 'BEGIN{exit !(a > b)}'; then
    echo "" >&2
    echo "========================================================================" >&2
    echo "ERROR: canonical CSVs look stale relative to pipeline inputs or code." >&2
    echo "" >&2
    echo "  Oldest canonical_input csv:    $(date -d @${ci_oldest%.*} '+%Y-%m-%d %H:%M:%S')" >&2
    echo "  Newest pipeline input or code: $(date -d @${inputs_latest%.*} '+%Y-%m-%d %H:%M:%S')" >&2
    echo "" >&2
    echo "  Your local canonical CSVs predate the latest pipeline code or curated" >&2
    echo "  inputs. Deploying would ship stale data to staging." >&2
    echo "" >&2
    echo "  To fix: run" >&2
    echo "      bash scripts/deploy-local-data.sh --from-mirror" >&2
    echo "  and retry the deploy." >&2
    echo "" >&2
    echo "  To override (ship the stale data anyway):" >&2
    echo "      re-run with --no-staleness-check" >&2
    echo "========================================================================" >&2
    echo "" >&2
    exit 1
  fi
}

if [[ "$DEPLOY_MODE" != "--code-only" && "$DB_SOURCE" != "--from-mirror" ]]; then
  check_canonical_freshness
fi

echo "==> deploy-to-aws: mode=$DEPLOY_MODE${DB_SOURCE:+ source=$DB_SOURCE}${DRY_RUN:+ dry-run=$DRY_RUN}"

if [[ "$DEPLOY_MODE" == "--code-only" ]]; then
  echo "    Step 1 (local DB prep): skipped"
  echo "    Step 2 (AWS push): scripts/deploy-code.sh"
  exec_step bash "${SCRIPT_DIR}/deploy-code.sh" "$PASSWORD"
fi

case "$DB_SOURCE" in
  --db-only)
    echo "    Step 1 (local DB prep): handled inside deploy-rebuild.sh (reset-local-db.sh)"
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh" "$PASSWORD"
    ;;
  --skip-local-data)
    echo "    Step 1 (local DB prep): skipped (using current database/footbag.db)"
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh (SKIP_DB_REBUILD=yes)"
    export SKIP_DB_REBUILD="yes"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh" "$PASSWORD"
    ;;
  --from-mirror)
    echo "    Step 1 (local DB prep): scripts/deploy-local-data.sh --from-mirror"
    run_step bash "${SCRIPT_DIR}/deploy-local-data.sh" --from-mirror
    echo ""
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh (SKIP_DB_REBUILD=yes)"
    export SKIP_DB_REBUILD="yes"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh" "$PASSWORD"
    ;;
  --from-csv)
    echo "    Step 1 (local DB prep): scripts/deploy-local-data.sh --from-csv"
    run_step bash "${SCRIPT_DIR}/deploy-local-data.sh" --from-csv
    echo ""
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh (SKIP_DB_REBUILD=yes)"
    export SKIP_DB_REBUILD="yes"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh" "$PASSWORD"
    ;;
esac
