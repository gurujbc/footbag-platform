#!/usr/bin/env bash
# ============================================================================
# WARNING: DESTRUCTIVE STAGING / DEV DATABASE DEPLOY
#
# This script ALWAYS BLOWS AWAY the current live database on the target host
# and replaces it with a freshly rebuilt database/footbag.db from your local
# working tree.
#
# It is intended ONLY for the current testing / development phase of this
# project, where staging data is disposable and schema changes are frequent.
#
# DO NOT use this script once the project reaches the point where live data
# on the host must be preserved. At that point, use scripts/deploy-migrate.sh
# instead.
#
# This script preserves only:
#   - /srv/footbag/env
#
# This script intentionally destroys and replaces:
#   - the live SQLite database at the path specified by FOOTBAG_DB_PATH in
#     /srv/footbag/env
#
# If you are not absolutely sure that replacing the host database is correct,
# STOP and do not run this script.
# ============================================================================

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: < <operator credential file> bash scripts/deploy-rebuild.sh [--keep-media]

Reads sudo password from stdin (line 1).

WARNING:
  This script DESTROYS the current host database and replaces it with a
  freshly rebuilt local database/footbag.db.
  On staging it ALSO wipes the entire S3 media bucket by default (avatar
  keys are stable per member ID; a fresh DB seed maps those IDs to
  different people, so leaving old objects would serve the wrong person's
  photo at the new identity).
  Pass --keep-media to skip the S3 wipe. The script refuses to run on
  non-staging environments unless --keep-media is passed; production
  media wipes are an out-of-band operator procedure.

Flags:
  --keep-media       Skip the S3 media bucket wipe (DB is still replaced).
                     Required on non-staging environments.

Env-var overrides:
  DEPLOY_TARGET=footbag-staging
  SKIP_TESTS=yes
  SKIP_DB_REBUILD=yes
  SKIP_SMOKE=yes
  KEEP_MEDIA=yes     (alternative to --keep-media flag)
USAGE
}

if [[ -t 0 ]]; then
  echo "ERROR: must receive sudo password on stdin." >&2
  echo "       Run via: bash deploy_to_aws.sh --with-db --db-only" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

# Consume the password from stdin into a shell variable. This deploy feeds
# the password to two separate ssh+sudo invocations (image-load and
# remote-half-execute), which can't share a single stdin pipe. Each ssh gets
# the password via `printf` (a bash builtin: no fork, no argv leak). The
# password never appears on any process's argv.
IFS= read -r SUDO_PASS

REMOTE="${DEPLOY_TARGET:-footbag-staging}"
SKIP_TESTS="${SKIP_TESTS:-no}"
SKIP_DB_REBUILD="${SKIP_DB_REBUILD:-no}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REMOTE_HALF="${SCRIPT_DIR}/internal/deploy-rebuild-remote.sh"

# SSH connection options. Parallel to scripts/deploy-code.sh; see that file
# for the rationale (host-key pinning on first contact, fail-fast on dead
# targets, keepalives across the long docker-save and rsync streams).
SSH_OPTS=(-o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10" -o "ServerAliveInterval=30")

# Derive FOOTBAG_ENV from the SSH alias; passed to the remote-half so it can
# fetch the matching /footbag/{env}/secrets/origin_verify_secret from SSM.
# See scripts/deploy-code.sh for the derivation comment.
case "$REMOTE" in
  *production*|*-prod) FOOTBAG_ENV="production" ;;
  *staging*)           FOOTBAG_ENV="staging"    ;;
  *)
    echo "ERROR: cannot derive FOOTBAG_ENV from REMOTE='$REMOTE'." >&2
    echo "       Expected an alias containing 'staging' or 'production'." >&2
    exit 1
    ;;
esac

# Parse --keep-media (env-var override also accepted for CI scripting).
# Unset on staging = auto-wipe the S3 media bucket per Phase 8 design.
# On non-staging the script refuses without this flag; operator must opt
# out explicitly. Production media wipes are out-of-band (see DEVOPS_GUIDE).
KEEP_MEDIA="${KEEP_MEDIA:-no}"
for arg in "$@"; do
  case "$arg" in
    --keep-media) KEEP_MEDIA="yes" ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$FOOTBAG_ENV" != "staging" && "$KEEP_MEDIA" != "yes" ]]; then
  echo "ERROR: refusing to auto-wipe S3 media on FOOTBAG_ENV=$FOOTBAG_ENV." >&2
  echo "       This script auto-wipes media only on staging. Either:" >&2
  echo "         pass --keep-media to rebuild the DB without touching S3, or" >&2
  echo "         use a staging deploy target." >&2
  exit 1
