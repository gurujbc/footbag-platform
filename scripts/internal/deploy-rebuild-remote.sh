#!/usr/bin/env bash
# Root-side body of scripts/deploy-rebuild.sh.
#
# Invoked via:
#   cat - scripts/internal/deploy-rebuild-remote.sh | ssh REMOTE 'sudo -S -p "" bash'
#
# Runs as root for the full body; commands are bare (no per-line sudo).
#
# DESTRUCTIVE: replaces the live SQLite database with the rsync'd copy in
# $RELEASE_DIR. Caller is responsible for ensuring the rebuilt local DB is
# what should land on the host.

set -euo pipefail

LIVE_DIR=/srv/footbag
ENV_PATH=/srv/footbag/env
RELEASE_DIR=/home/footbag/footbag-release
NEW_DB="$RELEASE_DIR/database/footbag.db"

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
  value=$(awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print}' "$ENV_PATH" | tail -1)
  if [[ -z "$value" ]]; then
    echo "Missing required env var in $ENV_PATH: $key" >&2
    exit 1
  fi
  printf '%s' "$value"
}

compose_cmd() {
  docker compose \
    --env-file "$ENV_PATH" \
    -f "$LIVE_DIR/docker/docker-compose.yml" \
    -f "$LIVE_DIR/docker/docker-compose.prod.yml" \
    "$@"
}

dump_diagnostics() {
  echo "    ---- systemctl status footbag.service ----" >&2
  systemctl status footbag.service --no-pager -l || true

  echo "    ---- journalctl -u footbag.service -n 100 ----" >&2
  journalctl -u footbag.service -n 100 --no-pager || true

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
command -v docker >/dev/null  || { echo "docker missing on host"  >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemctl missing on host" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 missing on host" >&2; exit 1; }
command -v awk >/dev/null     || { echo "awk missing on host"     >&2; exit 1; }
command -v rsync >/dev/null   || { echo "rsync missing on host"   >&2; exit 1; }

# Disk-space preflight: rsync of release dir + DB replace + docker layer churn
# can land 200-400 MB at peak. Refuse to start if /srv/footbag has under 500 MB
# free; the partial-write failure mode is silent corruption of footbag.db.
SRV_AVAIL_KB=$(df -k --output=avail /srv/footbag 2>/dev/null | tail -1 | tr -d ' ')
if [[ -n "$SRV_AVAIL_KB" ]] && (( SRV_AVAIL_KB < 512000 )); then
  echo "ERROR: /srv/footbag has only ${SRV_AVAIL_KB}K free; need >=500 MB." >&2
  echo "Recommendation: ssh ${DEPLOY_TARGET:-<deploy host>} 'sudo journalctl --vacuum-time=7d; sudo docker system prune -af'" >&2
  exit 1
fi

require_path "release dir"        "$RELEASE_DIR"
require_path "env file"           "$ENV_PATH"
require_path "uploaded DB"        "$NEW_DB"
require_path "service unit source" "$RELEASE_DIR/ops/systemd/footbag.service"
require_path "compose file"        "$RELEASE_DIR/docker/docker-compose.yml"
require_path "compose prod file"   "$RELEASE_DIR/docker/docker-compose.prod.yml"

# Runtime AWS credential files must exist on the host for the source-profile +
# AssumeRole chain. Without these the app cannot assume the runtime role and
# KMS Sign / SES Send fail at request time.
test -f /root/.aws/credentials || { echo "Missing /root/.aws/credentials on the host" >&2; exit 1; }
test -f /root/.aws/config       || { echo "Missing /root/.aws/config on the host"      >&2; exit 1; }

# Assert /srv/footbag/env is owned by root with mode 0600. This file holds
# SESSION_SECRET, the SSM-mirrored X_ORIGIN_VERIFY_SECRET, and AWS profile
# config; a 0644 / non-root state is a credential exposure (a non-root user
# on the host or any local-file-disclosure bug in another service can read
# them). Fail-closed at deploy time so the operator notices and fixes.
ENV_PERMS=$(stat -c '%U:%G %a' "$ENV_PATH")
if [[ "$ENV_PERMS" != "root:root 600" ]]; then
  echo "ERROR: $ENV_PATH has wrong ownership/mode: '$ENV_PERMS' (expected 'root:root 600')" >&2
  echo "       Fix with:  sudo chown root:root $ENV_PATH && sudo chmod 600 $ENV_PATH" >&2
  exit 1
fi

# Verify the docker-loaded images match what the workstation built. The
# preceding `docker save | ssh | docker load` step is the only path images
# enter the host; a layer mismatch means corruption in the pipe (network
# truncation, host docker daemon mid-deploy, or workstation registry tampering
# between build and save). Fail before promoting the release. Compare
# RootFS.Layers (DiffIDs = sha256 of uncompressed layer tars) rather than .Id;
# DiffIDs survive save/load regardless of daemon version skew, while .Id is a
# hash of the image config JSON that each daemon may re-serialize differently.
: "${EXPECTED_WEB_IMAGE_LAYERS:?must be set by deploy-rebuild.sh via cat-pipe}"
: "${EXPECTED_WORKER_IMAGE_LAYERS:?must be set by deploy-rebuild.sh via cat-pipe}"
: "${EXPECTED_IMAGE_IMAGE_LAYERS:?must be set by deploy-rebuild.sh via cat-pipe}"
ACTUAL_WEB_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-web 2>/dev/null || true)
ACTUAL_WORKER_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-worker 2>/dev/null || true)
ACTUAL_IMAGE_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-image 2>/dev/null || true)
if [[ "$ACTUAL_WEB_IMAGE_LAYERS" != "$EXPECTED_WEB_IMAGE_LAYERS" ]]; then
  echo "ERROR: docker-web layer mismatch after load" >&2
  echo "       expected: $EXPECTED_WEB_IMAGE_LAYERS" >&2
  echo "       actual:   $ACTUAL_WEB_IMAGE_LAYERS" >&2
  exit 1
