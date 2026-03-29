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
Usage: bash scripts/deploy-rebuild.sh <password>

WARNING:
  This script DESTROYS the current host database and replaces it with a
  freshly rebuilt local database/footbag.db.

Overrides:
  DEPLOY_TARGET=footbag-staging bash scripts/deploy-rebuild.sh <password>
  SKIP_TESTS=yes bash scripts/deploy-rebuild.sh <password>
  SKIP_DB_REBUILD=yes bash scripts/deploy-rebuild.sh <password>
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

FOOTBAG_PASS="$1"
REMOTE="${DEPLOY_TARGET:-footbag-staging}"
SKIP_TESTS="${SKIP_TESTS:-no}"
SKIP_DB_REBUILD="${SKIP_DB_REBUILD:-no}"

PASS_B64=$(printf '%s' "$FOOTBAG_PASS" | base64 | tr -d '\n')
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
ssh "$REMOTE" "echo '    SSH OK'"

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
ssh "$REMOTE" "rm -rf $REMOTE_RELEASE_DIR && mkdir -p $REMOTE_RELEASE_DIR"

echo "==> Rsyncing source to host..."
rsync -av --delete -e "ssh" \
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
  ./ "$REMOTE:$REMOTE_RELEASE_DIR/"

echo "==> Running remote full-rebuild deploy..."
ssh "$REMOTE" bash -s -- "$PASS_B64" <<'REMOTE_EOF'
set -euo pipefail

PASS_B64="$1"
SUDO_PASS=$(printf '%s' "$PASS_B64" | base64 -d)

LIVE_DIR='/srv/footbag'
ENV_PATH='/srv/footbag/env'
RELEASE_DIR='/home/footbag/footbag-release'
NEW_DB="$RELEASE_DIR/database/footbag.db"

run_sudo() {
  printf '%s\n' "$SUDO_PASS" | sudo -S -p '' "$@"
}

require_path() {
  local label="$1"
  local path="$2"
  if [[ ! -e "$path" ]]; then
    echo "Missing required path: $label ($path)" >&2
    exit 1
  fi
}

require_env() {
  local key="$1"
  local value
  value=$(run_sudo awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print}' "$ENV_PATH" | tail -1)
  if [[ -z "$value" ]]; then
    echo "Missing required env var in $ENV_PATH: $key" >&2
    exit 1
  fi
  printf '%s' "$value"
}

compose_cmd() {
  run_sudo docker compose \
    --env-file "$ENV_PATH" \
    -f "$LIVE_DIR/docker/docker-compose.yml" \
    -f "$LIVE_DIR/docker/docker-compose.prod.yml" \
    "$@"
}

dump_diagnostics() {
  echo "    ---- systemctl status footbag.service ----" >&2
  run_sudo systemctl status footbag.service --no-pager -l || true

  echo "    ---- journalctl -u footbag.service -n 100 ----" >&2
  run_sudo journalctl -u footbag.service -n 100 --no-pager || true

  echo "    ---- docker compose ps ----" >&2
  compose_cmd ps || true

  echo "    ---- docker compose logs web ----" >&2
  compose_cmd logs web --tail=100 || true

  echo "    ---- docker compose logs worker ----" >&2
  compose_cmd logs worker --tail=100 || true

  echo "    ---- docker compose logs nginx ----" >&2
  compose_cmd logs nginx --tail=100 || true
}

echo "    Preflight checks on host..."
command -v docker >/dev/null || { echo "docker missing on host" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemctl missing on host" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 missing on host" >&2; exit 1; }
command -v awk >/dev/null || { echo "awk missing on host" >&2; exit 1; }
command -v rsync >/dev/null || { echo "rsync missing on host" >&2; exit 1; }

require_path "release dir" "$RELEASE_DIR"
require_path "env file" "$ENV_PATH"
require_path "uploaded DB" "$NEW_DB"
require_path "service unit source" "$RELEASE_DIR/ops/systemd/footbag.service"
require_path "compose file" "$RELEASE_DIR/docker/docker-compose.yml"
require_path "compose prod file" "$RELEASE_DIR/docker/docker-compose.prod.yml"

NODE_ENV_VAL=$(require_env NODE_ENV)
LOG_LEVEL_VAL=$(require_env LOG_LEVEL)
DB_PATH=$(require_env FOOTBAG_DB_PATH)
PUBLIC_BASE_URL_VAL=$(require_env PUBLIC_BASE_URL)
SESSION_SECRET_VAL=$(require_env SESSION_SECRET)

if [[ "$SESSION_SECRET_VAL" == *'#'* ]]; then
  echo "SESSION_SECRET contains '#' which breaks systemd EnvironmentFile parsing" >&2
  exit 1
fi

if [[ -z "$DB_PATH" || "$DB_PATH" == "/" ]]; then
  echo "Refusing to deploy with unsafe FOOTBAG_DB_PATH: '$DB_PATH'" >&2
  exit 1
fi

echo "    Runtime DB path from env: $DB_PATH"
echo "    WARNING: replacing host DB at $DB_PATH"

echo "    Stopping service..."
run_sudo systemctl stop footbag || true

echo "    Ensuring compose stack is fully down..."
compose_cmd down --remove-orphans || true

echo "    Promoting release into $LIVE_DIR ..."
run_sudo rsync -a --delete --exclude env --exclude footbag.db --exclude media "$RELEASE_DIR/" "$LIVE_DIR/"

echo "    Replacing live DB..."
run_sudo mkdir -p "$(dirname "$DB_PATH")"
run_sudo rm -rf "$DB_PATH"
run_sudo install -o root -g root -m 600 "$NEW_DB" "$DB_PATH"
run_sudo chown -R root:root "$LIVE_DIR"

if ! run_sudo test -f "$DB_PATH"; then
  echo "Expected SQLite file at $DB_PATH, but it is not a regular file" >&2
  exit 1
fi

echo "    Verifying copied DB on host..."
run_sudo sqlite3 "$DB_PATH" 'PRAGMA integrity_check;' | grep -qx 'ok' || {
  echo "Copied DB failed integrity_check on host" >&2
  exit 1
}

echo "    Reinstalling service unit..."
run_sudo cp "$LIVE_DIR/ops/systemd/footbag.service" /etc/systemd/system/
run_sudo systemctl daemon-reload

echo "    Building Docker images..."
compose_cmd build

echo "    Restarting service..."
if ! run_sudo systemctl restart footbag; then
  echo "    ERROR: footbag.service failed to restart. Dumping diagnostics..." >&2
  dump_diagnostics
  exit 1
fi

sleep 3
if ! run_sudo systemctl is-active --quiet footbag.service; then
  echo "    ERROR: footbag.service is not active after restart. Dumping diagnostics..." >&2
  dump_diagnostics
  exit 1
fi

run_sudo systemctl status footbag.service --no-pager -l
REMOTE_EOF

echo "==> Running smoke check against http://$HOST_IP ..."
BASE_URL="http://$HOST_IP" bash scripts/smoke-local.sh

echo
echo "Deploy complete. Origin: http://$HOST_IP"
echo "WARNING: live DB was replaced from scratch."
