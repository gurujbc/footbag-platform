---
name: browser-qa
description: Run browser-level verification for the public site when a human explicitly requests browser testing or rendered-page verification.
---

# Browser QA

Use this skill only when a human explicitly asks for browser testing or rendered-page verification.

1. Confirm the target:
   - local dev server
   - staging
   - deployed public URL

2. State exactly what will be checked:
   - URLs
   - expected behaviors
   - rendered content or navigation assertions

3. Do not claim browser verification unless it was actually executed.

4. Report:
   - environment tested
   - exact URLs checked
   - actions taken
   - observed results
   - failures or mismatches

5. Prefer low-cost verification first. Do not invoke MCP/browser automation unless explicitly requested.