fi

[[ -r "$REMOTE_HALF" ]] || { echo "ERROR: missing remote-half: $REMOTE_HALF" >&2; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker required locally for image build" >&2; exit 1; }

HOST_IP=$(ssh -G "$REMOTE" | awk '/^hostname / {print $2; exit}')
REMOTE_RELEASE_DIR='/home/footbag/footbag-release'
LOCAL_DB='database/footbag.db'

if [[ -z "$HOST_IP" ]]; then
  echo "ERROR: unable to resolve deploy target hostname from ssh config: $REMOTE" >&2
  exit 1
fi

echo "==> WARNING: this deploy will REPLACE the live host database from scratch."
echo "==> Deploy target: $REMOTE ($HOST_IP)"

echo "==> Confirming SSH connectivity..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "echo '    SSH OK'" </dev/null

if [[ "$SKIP_TESTS" != "yes" ]]; then
  echo "==> Running local test preflight..."
  npm test
else
  echo "==> Skipping local npm test preflight (SKIP_TESTS=yes)"
fi

if [[ "$SKIP_DB_REBUILD" != "yes" ]]; then
  echo "==> Rebuilding local database from scratch..."
  bash scripts/reset-local-db.sh
else
  echo "==> Skipping local DB rebuild (SKIP_DB_REBUILD=yes)"
fi

command -v sqlite3 >/dev/null || {
  echo "ERROR: sqlite3 is required locally" >&2
  exit 1
}

if [[ ! -f "$LOCAL_DB" ]]; then
  echo "ERROR: rebuilt DB not found: $LOCAL_DB" >&2
  exit 1
fi

echo "==> Verifying rebuilt local DB..."
sqlite3 "$LOCAL_DB" 'PRAGMA integrity_check;' | grep -qx 'ok' || {
  echo "ERROR: local rebuilt DB failed integrity_check" >&2
  exit 1
}

sqlite3 "$LOCAL_DB" \
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_person_club_affiliations';" \
  | grep -qx '1' || {
  echo "ERROR: local rebuilt DB is missing table legacy_person_club_affiliations" >&2
  exit 1
}

echo "==> Preparing remote upload directory..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -rf $REMOTE_RELEASE_DIR && mkdir -p $REMOTE_RELEASE_DIR" </dev/null

echo "==> Rsyncing source to host..."
rsync -av --delete -e "ssh ${SSH_OPTS[*]}" \
  --include='/.dockerignore' \
  --include='/docker/***' \
  --include='/src/***' \
  --include='/ops/***' \
  --include='/package.json' \
  --include='/package-lock.json' \
  --include='/tsconfig.json' \
  --include='/database/' \
  --include='/database/footbag.db' \
  --exclude='*' \
  ./ "$REMOTE:$REMOTE_RELEASE_DIR/" </dev/null

# ── Build images locally (workstation, where memory is plentiful) ──────────
# The host (Lightsail nano_3_0, 512 MB) cannot fit a parallel npm ci build.

echo "==> Building Docker images locally (workstation)..."
# Build with the base compose only. The prod overlay is runtime-only (mounts,
# memory limits, env that lives in /srv/footbag/env on the host) and would
# fail interpolation here on the workstation. Image content is identical.
( cd "$REPO_ROOT" && docker compose \
    -f docker/docker-compose.yml \
    build )

# Capture layer DiffIDs (RootFS.Layers) for end-to-end integrity verification:
# the remote-half inspects the loaded images and exits non-zero if either layer
# list does not match. DiffIDs are sha256 of the uncompressed layer tars and
# survive save/load regardless of daemon version skew between workstation and
# host. .Id is fragile because each daemon may re-serialize the image config
# JSON, producing a benign hash difference on identical content.
WEB_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-web 2>/dev/null) || {
  echo "ERROR: docker image inspect failed for docker-web (build did not produce expected image)" >&2
  exit 1
}
WORKER_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-worker 2>/dev/null) || {
  echo "ERROR: docker image inspect failed for docker-worker" >&2
  exit 1
}
IMAGE_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-image 2>/dev/null) || {
  echo "ERROR: docker image inspect failed for docker-image" >&2
  exit 1
}

