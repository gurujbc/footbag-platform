#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

[ -n "$COMMAND" ] || exit 0

# find with -delete — a predicate that appears anywhere in the args,
# so a static Bash(find -delete:*) rule in settings.json cannot match it.
if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])find([[:space:]].*)?[[:space:]]-delete([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "find with -delete detected. Confirm before running."
    }
  }'
  exit 0
fi

# curl with state-changing HTTP methods — -X POST/PUT/DELETE/PATCH can appear
# anywhere in a long curl invocation, so again not expressible as a static rule.
if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])curl([[:space:]].*)?[[:space:]](-X[[:space:]]+(POST|PUT|DELETE|PATCH)|--request[[:space:]]+(POST|PUT|DELETE|PATCH))([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "curl with mutating HTTP method detected. Confirm before sending."
    }
  }'
  exit 0
fi

# curl writing a file or uploading data — -o/-d/-F/-T flags can appear anywhere.
if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])curl([[:space:]].*)?[[:space:]](-o|--output|-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file)([[:space:]]|$)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "curl with file-write or request-body flag detected. Confirm before running."
    }
  }'
  exit 0
fi

# Output redirection from a read-only inspector creates or truncates files.
if printf '%s' "$COMMAND" | grep -Eq '(^|[;&|[:space:]])(cat|grep|rg|head|tail|find|ls|tree|stat|file|wc)([[:space:]][^|;&]*)?[[:space:]]>{1,2}[[:space:]]'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Shell output redirection (>, >>) from a read-only command would write a file. Confirm before running."
    }
  }'
  exit 0
fi
