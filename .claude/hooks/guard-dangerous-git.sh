#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

[ -n "$COMMAND" ] || exit 0

if printf '%s' "$COMMAND" | grep -Eq 'git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+clean[[:space:]].*-[a-zA-Z]*f|git[[:space:]]+checkout[[:space:]]+--|git[[:space:]]+restore([[:space:]]|$)|git[[:space:]]+branch[[:space:]]+-D'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Potentially destructive git command detected. Confirm before discarding work."
    }
  }'
  exit 0
fi
