#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

[ -n "$COMMAND" ] || exit 0

if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])terraform([[:space:]].*)?(apply|destroy|import|state[[:space:]]+rm|taint|untaint)([[:space:]]|$)' \
  && printf '%s' "$COMMAND" | grep -Eq '(terraform/production|(^|[[:space:]])production([[:space:]/_-]|$))'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Production/infrastructure mutation command detected. Require explicit human confirmation."
    }
  }'
  exit 0
fi

if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])(sudo[[:space:]]+)?systemctl[[:space:]]+(start|stop|restart)[[:space:]]+footbag([.]service)?([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Potential live service mutation detected. Require explicit human confirmation."
    }
  }'
  exit 0
fi
