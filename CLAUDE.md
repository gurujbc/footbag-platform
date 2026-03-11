# CLAUDE.md

## Read first
- Read `PROJECT_SUMMARY_CONCISE.md` before any non-trivial task.
- For behavior, contracts, and architecture, prefer `docs/*.md` and `database/schema_v0_1.sql` over README summaries.

## Default scope
- Stay within the public Events + Results v0.1 slice unless the human explicitly expands scope.
- Do not invent routes, schema fields, service layers, infrastructure, or product requirements.

## Architecture guardrails
- Preserve the server-rendered TypeScript + Express + Handlebars approach for this slice.
- Keep controllers thin, put business/page-shaping logic in services, and keep SQLite access in the db layer.
- No ORM and no repository layer unless the human explicitly changes the design.

## Working style
- For multi-file or architectural tasks, start with read-only analysis and present a short plan for human approval.
- Make the smallest safe change that satisfies the current task.
- Surface contradictions between docs, schema, and code to human; do not silently reconcile them.
- Ask before destructive, high-risk, scope-expanding, or architecture-changing changes.
- When docs and implementation drift, suggest a doc-sync pass (use doc-sync skill).
- Always invoke the doc-sync skill before making any doc edits, without exception. Do not edit any file in docs/ directly.
- Always ask the human before making any guesses, assumptions, or non-trivial changes, with good context and concise questions.