fi
if [[ "$ACTUAL_WORKER_IMAGE_LAYERS" != "$EXPECTED_WORKER_IMAGE_LAYERS" ]]; then
  echo "ERROR: docker-worker layer mismatch after load" >&2
  echo "       expected: $EXPECTED_WORKER_IMAGE_LAYERS" >&2
  echo "       actual:   $ACTUAL_WORKER_IMAGE_LAYERS" >&2
  exit 1
fi
if [[ "$ACTUAL_IMAGE_IMAGE_LAYERS" != "$EXPECTED_IMAGE_IMAGE_LAYERS" ]]; then
  echo "ERROR: docker-image layer mismatch after load" >&2
  echo "       expected: $EXPECTED_IMAGE_IMAGE_LAYERS" >&2
  echo "       actual:   $ACTUAL_IMAGE_IMAGE_LAYERS" >&2
  exit 1
fi

# Reconcile FOOTBAG_ENV passed by the workstation against /srv/footbag/env.
# Workstation derives the value from the SSH alias; this is the canonical
# source. If the env file lacks the line, append it. If it has a different
# value, fail (catches a wrong DEPLOY_TARGET pointed at the wrong host;
# preserves operator-set values from never silently overwriting).
: "${FOOTBAG_ENV:?must be set by deploy-rebuild.sh via cat-pipe}"
EXISTING_FOOTBAG_ENV=$(awk -F= '$1=="FOOTBAG_ENV" {sub(/^[^=]*=/,""); print}' "$ENV_PATH" | tail -1)
if [[ -z "$EXISTING_FOOTBAG_ENV" ]]; then
  echo "    Adding FOOTBAG_ENV=$FOOTBAG_ENV to $ENV_PATH ..."
  env_tmp=$(mktemp /srv/footbag/.env.tmp.XXXXXX)
  chmod 600 "$env_tmp"
  chown root:root "$env_tmp"
  cp "$ENV_PATH" "$env_tmp"
  printf 'FOOTBAG_ENV=%s\n' "$FOOTBAG_ENV" >> "$env_tmp"
  mv "$env_tmp" "$ENV_PATH"
elif [[ "$EXISTING_FOOTBAG_ENV" != "$FOOTBAG_ENV" ]]; then
  echo "ERROR: $ENV_PATH has FOOTBAG_ENV='$EXISTING_FOOTBAG_ENV' but workstation expects '$FOOTBAG_ENV'." >&2
  echo "       Likely a wrong DEPLOY_TARGET. Reconcile manually before deploying." >&2
  exit 1
fi

# One-shot migration: directory-mount DB layout
if grep -q '^FOOTBAG_DB_PATH=/srv/footbag/footbag.db$' "$ENV_PATH"; then
  echo "    Migrating env file to directory-mount DB layout..."
  sed -i.bak \
    -e 's|^FOOTBAG_DB_PATH=/srv/footbag/footbag.db$|FOOTBAG_DB_PATH=/srv/footbag/db/footbag.db|' \
    "$ENV_PATH"
  if ! grep -q '^FOOTBAG_DB_DIR=' "$ENV_PATH"; then
    echo 'FOOTBAG_DB_DIR=/srv/footbag/db' >> "$ENV_PATH"
  fi
  rm -f /srv/footbag/footbag.db /srv/footbag/footbag.db-wal /srv/footbag/footbag.db-shm
