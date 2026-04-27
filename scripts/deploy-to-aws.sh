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
Usage: bash deploy_to_aws.sh <mode flags> [options]    (top-level wrapper, recommended)
   or: < <operator credential file> bash scripts/deploy-to-aws.sh <mode flags> [options]

Reads sudo password from stdin (line 1).

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
  bash deploy_to_aws.sh --code-only
  bash deploy_to_aws.sh --with-db --db-only
  bash deploy_to_aws.sh --with-db --from-csv
  bash deploy_to_aws.sh --with-db --from-mirror --skip-tests
  bash deploy_to_aws.sh --with-db --skip-local-data --dry-run

Safety: this orchestrator does not choose a default deploy mode. If you
supply no mode flag it errors out. Destructive DB replacement requires
explicit --with-db.

First-time setup (do once per env after this branch lands):
  Origin-verify secret is now Terraform-managed (random_id) and the deploy
  pulls the value from SSM at run time. Workstation steps:

    cd terraform/staging                # or terraform/production
    terraform init -upgrade             # picks up new random + http providers
    terraform apply                     # writes random_id-generated secret
                                        # to SSM; refreshes CloudFront origin
                                        # custom_header; pins port 80 ingress
                                        # to CloudFront prefix list

  Then run a deploy as usual. The remote-half automatically:
    - asserts /srv/footbag/env is root:root 600,
    - verifies docker-loaded image IDs match what was just built,
    - reconciles FOOTBAG_ENV (auto-derived from DEPLOY_TARGET),
    - fetches X_ORIGIN_VERIFY_SECRET from SSM and rewrites /srv/footbag/env.

  No manual /srv/footbag/env edits, no manual `aws ssm put-parameter`, no
  manual SSH known_hosts pre-pop. If a deploy fails with a "TODO-..." secret
  message, terraform apply was not run since this branch landed.
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
