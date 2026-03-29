#!/usr/bin/env bash
# deploy-code.sh
#
# Deploys the current working tree to the staging Lightsail host.
# Code and images only — the live database is never touched.
#
# Prerequisites:
#   - ~/.ssh/config alias "footbag-staging" configured with User footbag (§6.2)
#   - npm test passing locally before running this script
#   - Initial AWS bootstrap (Path D) complete
#
# Usage:
#   bash scripts/deploy-code.sh <password>
#
#   password   sudo password for the footbag account on the staging host
#
# Override the SSH config alias:
#   DEPLOY_TARGET=footbag-staging bash scripts/deploy-code.sh <password>
#
# Always preserves:
#   /srv/footbag/env
#   /srv/footbag/footbag.db (and any DB at FOOTBAG_DB_PATH)

set -euo pipefail

# ── Args / help ───────────────────────────────────────────────────────────────

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy-code.sh <password>

  password   sudo password for the footbag account on the staging host

Override the SSH target:
  DEPLOY_TARGET=footbag-staging bash scripts/deploy-code.sh <password>
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

FOOTBAG_PASS="$1"

# Shell-quote the password for safe embedding in remote command strings.
# printf '%q' produces a bash-safe representation that the remote shell can
# evaluate without shell injection regardless of special characters in the password.
PASS_Q=$(printf '%q' "$FOOTBAG_PASS")

REMOTE="${DEPLOY_TARGET:-footbag-staging}"
HOST_IP=$(ssh -G "$REMOTE" | awk '/^hostname / {print $2}')

# ── Pre-flight ────────────────────────────────────────────────────────────────

echo "==> Deploy target: $REMOTE ($HOST_IP)"
echo "==> Confirming SSH connectivity..."
ssh "$REMOTE" "echo '    SSH OK'"

# ── Step 1: Prepare upload directory ─────────────────────────────────────────

echo "==> Preparing remote upload directory..."
ssh "$REMOTE" "rm -rf ~/footbag-release && mkdir -p ~/footbag-release"

# ── Step 2: Rsync deployable files (code only, no database) ──────────────────

echo "==> Rsyncing source to host (code only, no database)..."

rsync -av --delete -e "ssh" \
  --include='/.dockerignore' \
  --include='/docker/***' \
  --include='/src/***' \
  --include='/ops/***' \
  --include='/package.json' \
  --include='/package-lock.json' \
  --include='/tsconfig.json' \
  --exclude='*' \
  ./ "$REMOTE:~/footbag-release/"

# ── Step 3: Promote to /srv/footbag (always preserves env and live DB) ────────

echo "==> Promoting release (env and live DB preserved)..."
ssh "$REMOTE" "
  printf '%s\n' $PASS_Q | sudo -S -p '' rsync -a --delete --exclude env --exclude footbag.db --exclude media ~/footbag-release/ /srv/footbag/
  printf '%s\n' $PASS_Q | sudo -S -p '' chown -R root:root /srv/footbag
"

# ── Step 4: Reinstall systemd service unit ───────────────────────────────────

echo "==> Reinstalling service unit..."
ssh "$REMOTE" "
  printf '%s\n' $PASS_Q | sudo -S -p '' cp /srv/footbag/ops/systemd/footbag.service /etc/systemd/system/
  printf '%s\n' $PASS_Q | sudo -S -p '' systemctl daemon-reload
"

# ── Step 5: Rebuild images on host ───────────────────────────────────────────

echo "==> Building Docker images (this takes a minute)..."
ssh "$REMOTE" "
  cd /srv/footbag
  printf '%s\n' $PASS_Q | sudo -S -p '' docker compose \
    --env-file /srv/footbag/env \
    -f docker/docker-compose.yml \
    -f docker/docker-compose.prod.yml \
    build
"

# ── Step 6: Restart service ───────────────────────────────────────────────────

echo "==> Restarting service..."
ssh "$REMOTE" "
  printf '%s\n' $PASS_Q | sudo -S -p '' systemctl restart footbag
  sleep 3
  printf '%s\n' $PASS_Q | sudo -S -p '' systemctl status footbag --no-pager -l
"

# ── Step 7: Smoke check ───────────────────────────────────────────────────────

echo "==> Running smoke check against http://$HOST_IP ..."
BASE_URL="http://$HOST_IP" bash scripts/smoke-local.sh

echo ""
echo "Deploy complete. Origin: http://$HOST_IP"