# ── Transfer images to host via docker save | docker load ──────────────────
# Pre-transfer optimization (mirrors deploy-code.sh): skip the pipe when the
# host already has images with identical RootFS DiffIDs. Operator's footbag
# user is in the host's docker group; no sudo needed for `docker image inspect`.
echo "==> Comparing local image RootFS DiffIDs against host..."
REMOTE_WEB_LAYERS=$(ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-web 2>/dev/null" \
  </dev/null || true)
REMOTE_WORKER_LAYERS=$(ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-worker 2>/dev/null" \
  </dev/null || true)
REMOTE_IMAGE_LAYERS=$(ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-image 2>/dev/null" \
  </dev/null || true)
if [[ -n "$WEB_IMAGE_LAYERS" && -n "$WORKER_IMAGE_LAYERS" && -n "$IMAGE_IMAGE_LAYERS" \
   && "$WEB_IMAGE_LAYERS"    == "$REMOTE_WEB_LAYERS" \
   && "$WORKER_IMAGE_LAYERS" == "$REMOTE_WORKER_LAYERS" \
   && "$IMAGE_IMAGE_LAYERS"  == "$REMOTE_IMAGE_LAYERS" ]]; then
  echo "==> Image RootFS DiffIDs match host; skipping docker save | docker load."
else
  echo "==> Transferring images to host (docker save | docker load)..."
  { printf '%s\n' "$SUDO_PASS"; docker save docker-web docker-worker docker-image; } \
    | ssh "${SSH_OPTS[@]}" "$REMOTE" 'sudo -S -p "" docker load'
fi

echo "==> Running remote-as-root rebuild deploy via cat-pipe..."
# printf emits the password line; the EXPECTED_*_IMAGE_LAYERS assignments give
# the remote-half the layer DiffIDs to verify against the docker-loaded images;
# cat appends the remote-half script body. Layer DiffIDs are space-separated
# sha256:[0-9a-f]{64} tokens and contain no shell metacharacters.
{
  printf '%s\n' "$SUDO_PASS"
  printf 'EXPECTED_WEB_IMAGE_LAYERS=%q\n'    "$WEB_IMAGE_LAYERS"
  printf 'EXPECTED_WORKER_IMAGE_LAYERS=%q\n' "$WORKER_IMAGE_LAYERS"
  printf 'EXPECTED_IMAGE_IMAGE_LAYERS=%q\n'  "$IMAGE_IMAGE_LAYERS"
  printf 'FOOTBAG_ENV=%q\n'                  "$FOOTBAG_ENV"
  printf 'KEEP_MEDIA=%q\n'                   "$KEEP_MEDIA"
  printf 'DEPLOY_TARGET=%q\n'                "$REMOTE"
  cat "$REMOTE_HALF"
} | ssh "${SSH_OPTS[@]}" "$REMOTE" 'sudo -S -p "" bash'

# Smoke runs against the public CloudFront URL by default. Mirrors deploy-code.sh.
case "$FOOTBAG_ENV" in
  staging)    SMOKE_DEFAULT_URL="https://doye1nvv64qep.cloudfront.net" ;;
  production) SMOKE_DEFAULT_URL="" ;;  # set when production CloudFront lands
  *)          SMOKE_DEFAULT_URL="" ;;
esac
SMOKE_BASE_URL="${SMOKE_BASE_URL:-$SMOKE_DEFAULT_URL}"

if [[ "${SKIP_SMOKE:-no}" == "yes" ]]; then
  echo "==> Skipping post-deploy smoke check (SKIP_SMOKE=yes)"
elif [[ -z "$SMOKE_BASE_URL" ]]; then
  echo "==> Skipping post-deploy smoke check (no SMOKE_BASE_URL configured for FOOTBAG_ENV=$FOOTBAG_ENV)"
else
  echo "==> Running smoke check against $SMOKE_BASE_URL ..."
  if ! BASE_URL="$SMOKE_BASE_URL" bash scripts/smoke-local.sh; then
    echo "ERROR: post-deploy smoke check failed against $SMOKE_BASE_URL" >&2
    echo "Recommendation: ssh $REMOTE 'sudo journalctl -u footbag -n 200 --no-pager' to inspect host logs." >&2
    exit 1
  fi
fi

echo
echo "Deploy complete. Origin: http://$HOST_IP"
echo "WARNING: live DB was replaced from scratch."
