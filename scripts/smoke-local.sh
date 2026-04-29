#!/usr/bin/env bash
# smoke-local.sh
# Quick end-to-end smoke check against a running local server.
#
# Usage:
#   # Against npm run dev (port 3000):
#   ./scripts/smoke-local.sh
#
#   # Against Docker Compose stack (port 80). Bring the stack up in another
#   # terminal first with `npm run compose:dev` (auto-teardown on Ctrl+C):
#   BASE_URL=http://localhost ./scripts/smoke-local.sh
#
# Exits 0 if all checks pass, 1 if any fail.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local expected="$2"
  local url="$3"

  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${BASE_URL}${url}")

  if [ "$actual" = "$expected" ]; then
    echo "  ✓  ${label} (${actual})"
    PASS=$((PASS + 1))
  else
    echo "  ✗  ${label} — expected ${expected}, got ${actual}  [${url}]"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke check: ${BASE_URL}"
echo "────────────────────────────────────────"

# ── Health ────────────────────────────────────────────────────────────────────
check "GET /health/live"                  200 "/health/live"
check "GET /health/ready"                 200 "/health/ready"

# ── Public site shell ─────────────────────────────────────────────────────────
check "GET / (home)"                      200 "/"
check "GET /clubs (clubs placeholder)"    200 "/clubs"

# ── Events landing ────────────────────────────────────────────────────────────
check "GET /events (landing page)"        200 "/events"

# ── Year archive ──────────────────────────────────────────────────────────────
check "GET /events/year/2025 (seeded year)"  200 "/events/year/2025"
check "GET /events/year/1899 (empty year)"   200 "/events/year/1899"

# ── Event detail — must 404 ───────────────────────────────────────────────────
check "GET /events/event_2026_draft_event (draft → 404)"         404 "/events/event_2026_draft_event"
check "GET /events/event_9999_does_not_exist (missing → 404)"    404 "/events/event_9999_does_not_exist"
check "GET /events/not-a-valid-key (bad format → 404)"           404 "/events/not-a-valid-key"

# ── Route ordering guard ──────────────────────────────────────────────────────
# Verifies /events/year/:year is matched before /events/:eventKey
check "GET /events/year/2025 routes to year page, not eventKey"  200 "/events/year/2025"

echo "────────────────────────────────────────"
echo "  Passed: ${PASS}   Failed: ${FAIL}"

if [ "$FAIL" -gt 0 ]; then
  echo "SMOKE CHECK FAILED"
  exit 1
else
  echo "SMOKE CHECK PASSED"
  exit 0
fi
