#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')"

[ -n "$FILE_PATH" ] || exit 0
[ -n "${CLAUDE_PROJECT_DIR:-}" ] || exit 0

case "$FILE_PATH" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

RELATIVE_PATH="${FILE_PATH#"$CLAUDE_PROJECT_DIR"/}"

case "$RELATIVE_PATH" in
  .env|.env.*|*.pem|*.key|*.p12|*.pfx|*.crt|*.cer|secrets/*|.secrets/*|.claude/settings.local.json)
    jq -n --arg file "$RELATIVE_PATH" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("HARD BLOCK: Claude must never edit secret-bearing or private-local files.\nFile: " + $file)
      }
    }'
    ;;
  *)
    ;;
esac
