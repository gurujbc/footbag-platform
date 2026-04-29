#!/usr/bin/env bash
# compose-dev.sh -- bring up the local four-container stack (nginx + web +
# worker + image) in the foreground; tear it down automatically on Ctrl+C,
# script exit, or crash. Operator runs ONE command and the whole lifecycle
# is handled.
#
# Usage:  npm run compose:dev
#    or:  bash scripts/compose-dev.sh
#
# For interactive testing against the running stack (curl, browser, smoke
# checks), open a second terminal -- this script's terminal is held by
# Compose's foreground log stream until the operator hits Ctrl+C.
#
# Signal handling: docker compose runs as a backgrounded child whose PID
# we capture, so signals received by this script are explicitly forwarded
# to it. Without forwarding, an external `kill -INT $script_pid` reaches
# bash but never reaches the compose child (different process groups),
# leaving containers running. Terminal Ctrl+C reaches the whole foreground
# group and works either way; this design also handles the external-kill
# case so the no-remembered-side-commands contract holds in any usage.
#
# Note on -e: deliberately omitted. set -e + a long-running foreground
# command + signal-driven exit can race against the EXIT trap (cleanup
# bails on the first transient compose warning). Cleanup must always
# complete to honor the no-remembered-side-commands contract.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: project-root .env is missing." >&2
  echo "       Copy .env.example -> .env and fill in SESSION_SECRET (32+ chars," >&2
  echo "       no 'changeme') before running this script." >&2
  exit 1
fi

COMPOSE_ARGS=(--env-file .env -f docker/docker-compose.yml)
COMPOSE_PID=""

forward_signal() {
  local sig="$1"
  if [[ -n "$COMPOSE_PID" ]] && kill -0 "$COMPOSE_PID" 2>/dev/null; then
    echo
    echo "==> Caught SIG$sig; forwarding to compose..."
    kill "-$sig" "$COMPOSE_PID" 2>/dev/null || true
  fi
}

cleanup() {
  # Disarm further signals during cleanup so a doubled Ctrl+C cannot leave
  # the stack half-stopped.
  trap '' INT TERM EXIT
  echo
  echo "==> Tearing down compose stack..."
  # --timeout bounds the graceful-stop wait; --remove-orphans cleans up
  # services renamed/removed since last up. `|| true` prevents a transient
  # compose error (already-gone container, race with the up child) from
  # aborting cleanup.
  docker compose "${COMPOSE_ARGS[@]}" down --remove-orphans --timeout 10 || true
}

trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM
trap cleanup EXIT

echo "==> Bringing up four-container stack (Ctrl+C to stop and clean up)..."
docker compose "${COMPOSE_ARGS[@]}" up --build &
COMPOSE_PID=$!

# Loop-wait: bash's `wait` returns early when a trap fires (returns >128).
# After the trap forwards the signal to compose, compose still needs time
# to gracefully stop containers; keep waiting until compose actually exits.
while kill -0 "$COMPOSE_PID" 2>/dev/null; do
  wait "$COMPOSE_PID" 2>/dev/null || true
done
