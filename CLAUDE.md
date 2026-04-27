# CLAUDE.md — footbag-platform

## Project overview

Modernizing footbag.org for the International Footbag Players Association (IFPA).

**Start here:**
- `PROJECT_SUMMARY_CONCISE.md` for orientation and document routing, if required for task.
- `IMPLEMENTATION_PLAN.md` — for any non-trivial task, read the top active-slice/status block to confirm scope; for tasks primarily about sequencing, dependency ordering, or phased planning, read the full document in Plan Mode.

## Repo layout

```
.claude/      Skills, hooks, settings
.github/      CI and templates
database/     Schema and SQLite files
docker/       Build tooling
docs/         Project documentation
ifpa/         Governance and official rules
legacy_data/  Mirror code and migration scripts
ops/systemd/  Production service units
scripts/      Operational scripts
src/          Application code (TypeScript/Express)
terraform/    AWS infrastructure
tests/        Integration tests
```

## Source-of-truth order for active work

Read the minimum the task requires. Default: active-slice block + code. Load docs in targeted sections only.

1. Explicit human decisions in the current task
2. Active-slice block in `IMPLEMENTATION_PLAN.md` — current scope, out-of-scope, accepted shortcuts, known drift
3. Current code — implemented behavior; may contain accepted shortcuts; check the plan's drift and deviation entries before drawing conclusions from code alone
4. When needed, targeted sections of:
   - `docs/USER_STORIES.md` — intended behavior
   - `docs/VIEW_CATALOG.md` — route/page contracts
   - `docs/SERVICE_CATALOG.md` — service contracts (derived from requirements analysis; only reliable where it overlaps with implemented code)
   - `docs/DATA_MODEL.md` — schema semantics (derived from requirements analysis; verify against `database/schema.sql` and current code)
   - `docs/GOVERNANCE.md` — security, privacy, historical data policy
5. `docs/DESIGN_DECISIONS.md` — long-term rationale and architectural commitments; read when entering a new code area, unwinding a temporary simplification, or when the reason behind a pattern is unclear; do not load by default

**Note:** `docs/GOVERNANCE.md` is mandatory before any change touching members, historical persons, search, auth, contact fields, exports, stats, or privacy boundaries.

## Non-negotiable rules

1. Never edit documentation, `.github/`, or `.claude/` files without explicit human approval.
2. Never take a destructive or risky action without explicit human approval.
3. When asking the human a question, always provide context so the human can understand clearly.
4. If unclear, escalate to the human. Never guess or silently choose among materially different interpretations.
5. Never add schema, service methods, or behavioral code without grounding in a user story, design decision, or explicit human direction in the current task. If no acceptance criteria or human approval exist for the behavior, stop and ask.

## Workflow rules

- Long-term docs describe design intent, not implementation status. See doc-sync skill for governance details.
- Use Plan Mode when the task is primarily about sequencing, dependency ordering, phased planning, or architectural tradeoffs. For normal implementation work, the top active-slice/status block in `IMPLEMENTATION_PLAN.md` is sufficient.
- Verification defaults: confirm what success looks like for the task, prefer route/integration verification first, and verify with `npm test` and `npm run build`.
- Do not use browser automation or MCP tools unless the human explicitly asks for browser testing or verification.
- Make surgical changes scoped to the current slice: no speculative abstraction, flexibility, or scope creep; no refactoring unrelated code, unnecessary formatting or comment changes.
- Use the Explore sub-agent for broad codebase searches; use the Plan sub-agent for sequencing or architecture tasks. Both protect the main context window.
- Prefer single Bash commands over compound pipelines (`cmd1 && cmd2`). Compound commands evaluate each component independently against permission rules and trigger spurious prompts even when each component is safe alone.

## Skills

Available workflow skills and when to use them:

- **doc-sync** — mandatory after any change of significance to design, behavior, or requirements, unless the specific changes were explicitly pre-approved by the human.
- **add-public-page** — use when a task adds a new public route, a new top-level nav section (including nav menu updates on `/`), or changes an existing public controller, template, or route-level tests.
- **extend-service-contract** — use when a task changes a service method signature, return shape, db.ts statements, or service-level error semantics. Run this before add-public-page when a new service method is also needed.
- **write-tests** — use when adding, verifying, or strengthening integration test coverage for any route or service. See `tests/CLAUDE.md` for conventions; use `tests/fixtures/factories.ts` for test data.
- **prepare-pr** — use at task completion to produce a human-reviewable PR summary. Ensure doc-sync has run first.
- **browser-qa** — use only when the human explicitly names a specific page or check to run. Covers both visual layout review (screenshot + feedback) and QA verification. Never run unsolicited, never assume a broad test suite is wanted, minimize tool calls to what was asked.

When a task matches a skill's trigger condition, invoke that skill as the **first action** before reading any files or exploring the codebase.

Correct sequencing when skills compose: `extend-service-contract` → `add-public-page` → `write-tests` → `doc-sync` → `prepare-pr`

## Memory

Promote durable rules to hooks or CLAUDE.md.

**High bar for saving.** Do not save what can be re-derived: code patterns, file paths, naming conventions, task state, doc mirrors, pointers to docs CLAUDE.md already routes to, resolved deviations, or one-incident observations. **Search existing memories and project rules before saving; if the lesson is already covered, do not add a new entry.** When in doubt, do not save.

## Hooks

Enforcement guardrails in `.claude/hooks/`. Secrets hard-blocked, git commit/push/pull hard-blocked, destructive operations require confirmation. See each script for details.


