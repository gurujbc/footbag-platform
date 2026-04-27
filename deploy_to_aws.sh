#!/usr/bin/env bash
set -euo pipefail

# --help without requiring the AWS credential file to exist.
for arg in "$@"; do
  case "$arg" in
    --help|-h) exec bash scripts/deploy-to-aws.sh --help ;;
  esac
done

# No-arg invocation defaults to prior behavior: rebuild DB + push.
# Destructive to the staging DB. Same risk profile as before this change.
if [[ $# -eq 0 ]]; then
  set -- --with-db --db-only
fi

# Pipe the operator-secrets file to the orchestrator's stdin instead of
# passing as a positional arg. argv-leak hardening: the password never
# appears in any process's argv on the operator workstation.
exec bash scripts/deploy-to-aws.sh "$@" < ~/AWS/AWS_OPERATOR.txt
