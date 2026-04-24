#!/usr/bin/env bash
set -euo pipefail

# --help without requiring the AWS credential file to exist.
for arg in "$@"; do
  case "$arg" in
    --help|-h) exec bash scripts/deploy-to-aws.sh --help ;;
  esac
done

PASS="$(< ~/AWS/AWS_OPERATOR.txt)"

# No-arg invocation defaults to prior behavior: rebuild DB + push.
# Destructive to the staging DB. Same risk profile as before this change.
if [[ $# -eq 0 ]]; then
  exec bash scripts/deploy-to-aws.sh "$PASS" --with-db --db-only
fi

exec bash scripts/deploy-to-aws.sh "$PASS" "$@"
