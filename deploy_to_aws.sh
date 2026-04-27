#!/usr/bin/env bash
# deploy_to_aws.sh -- the only workstation-side AWS deploy entry point.
#
# Orchestrates: preflight (tools, ssh alias, disk, DB lock), credential pipe,
# pre-deploy summary, delegation to scripts/deploy-to-aws.sh.
#
# Reads ~/AWS/AWS_OPERATOR.txt exactly once via shell `<` redirection. The
# password never appears in any process's argv on the workstation. Forward
# scripts (orchestrator, leaves) consume stdin; none re-reads the file.

set -euo pipefail

# --help / -h short-circuits before any preflight or file read.
for arg in "$@"; do
  case "$arg" in
    --help|-h) exec bash scripts/deploy-to-aws.sh --help ;;
  esac
done

# If no mode flag (--code-only or --with-db) is present, prepend the default
# mode (--with-db --from-csv). Lets `bash deploy_to_aws.sh --dry-run` and
# similar option-only invocations exercise the default path. Mirror-free
# default uses only committed CSVs so a fresh clone can always run it.
# Destructive to staging DB.
HAS_MODE=0
for arg in "$@"; do
  case "$arg" in
    --code-only|--with-db) HAS_MODE=1 ;;
  esac
done
if (( HAS_MODE == 0 )); then
  set -- --with-db --from-csv "$@"
fi

# -----------------------------------------------------------------------------
# Mode classification (drives mode-aware preflight skips below).
# -----------------------------------------------------------------------------
MODE_CODE_ONLY=0
MODE_WITH_DB=0
MODE_INSTALL_CWAGENT=0   # placeholder; see TODO below.
DB_REBUILD_INVOLVED=0
for arg in "$@"; do
  case "$arg" in
    --code-only)         MODE_CODE_ONLY=1 ;;
    --with-db)           MODE_WITH_DB=1 ;;
    --db-only|--from-mirror|--from-csv) DB_REBUILD_INVOLVED=1 ;;
    --skip-local-data)   : ;;  # --with-db without local rebuild; lock check still warranted
  esac
done

# TODO(F.1, prod): production target plumbing is deferred. When terraform/production
# applies, add a hard-confirm gate here for `--with-db` against any DEPLOY_TARGET
# matching footbag-prod*. Auto mode is staging-only today.

# -----------------------------------------------------------------------------
# Preflight. Each check exits 1 with a one-line Recommendation. Mode-aware:
# skips checks irrelevant to the requested mode. Generic remediation strings;
# no on-disk credential paths are printed.
# -----------------------------------------------------------------------------
need_cmd() {
  local cmd="$1" pkg_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2
    echo "Recommendation: $pkg_hint" >&2
    exit 1
  fi
}

# Universal tools.
need_cmd ssh    "Install OpenSSH client."
need_cmd rsync  "apt-get install -y rsync"
need_cmd docker "Install Docker (DEV_ONBOARDING -- container runtime install)."
need_cmd jq     "apt-get install -y jq"

# DB-touching modes need sqlite3 + (eventually, when prod activates) aws CLI.
if (( MODE_CODE_ONLY != 1 )); then
  need_cmd sqlite3 "apt-get install -y sqlite3"
  need_cmd aws     "Install AWS CLI v2 (see aws/install in this repo)."
fi

# Resolve the deploy target's SSH alias. The leaves derive FOOTBAG_ENV from
# the alias name; an unconfigured alias makes the deploy fail mid-flight with
# 'Could not resolve hostname'. Catch it here.
DEPLOY_TARGET="${DEPLOY_TARGET:-footbag-staging}"
# Avoid `awk ... exit` here: when awk exits before consuming all of ssh -G's
# output, the upstream `ssh -G` receives SIGPIPE and `set -o pipefail` then
# kills the wrapper with exit 141 before our own error message can print.
RESOLVED_HOST=$(ssh -G "$DEPLOY_TARGET" 2>/dev/null | awk '/^hostname / {print $2}' | tail -1)
if [[ -z "$RESOLVED_HOST" || "$RESOLVED_HOST" == "$DEPLOY_TARGET" ]]; then
  echo "ERROR: SSH alias '$DEPLOY_TARGET' is not configured (or resolves to itself)." >&2
  echo "Recommendation: add the deploy alias stanza to ~/.ssh/config." >&2
  exit 1
fi

# Workstation disk-space preflight: docker save tarballs + sqlite rebuild
# scratch can land 1-2 GB at peak.
WS_AVAIL_KB=$(df -k --output=avail . 2>/dev/null | tail -1 | tr -d ' ')
if [[ -n "$WS_AVAIL_KB" ]] && (( WS_AVAIL_KB < 2097152 )); then
  echo "ERROR: workstation has only ${WS_AVAIL_KB}K free in this directory; need >=2 GB." >&2
  echo "Recommendation: free disk (docker system prune -af; clear caches) and re-run." >&2
  exit 1
fi

# Local DB lock: a stuck `sqlite3` process or another tool holding the DB
# would let reset-local-db.sh's `rm -f` succeed but later loaders see a stale
# WAL. lsof is best-effort; we only fail if it's both available and reports
# active holders.
if (( DB_REBUILD_INVOLVED == 1 )) && command -v lsof >/dev/null 2>&1; then
  if [[ -f database/footbag.db ]] && lsof database/footbag.db >/dev/null 2>&1; then
    echo "ERROR: database/footbag.db is locked by another process." >&2
    echo "Recommendation: identify with 'lsof database/footbag.db', stop that process, and re-run." >&2
    exit 1
  fi
fi

# Operator credential source. Path env-overridable for future production use.
# Generic error: never print the resolved path.
AWS_OPERATOR_FILE="${AWS_OPERATOR_FILE:-$HOME/AWS/AWS_OPERATOR.txt}"
if [[ ! -r "$AWS_OPERATOR_FILE" ]]; then
  echo "ERROR: operator credential source unavailable." >&2
  echo "Recommendation: verify the configured credential location is readable." >&2
  exit 1
fi

# TODO(F.2, S3 snapshot): pre-deploy snapshot of staging DB to S3. Activates
# when staging holds user-generated content from dev testing. Insertion point
# is in scripts/internal/deploy-rebuild-remote.sh just before the DB replace.
# TODO(F.8, S3 restore): paired --restore-from <s3-key> subcommand.

# -----------------------------------------------------------------------------
# Pre-deploy summary. No paths, no secrets; just mode + target + host IP.
# Helps the operator catch a wrong DEPLOY_TARGET before the deploy proceeds.
# -----------------------------------------------------------------------------
echo "──────────────────────────────────────────────────────────"
echo "  Deploy mode:    $*"
echo "  Target alias:   $DEPLOY_TARGET"
echo "  Resolved host:  $RESOLVED_HOST"
echo "──────────────────────────────────────────────────────────"

# Pipe the operator-secrets file to the orchestrator's stdin instead of
# passing as a positional arg. argv-leak hardening: the password never
# appears in any process's argv on the operator workstation.
exec bash scripts/deploy-to-aws.sh "$@" < "$AWS_OPERATOR_FILE"
