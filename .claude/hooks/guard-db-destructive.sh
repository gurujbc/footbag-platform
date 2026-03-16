#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

[ -n "$COMMAND" ] || exit 0

if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])(\./)?scripts/reset-local-db\.sh([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Destructive database reset detected. Confirm data-loss intent before proceeding."
    }
  }'
  exit 0
fi

if printf '%s' "$COMMAND" | grep -Eq 'rm[[:space:]].*(footbag\.db|\.db-wal|\.db-shm)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "SQLite file deletion detected. Confirm before proceeding."
    }
  }'
  exit 0
fi

# Note: this pattern only fires when destructive SQL appears inline in the same command as sqlite3.
# It does not catch piped SQL (e.g. echo "DROP TABLE..." | sqlite3 footbag.db).
if printf '%s' "$COMMAND" | grep -Eqi 'sqlite3.*(DROP[[:space:]]+TABLE|DROP[[:space:]]+INDEX|DELETE[[:space:]]+FROM|TRUNCATE|ALTER[[:space:]]+TABLE.*DROP)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Potentially destructive inline SQLite command detected. Confirm before proceeding."
    }
  }'
  exit 0
fi
