#!/usr/bin/env bash
# install-cwagent-staging.sh
#
# Installs and configures the Amazon CloudWatch Agent on the staging
# Lightsail host. Idempotent: safe to re-run on an already-configured host.
#
# Reads sudo password from stdin (line 1) and pipes it through ssh stdin to
# remote sudo -S. The remote body lives in scripts/internal/install-cwagent-remote.sh
# and is cat'd into the same pipe (no scp; no host-side temp files; no copy
# of this script lives on the host).
#
# Prerequisites:
#   - ~/.ssh/config alias "footbag-staging" configured with User footbag
#   - terraform/staging applied (cloudwatch_publisher IAM user must exist)
#   - jq installed locally
#
# Usage:
#   1. Generate keys for the cwagent_publisher IAM user:
#      umask 077; aws iam create-access-key \
#        --user-name footbag-staging-cwagent-publisher > /tmp/cwagent-keys.json
#
#   2. Save AccessKeyId + SecretAccessKey from /tmp/cwagent-keys.json to
#      vault entry 'aws-footbag-staging-cwagent-publisher' (KeePassXC).
#
#   3. Run this script. Reads sudo password from stdin (line 1); the keys
#      file is the only positional arg:
#      < <operator credential file> bash scripts/install-cwagent-staging.sh /tmp/cwagent-keys.json
#
#   4. shred -u /tmp/cwagent-keys.json
#
# Override the SSH alias:
#   DEPLOY_TARGET=footbag-staging ...

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: < <operator credential file> bash scripts/install-cwagent-staging.sh <keys-file>

Reads sudo password from stdin (line 1).

  <keys-file>   path to JSON output from `aws iam create-access-key`
                for IAM user footbag-staging-cwagent-publisher

Override the SSH target:
  DEPLOY_TARGET=footbag-staging ...
EOF
}

if [[ -t 0 ]]; then
  echo "ERROR: must receive sudo password on stdin." >&2
  echo "       Run via: < <operator credential file> bash scripts/install-cwagent-staging.sh <keys-file>" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

KEYS_FILE="$1"
REMOTE="${DEPLOY_TARGET:-footbag-staging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_HALF="${SCRIPT_DIR}/internal/install-cwagent-remote.sh"

# SSH options: parallel to scripts/deploy-code.sh.
SSH_OPTS=(-o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10" -o "ServerAliveInterval=30")

[[ -r "$KEYS_FILE" ]]   || { echo "ERROR: cannot read keys file: $KEYS_FILE" >&2; exit 1; }
[[ -r "$REMOTE_HALF" ]] || { echo "ERROR: missing remote-half: $REMOTE_HALF" >&2; exit 1; }
command -v jq >/dev/null || { echo "ERROR: jq is required locally" >&2; exit 1; }

# Reject a world-readable keys file. The operator instructions above call out
# `umask 077` before `aws iam create-access-key`; this assertion catches the
# case where the umask was missed and the file was written 0644 (the default).
# Window between create-access-key and the operator's `shred -u` is when
# co-tenants on a shared workstation could read the SAK.
KEYS_PERMS=$(stat -c '%a' "$KEYS_FILE")
if [[ "$KEYS_PERMS" != "600" && "$KEYS_PERMS" != "400" ]]; then
  echo "ERROR: $KEYS_FILE has mode $KEYS_PERMS; expected 600 (or 400)." >&2
  echo "       Re-create with:  umask 077; aws iam create-access-key ... > $KEYS_FILE" >&2
  echo "       (and shred the current file: shred -u $KEYS_FILE)" >&2
  exit 1
fi

CWAGENT_AKID=$(jq -r '.AccessKey.AccessKeyId // empty' "$KEYS_FILE")
CWAGENT_SAK=$(jq -r '.AccessKey.SecretAccessKey // empty' "$KEYS_FILE")
if [[ -z "$CWAGENT_AKID" || -z "$CWAGENT_SAK" ]]; then
  echo "ERROR: $KEYS_FILE does not contain .AccessKey.AccessKeyId / .SecretAccessKey" >&2
  exit 1
fi

echo "==> Deploy target: $REMOTE"
ssh "${SSH_OPTS[@]}" "$REMOTE" "echo '    SSH OK'" </dev/null

echo "==> Running remote-as-root cwagent install via cat-pipe..."
# cat reads our stdin (password line, supplied by the wrapper or operator).
# printf lines emit shell-quoted variable assignments so the remote bash binds
# CWAGENT_AKID and CWAGENT_SAK before running the body. cat <body> appends
# the remote-half. Combined stream -> ssh stdin -> remote sudo -S consumes the
# password line -> bash inherits the rest, runs the assignments, then the body.
# Argv stays clean of secrets on every hop.
{
  cat
  printf 'CWAGENT_AKID=%q\n' "$CWAGENT_AKID"
  printf 'CWAGENT_SAK=%q\n' "$CWAGENT_SAK"
  cat "$REMOTE_HALF"
} | ssh "${SSH_OPTS[@]}" "$REMOTE" 'sudo -S -p "" bash'

echo
echo "CloudWatch Agent install complete on $REMOTE."
