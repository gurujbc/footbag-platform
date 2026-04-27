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
# Reads sudo password from stdin (line 1). Run via:
#   bash deploy_to_aws.sh --code-only
# or invoke directly with stdin redirected:
#   < <operator credential file> bash scripts/deploy-code.sh
#
# Override the SSH config alias:
#   DEPLOY_TARGET=footbag-staging ...
#
# Skip the post-deploy direct-IP smoke check (required when nginx X-Origin-Verify
# enforcement is active, since direct-to-origin curls return 444):
#   SKIP_SMOKE=yes ...
#
# Always preserves:
#   /srv/footbag/env
#   /srv/footbag/footbag.db (and any DB at FOOTBAG_DB_PATH)

set -euo pipefail

# ── Args / help ───────────────────────────────────────────────────────────────

usage() {
  cat <<'EOF'
Usage: bash deploy_to_aws.sh --code-only
   or: < <operator credential file> bash scripts/deploy-code.sh

Reads sudo password from stdin (line 1).

Override the SSH target:
  DEPLOY_TARGET=footbag-staging ...

Skip post-deploy direct-IP smoke check:
  SKIP_SMOKE=yes ...
EOF
}

if [[ -t 0 ]]; then
  echo "ERROR: must receive sudo password on stdin." >&2
  echo "       Run via: bash deploy_to_aws.sh --code-only" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

# Consume the password from stdin into a shell variable. This deploy needs to
# feed the password to two separate ssh+sudo invocations (image-load and
# remote-half-execute), which can't share a single stdin pipe. The variable
# is emitted to each ssh via `printf` (a bash builtin: no fork, no argv leak).
# The password is never placed on any process's argv. Same-uid memory access
# (ptrace, gcore) remains a pre-existing risk independent of this convention.
IFS= read -r SUDO_PASS

REMOTE="${DEPLOY_TARGET:-footbag-staging}"
SKIP_SMOKE="${SKIP_SMOKE:-no}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REMOTE_HALF="${SCRIPT_DIR}/internal/deploy-code-remote.sh"

# SSH connection options. accept-new pins the host key on first contact; later
# connections fail-closed if the host key changes (MITM / instance rotation
# without known_hosts cleanup). ConnectTimeout fails fast on dead targets.
# ServerAliveInterval keeps the long-running cat-pipe and docker-save streams
# alive across NAT/idle timeouts. These options apply to every ssh and rsync-
# over-ssh invocation; see scripts/deploy-rebuild.sh for the parallel set.
SSH_OPTS=(-o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10" -o "ServerAliveInterval=30")

# Derive FOOTBAG_ENV from the SSH alias so the remote-half can read the right
# /footbag/{env}/secrets/origin_verify_secret SSM parameter without the
# operator having to hand-edit /srv/footbag/env. Convention: ssh alias is
# `footbag-staging` or `footbag-production`. The remote-half writes this value
# into /srv/footbag/env if absent and fails fast if a different value is
# already present (catches a wrong DEPLOY_TARGET pointed at the wrong host).
case "$REMOTE" in
  *production*|*-prod) FOOTBAG_ENV="production" ;;
  *staging*)           FOOTBAG_ENV="staging"    ;;
  *)
    echo "ERROR: cannot derive FOOTBAG_ENV from REMOTE='$REMOTE'." >&2
    echo "       Expected an alias containing 'staging' or 'production'." >&2
    exit 1
    ;;
esac

