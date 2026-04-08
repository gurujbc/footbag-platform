---
name: browser-qa
description: Browser automation for visual layout review or QA verification. Use only when the human explicitly names a page or check to run. Never run unsolicited or assume a broad test suite is wanted.
---

# Browser QA / Visual Layout

Use this skill only when the human explicitly asks to look at a page, check a layout, or verify rendered output. Do not run it speculatively, do not expand scope beyond what was named, and do not take screenshots unless specifically useful for the stated goal.

## Two modes

**Visual layout review** — human wants to see how a page looks and give feedback.
- Navigate to the named page, take one screenshot, report what is rendered.
- Do not run assertions or check the full VIEW_CATALOG contract unless asked.

**QA verification** — human wants to confirm specific behavior is correct.
- State exactly what will be checked before running anything.
- Only check the URLs and interactions the human named.
- Do not expand to adjacent pages or full test suites.

## Token discipline

- Use `mcp__playwright__browser_snapshot` (accessibility tree) for content/structure checks — cheaper than screenshots.
- Use `mcp__playwright__browser_take_screenshot` only when visual appearance is the explicit goal.
- Do not take multiple screenshots per page unless the human asks for it.
- Close the browser when done (`mcp__playwright__browser_close`).

## Screenshot file hygiene

**Never let screenshots land in the repo root.** `mcp__playwright__browser_take_screenshot` writes its `filename` argument relative to the current working directory, which is the repo root by default. A bare `filename: "events.png"` will pollute the project tree.

Rules:
- Always pass an explicit `filename` that points into `.playwright-mcp/` (already gitignored), e.g. `filename: ".playwright-mcp/events-desktop.png"`.
- After the requested check is reported, delete any screenshots created during the run unless the human explicitly asked to keep them.
- The repo root has a defensive `/*.png` rule in `.gitignore`, but do not rely on it. Place files correctly the first time.

## MCP tooling

Browser automation uses the **Playwright MCP server** via the `mcp__playwright__*` tools.
The configured browser is **Chromium** (isolated mode — `.claude/playwright/config.json`).

Minimal call sequence for layout review:
1. `mcp__playwright__browser_navigate` — load the named URL
2. `mcp__playwright__browser_take_screenshot` — one screenshot for visual feedback
3. `mcp__playwright__browser_close`

Minimal call sequence for content/behavior check:
1. `mcp__playwright__browser_navigate`
2. `mcp__playwright__browser_snapshot` — accessibility tree for assertions
3. `mcp__playwright__browser_console_messages` — only if JS errors are suspected
4. `mcp__playwright__browser_close`

## Procedure

1. Confirm with the human before running:
   - exact URL(s) to visit
   - what is being checked (layout, content, behavior)
   - target environment: local dev server (default port 3000), staging, or explicit URL

2. Run only what was confirmed. Do not add pages or checks.

3. For QA verification, check against the VIEW_CATALOG.md page contract only for the named page(s).

4. Do not claim browser verification unless it was actually executed.

5. Report concisely:
   - URL(s) visited
   - what was observed (screenshot inline or description)
   - any failures, mismatches, or JS console errors