fi

# One-shot migration: SES_SANDBOX_MODE seed
if ! grep -q '^SES_SANDBOX_MODE=' "$ENV_PATH"; then
  echo "    Seeding SES_SANDBOX_MODE=1 into env file (staging sandbox default)..."
  echo 'SES_SANDBOX_MODE=1' >> "$ENV_PATH"
fi

NODE_ENV_VAL=$(require_env NODE_ENV)
LOG_LEVEL_VAL=$(require_env LOG_LEVEL)
DB_PATH=$(require_env FOOTBAG_DB_PATH)
PUBLIC_BASE_URL_VAL=$(require_env PUBLIC_BASE_URL)
SESSION_SECRET_VAL=$(require_env SESSION_SECRET)
JWT_SIGNER_VAL=$(require_env JWT_SIGNER)
JWT_KMS_KEY_ID_VAL=$(require_env JWT_KMS_KEY_ID)
SES_ADAPTER_VAL=$(require_env SES_ADAPTER)
SES_FROM_IDENTITY_VAL=$(require_env SES_FROM_IDENTITY)
SES_SANDBOX_MODE_VAL=$(require_env SES_SANDBOX_MODE)
AWS_REGION_VAL=$(require_env AWS_REGION)
AWS_PROFILE_VAL=$(require_env AWS_PROFILE)
FOOTBAG_ENV_VAL=$(require_env FOOTBAG_ENV)

# Defense-in-depth refuse-check (workstation half also gates this). The
# script auto-wipes the S3 media bucket on staging by default; on non-
# staging environments the operator must pass --keep-media to opt out of
# the wipe. Production media wipes are an out-of-band operator procedure.
: "${KEEP_MEDIA:?must be set by deploy-rebuild.sh via cat-pipe}"
if [[ "$FOOTBAG_ENV_VAL" != "staging" && "$KEEP_MEDIA" != "yes" ]]; then
  echo "ERROR: refusing to auto-wipe S3 media on FOOTBAG_ENV=$FOOTBAG_ENV_VAL." >&2
  echo "       Pass --keep-media to rebuild the DB without touching S3." >&2
  echo "       Wiping non-staging media is out-of-band; see DEVOPS_GUIDE." >&2
  exit 1
fi

# Sync X_ORIGIN_VERIFY_SECRET from SSM to /srv/footbag/env. Both the value
# CloudFront injects (via data.aws_ssm_parameter.origin_verify_secret) and the
# value nginx compares against (rendered into /etc/nginx/nginx.conf by
# docker/nginx/40-render-nginx-conf.sh) must agree, or every CloudFront request
# 444s. The canonical value is generated by the Terraform random_id resource
# in terraform/{staging,production}/ssm.tf; this fetch keeps the host env
# in sync after a `terraform apply -replace=random_id.origin_verify_secret`.
# IAM: AWS_PROFILE source-profile AssumeRoles into app_runtime which holds
# ssm:GetParameter on /footbag/{env}/* and kms:Decrypt on the main key.
ssm_origin_param="/footbag/${FOOTBAG_ENV_VAL}/secrets/origin_verify_secret"
echo "    Syncing X_ORIGIN_VERIFY_SECRET from $ssm_origin_param ..."
ORIGIN_VERIFY_SECRET_VAL=$(
  AWS_PROFILE="$AWS_PROFILE_VAL" aws ssm get-parameter \
    --region "$AWS_REGION_VAL" \
    --name "$ssm_origin_param" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text
) || { echo "ERROR: aws ssm get-parameter failed for $ssm_origin_param" >&2; exit 1; }