[[ -r "$REMOTE_HALF" ]] || { echo "ERROR: missing remote-half: $REMOTE_HALF" >&2; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker required locally for image build" >&2; exit 1; }

HOST_IP=$(ssh -G "$REMOTE" | awk '/^hostname / {print $2}')

# ── Pre-flight ────────────────────────────────────────────────────────────────

echo "==> Deploy target: $REMOTE ($HOST_IP)"
echo "==> Confirming SSH connectivity..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "echo '    SSH OK'" </dev/null

# ── Step 1: Prepare upload directory ─────────────────────────────────────────

echo "==> Preparing remote upload directory..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -rf ~/footbag-release && mkdir -p ~/footbag-release" </dev/null

# ── Step 2: Rsync deployable files (code only, no database) ──────────────────

echo "==> Rsyncing source to host (code only, no database)..."

rsync -av --delete -e "ssh ${SSH_OPTS[*]}" \
  --include='/.dockerignore' \
  --include='/docker/***' \
  --include='/src/***' \
  --include='/ops/***' \
  --include='/package.json' \
  --include='/package-lock.json' \
  --include='/tsconfig.json' \
  --exclude='*' \
  ./ "$REMOTE:~/footbag-release/" </dev/null

# ── Step 3: Build images locally (workstation, where memory is plentiful) ────
# The host (Lightsail nano_3_0, 512 MB) cannot fit a parallel npm ci build;
# any boot-time or deploy-time `compose build` on the host OOMs and wedges
# sshd. The workstation has more RAM than any reasonable Lightsail bundle,
# so building here is safer and faster.

echo "==> Building Docker images locally (workstation)..."
# Build with the base compose only. The prod overlay is runtime-only (mounts,
# memory limits, env that lives in /srv/footbag/env on the host) and would
# fail interpolation here on the workstation. Image content is identical.
( cd "$REPO_ROOT" && docker compose \
    -f docker/docker-compose.yml \
    build )

# Capture layer DiffIDs (RootFS.Layers) for end-to-end integrity verification:
# the remote-half inspects the loaded images and exits non-zero if either layer
# list does not match. Defends against a corrupted docker save | ssh |
# docker load pipe (network truncation, host docker daemon mid-deploy, or
# workstation registry tampering between build and save). DiffIDs are sha256
# of the uncompressed layer tars and survive save/load regardless of daemon
# version skew between workstation and host. .Id is fragile because each
# daemon may re-serialize the image config JSON, producing a benign hash
# difference on identical content.
WEB_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-web 2>/dev/null) || {
  echo "ERROR: docker image inspect failed for docker-web (build did not produce expected image)" >&2
  exit 1
}
WORKER_IMAGE_LAYERS=$(docker image inspect --format='{{range .RootFS.Layers}}{{.}} {{end}}' docker-worker 2>/dev/null) || {
  echo "ERROR: docker image inspect failed for docker-worker" >&2
  exit 1
}

# ── Step 4: Transfer images to host via docker save | docker load ────────────
# Local docker save streams a tar of the just-built images. The leading printf
# emits the sudo password on stdin's first line; sudo -S consumes it, then
# `docker load` reads the tar bytes that follow.

echo "==> Transferring images to host (docker save | docker load)..."
{ printf '%s\n' "$SUDO_PASS"; docker save docker-web docker-worker; } \
  | ssh "${SSH_OPTS[@]}" "$REMOTE" 'sudo -S -p "" docker load'

# ── Step 5: Run the remote-as-root deploy via cat-pipe ───────────────────────
# printf emits the password line; the EXPECTED_*_IMAGE_LAYERS assignments give
# the remote-half the layer DiffIDs to verify against the docker-loaded images;
# cat appends the remote-half script body. ssh stdin = password + assignments +
# body. sudo -S consumes the password; bash inherits the rest and runs as
# root. Argv on every hop stays free of secrets. Layer DiffIDs are
# space-separated sha256:[0-9a-f]{64} tokens and contain no shell metacharacters.

echo "==> Running remote-as-root deploy (promote, restart)..."
{
  printf '%s\n' "$SUDO_PASS"
  printf 'EXPECTED_WEB_IMAGE_LAYERS=%q\n'    "$WEB_IMAGE_LAYERS"
  printf 'EXPECTED_WORKER_IMAGE_LAYERS=%q\n' "$WORKER_IMAGE_LAYERS"
  printf 'FOOTBAG_ENV=%q\n'                  "$FOOTBAG_ENV"
  cat "$REMOTE_HALF"
} | ssh "${SSH_OPTS[@]}" "$REMOTE" 'sudo -S -p "" bash'

# ── Step 4: Smoke check ───────────────────────────────────────────────────────

if [[ "$SKIP_SMOKE" == "yes" ]]; then
  echo "==> Skipping post-deploy smoke check (SKIP_SMOKE=yes)"
else
  echo "==> Running smoke check against http://$HOST_IP ..."
  BASE_URL="http://$HOST_IP" bash scripts/smoke-local.sh
fi

echo ""
echo "Deploy complete. Origin: http://$HOST_IP"
