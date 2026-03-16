---
name: browser-qa
description: Run browser-level verification for the public site when a human explicitly requests browser testing or rendered-page verification.
---

# Browser QA

Use this skill only when a human explicitly asks for browser testing or rendered-page verification.

## MCP tooling

Browser automation uses the **Playwright MCP server** via the `mcp__playwright__*` tools.
The configured browser is **Chromium** (isolated mode — `.claude/playwright/config.json`).

Typical call sequence:
1. `mcp__playwright__browser_navigate` — load the target URL
2. `mcp__playwright__browser_snapshot` — capture accessibility tree for assertions
3. `mcp__playwright__browser_take_screenshot` — visual record when useful
4. `mcp__playwright__browser_click` / `mcp__playwright__browser_fill_form` — interact as needed
5. `mcp__playwright__browser_console_messages` — check for JS errors

## Procedure

1. Confirm the target before starting:
   - local dev server (default port 3000)
   - staging CloudFront URL
   - other explicit URL provided by the human

2. State exactly what will be checked:
   - URLs
   - expected rendered content
   - navigation paths or interactions

3. Verify against the VIEW_CATALOG.md page contract for the affected page(s):
   - required primitives rendered (hero, nav, cards, etc.)
   - correct CSS classes present (§4.3 vocabulary)
   - empty states, error states, notice blocks as specified
   - no stack traces, SQL errors, or internal details exposed (§7.2)

4. Do not claim browser verification unless it was actually executed.

5. Report:
   - environment tested and exact URL(s)
   - actions taken
   - observed results vs. expected
   - failures or mismatches
   - any JS console errors
