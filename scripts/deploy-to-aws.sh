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
Usage: bash deploy_to_aws.sh [<flags>]                    (recommended)
   or: < <operator credential file> bash scripts/deploy-to-aws.sh [<flags>]

DEFAULT (no flags): equivalent to `--with-db --from-csv`. Full enrichment
(phases C/D/E/F/G/H/V), mirror-free, uses only committed canonical_input/*
and seed/* CSVs. DESTRUCTIVE to staging DB. The wrapper runs a preflight
first (tools, SSH alias, disk space, DB lock, credential file).


WHICH MODE TO USE
─────────────────────────────────────────────────────────────────────
  Just changed code, want staging DB intact?
      bash deploy_to_aws.sh --code-only

  Push fresh data + code (mirror-free, full enrichment)?
      bash deploy_to_aws.sh                          # default

  Fast DB reset (skip enrichment phases C/D/E/F/G)?
      bash deploy_to_aws.sh --with-db --db-only

  Re-derive canonical from the legacy mirror (mirror + identity-lock required)?
      bash deploy_to_aws.sh --with-db --from-mirror
      (note: identity-lock CSV not yet committed; see legacy_data IP)

  Already have a known-good database/footbag.db locally, just push it?
      bash deploy_to_aws.sh --with-db --skip-local-data

  Curious what would happen?
      bash deploy_to_aws.sh --dry-run


MODE FLAGS
─────────────────────────────────────────────────────────────────────
  --code-only                  Ship code + images; staging DB untouched.
                               Use when only src/ changed.
  --with-db --db-only          Rebuild local DB via reset-local-db.sh
                               (fast, no enrichment); push code + DB.
  --with-db --from-mirror      Full pipeline (run_pipeline.sh full);
                               mirror + identity-lock required; push.
  --with-db --from-csv         [DEFAULT]  Full enrichment from committed
                               CSVs (run_pipeline.sh csv_only); push.
  --with-db --skip-local-data  Push current ./database/footbag.db as-is.

OPTIONS
─────────────────────────────────────────────────────────────────────
  --skip-tests                 Skip local `npm test` preflight in
                               deploy-rebuild.sh.
  --dry-run                    Print what would run; do not run anything.
  --no-staleness-check         Silence "canonical CSVs older than pipeline
                               code" WARNING (gate is warn-only since
                               2026-04-27; flag still useful for clean output).
  --help, -h                   Show this message.

ENV OVERRIDES
─────────────────────────────────────────────────────────────────────
  DEPLOY_TARGET=<alias>            SSH alias (default: footbag-staging).
  AWS_OPERATOR_FILE=<path>         Override operator-credential file path
                                   (default: ~/AWS/AWS_OPERATOR.txt).
  SKIP_SMOKE=yes                   Skip post-deploy smoke check.
  SMOKE_BASE_URL=<url>             Override smoke target (default: the
                                   environment's public CloudFront URL).
  SKIP_TESTS=yes                   Same as --skip-tests.
  SKIP_DB_REBUILD=yes              Skip reset-local-db.sh inside
                                   deploy-rebuild.sh (auto-set by the
                                   orchestrator for --from-mirror /
                                   --from-csv / --skip-local-data).
  FOOTBAG_MIRROR_AGE_ACK=1         Acknowledge stale mirror, proceed with
                                   reset-local-db.sh.
  FOOTBAG_MIRROR_MAX_AGE_DAYS=N    Raise mirror staleness threshold from
                                   the 90-day default.

EXAMPLES
─────────────────────────────────────────────────────────────────────
  Routine code update (DB intact):
      bash deploy_to_aws.sh --code-only

  Full deploy from current CSVs (the default):
      bash deploy_to_aws.sh

  Push without running tests:
      bash deploy_to_aws.sh --code-only --skip-tests

  Override the SSH alias:
      DEPLOY_TARGET=footbag-staging-alt bash deploy_to_aws.sh --code-only

  See the deploy plan without running:
      bash deploy_to_aws.sh --dry-run
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

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
      echo "ERROR: unexpected positional argument '$arg'" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -t 0 ]]; then
  echo "ERROR: must receive sudo password on stdin." >&2
  echo "       Run via: bash deploy_to_aws.sh ..." >&2
  echo "" >&2
  usage >&2
  exit 1
fi

# NOTE: do NOT consume stdin here. exec_step inherits stdin and forwards it
# to the leaf, which forwards through its own ssh stdin to the remote sudo -S.
# Loading the password into a shell variable would expose it to memory
# scraping by same-uid processes; piping through unchanged keeps the password
# only in unnamed kernel pipes.

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
  # Local DB-prep steps must not consume the password from this orchestrator's
  # stdin; redirect from /dev/null so the password remains for exec_step.
  "$@" </dev/null
}

exec_step() {
  if [[ "$DRY_RUN" == "yes" ]]; then
    echo "    DRY RUN: would run: $*"
    if [[ -n "${SKIP_DB_REBUILD:-}" ]]; then
      echo "             with SKIP_DB_REBUILD=$SKIP_DB_REBUILD"
    fi
    if [[ -n "${SKIP_TESTS:-}" ]]; then
      echo "             with SKIP_TESTS=$SKIP_TESTS"
    fi
    exit 0
  fi
  # Inherit this orchestrator's stdin (the password line) and pass it through
  # to the leaf, which forwards via ssh to remote sudo -S. The password
  # remains in unnamed kernel pipes only; never lands in argv or a shell var.
  "$@"
  exit $?
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
    echo "------------------------------------------------------------------------" >&2
    echo "WARNING: canonical CSVs are older than pipeline inputs or code." >&2
    echo "" >&2
    echo "  Oldest canonical_input csv:    $(date -d @${ci_oldest%.*} '+%Y-%m-%d %H:%M:%S')" >&2
    echo "  Newest pipeline input or code: $(date -d @${inputs_latest%.*} '+%Y-%m-%d %H:%M:%S')" >&2
    echo "" >&2
    echo "  The deploy will proceed with the committed canonical_input CSVs." >&2
    echo "  Recommendation: if you want fresh canonical outputs, run" >&2
    echo "    bash scripts/deploy-local-data.sh --from-mirror" >&2
    echo "  before deploying. Suppress this warning with --no-staleness-check." >&2
    echo "------------------------------------------------------------------------" >&2
    echo "" >&2
  fi
}

if [[ "$DEPLOY_MODE" != "--code-only" && "$DB_SOURCE" != "--from-mirror" ]]; then
  check_canonical_freshness
fi

echo "==> deploy-to-aws: mode=$DEPLOY_MODE${DB_SOURCE:+ source=$DB_SOURCE}${DRY_RUN:+ dry-run=$DRY_RUN}"

if [[ "$DEPLOY_MODE" == "--code-only" ]]; then
  echo "    Step 1 (local DB prep): skipped"
  echo "    Step 2 (AWS push): scripts/deploy-code.sh"
  exec_step bash "${SCRIPT_DIR}/deploy-code.sh"
fi

case "$DB_SOURCE" in
  --db-only)
    echo "    Step 1 (local DB prep): handled inside deploy-rebuild.sh (reset-local-db.sh)"
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh"
    ;;
  --skip-local-data)
    echo "    Step 1 (local DB prep): skipped (using current database/footbag.db)"
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh (SKIP_DB_REBUILD=yes)"
    export SKIP_DB_REBUILD="yes"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh"
    ;;
  --from-mirror)
    echo "    Step 1 (local DB prep): scripts/deploy-local-data.sh --from-mirror"
    run_step bash "${SCRIPT_DIR}/deploy-local-data.sh" --from-mirror
    echo ""
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh (SKIP_DB_REBUILD=yes)"
    export SKIP_DB_REBUILD="yes"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh"
    ;;
  --from-csv)
    echo "    Step 1 (local DB prep): scripts/deploy-local-data.sh --from-csv"
    run_step bash "${SCRIPT_DIR}/deploy-local-data.sh" --from-csv
    echo ""
    echo "    Step 2 (AWS push + DB replace): scripts/deploy-rebuild.sh (SKIP_DB_REBUILD=yes)"
    export SKIP_DB_REBUILD="yes"
    exec_step bash "${SCRIPT_DIR}/deploy-rebuild.sh"
    ;;
esac