# Shape check mirrors docker/nginx/40-render-nginx-conf.sh.
if [[ ! "$ORIGIN_VERIFY_SECRET_VAL" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: SSM $ssm_origin_param is not 64 lowercase hex chars (got ${#ORIGIN_VERIFY_SECRET_VAL} chars)." >&2
  if [[ "$ORIGIN_VERIFY_SECRET_VAL" == TODO-* ]]; then
    echo "       SSM still has the bootstrap placeholder. From the workstation run:" >&2
    echo "         cd terraform/${FOOTBAG_ENV_VAL} && terraform init -upgrade && terraform apply" >&2
    echo "       This swaps the placeholder for a random_id-generated 64-hex value, then re-run this deploy." >&2
  fi
  exit 1
fi

env_tmp=$(mktemp /srv/footbag/.env.tmp.XXXXXX)
chmod 600 "$env_tmp"
chown root:root "$env_tmp"
grep -v '^X_ORIGIN_VERIFY_SECRET=' "$ENV_PATH" > "$env_tmp" || true
printf 'X_ORIGIN_VERIFY_SECRET=%s\n' "$ORIGIN_VERIFY_SECRET_VAL" >> "$env_tmp"
mv "$env_tmp" "$ENV_PATH"
chmod 600 "$ENV_PATH"
chown root:root "$ENV_PATH"
unset ORIGIN_VERIFY_SECRET_VAL

if [[ "$SESSION_SECRET_VAL" == *'#'* ]]; then
  echo "SESSION_SECRET contains '#' which breaks systemd EnvironmentFile parsing" >&2
  exit 1
fi

if [[ "${SESSION_SECRET_VAL,,}" == *changeme* ]]; then
  echo "SESSION_SECRET appears to be the .env.example placeholder ('changeme...'). Generate a fresh value with: openssl rand -hex 32" >&2
  exit 1
fi

if (( ${#SESSION_SECRET_VAL} < 32 )); then
  echo "SESSION_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32" >&2
  exit 1
fi

if [[ -z "$DB_PATH" || "$DB_PATH" == "/" ]]; then
  echo "Refusing to deploy with unsafe FOOTBAG_DB_PATH: '$DB_PATH'" >&2
  exit 1
fi

echo "    Runtime DB path from env: $DB_PATH"
echo "    WARNING: replacing host DB at $DB_PATH"

echo "    Stopping service..."
systemctl stop footbag || true

echo "    Ensuring compose stack is fully down..."
compose_cmd down --remove-orphans || true

# S3 media wipe (staging default; opt-out via --keep-media). Avatar S3
# keys are stable per member ID; on a fresh DB seed those IDs map to
# different people, so leaving old objects in place would serve the wrong
# person's photo at the new identity. Wipe the entire bucket so the
# rebuild is a true clean slate. The DR bucket auto-receives the delete
# markers via replication. CloudFront edge cache may continue serving
# previously-cached objects for up to 7 days under the /media/* TTL,
# which is acceptable on staging.
if [[ "$KEEP_MEDIA" == "yes" ]]; then
  echo "    --keep-media: skipping S3 media wipe."
else
  PHOTO_STORAGE_S3_BUCKET_VAL=$(require_env PHOTO_STORAGE_S3_BUCKET)
  echo "    Wiping s3://${PHOTO_STORAGE_S3_BUCKET_VAL}/ (staging default; pass --keep-media to skip)..."
  AWS_PROFILE="$AWS_PROFILE_VAL" aws s3 rm \
    --region "$AWS_REGION_VAL" \
    "s3://${PHOTO_STORAGE_S3_BUCKET_VAL}/" \
    --recursive
  echo "    S3 wipe complete; delete markers will replicate to DR bucket automatically."
fi

echo "    Promoting release into $LIVE_DIR ..."
rsync -a --delete --exclude=/env --exclude=/db --exclude=/media "$RELEASE_DIR/" "$LIVE_DIR/"

echo "    Replacing live DB..."
mkdir -p "$(dirname "$DB_PATH")"
# Remove the main DB plus any stale WAL/SHM sidecars. A stale -wal next to a
# fresh main file would shadow the new data on first open.
rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"
install -o root -g root -m 600 "$NEW_DB" "$DB_PATH"
chown -R root:root "$LIVE_DIR"

if ! test -f "$DB_PATH"; then
  echo "Expected SQLite file at $DB_PATH, but it is not a regular file" >&2
  exit 1
fi

echo "    Verifying copied DB on host..."
sqlite3 "$DB_PATH" 'PRAGMA integrity_check;' | grep -qx 'ok' || {
  echo "Copied DB failed integrity_check on host" >&2
  exit 1
}

echo "    Reinstalling service unit..."
cp "$LIVE_DIR/ops/systemd/footbag.service" /etc/systemd/system/
systemctl daemon-reload

# No host-side image build: the workstation builds + ships images via
# docker save | docker load before this remote-half runs.

echo "    Restarting service (compose up via systemctl, --no-build)..."
if ! systemctl restart footbag; then
  echo "    ERROR: footbag.service failed to restart. Dumping diagnostics..." >&2
  dump_diagnostics
  exit 1
fi

sleep 3
if ! systemctl is-active --quiet footbag.service; then
  echo "    ERROR: footbag.service is not active after restart. Dumping diagnostics..." >&2
  dump_diagnostics
  exit 1
fi

systemctl status footbag.service --no-pager -l
