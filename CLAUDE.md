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

Read the minimum the task requires. Default: active-slice block + code.
Load docs in targeted sections only.

1. Explicit human decisions in the current task
2. Active-slice block in `IMPLEMENTATION_PLAN.md` — current scope and out-of-scope
3. Current code — implemented behavior
4. When needed, targeted sections of:
   - `docs/USER_STORIES.md` — functional requirements
   - `docs/VIEW_CATALOG.md` — route/page contracts
   - `docs/SERVICE_CATALOG.md` — service contracts
   - `docs/DATA_MODEL.md` — schema semantics
   - `docs/GOVERNANCE.md` — security, privacy, historical data policy
5. `docs/DESIGN_DECISIONS.md` — long-term rationale and architectural commitments; read when entering a new code area, unwinding a temporary simplification, or when the reason behind a pattern is unclear; do not load by default

**Note:** `docs/GOVERNANCE.md` is mandatory before any change touching members, historical persons, search, auth, contact fields, exports, stats, or privacy boundaries.

## Non-negotiable rules

1. Never edit documentation, `.github/`, or `.claude/` files without explicit human approval.
2. Never take a destructive or risky action without explicit human approval.
3. When asking the human a question, always provide context so the human can understand clearly.
4. Refer to appropriate Claude skills whenever appropriate for the task at hand.
5. If unclear, escalate to the human. Never guess.

## Workflow rules

- Documentation in /docs describe long-term product and design intent, not necessarily the current Sprint's reality.
- Use Plan Mode when the task is primarily about sequencing, dependency ordering, or phased planning. For normal implementation work, the top active-slice/status block in `IMPLEMENTATION_PLAN.md` is sufficient.
- Do not use browser automation or MCP tools unless the human explicitly asks for browser testing or verification.
- Use the Explore sub-agent for broad codebase searches; use the Plan sub-agent for sequencing or architecture tasks. Both protect the main context window.

## Skills

Only rely on skills that actually exist under `.claude/skills`.

Available workflow skills and when to use them:

- **doc-sync** — mandatory after any change of significance to design, behavior, or requirements, unless the specific changes were explicitly pre-approved by the human.
- **add-public-page** — use when a task adds a new public route, a new top-level nav section (including nav menu updates on `/`), or changes an existing public controller, template, or route-level tests.
- **extend-service-contract** — use when a task changes a service method signature, return shape, db.ts statements, or service-level error semantics. Run this before add-public-page when a new service method is also needed.
- **write-tests** — use when adding, verifying, or strengthening integration test coverage for any route or service. See `tests/CLAUDE.md` for conventions; use `tests/fixtures/factories.ts` for test data.
- **prepare-pr** — use at task completion to produce a human-reviewable PR summary. Ensure doc-sync has run first.
- **browser-qa** — use only when the human explicitly names a specific page or check to run. Covers both visual layout review (screenshot + feedback) and QA verification. Never run unsolicited, never assume a broad test suite is wanted, minimize tool calls to what was asked.

Correct sequencing when skills compose: `extend-service-contract` → `add-public-page` → `write-tests` → `doc-sync` → `prepare-pr`

## Memory hygiene

Memory is for current-work context only (project state, behavioral
corrections, preferences, external references). Not for code patterns,
debugging fixes, or anything derivable from code or this file.
Update existing entries rather than adding new ones. Remove entries
no longer relevant. If an entry is permanently needed, propose moving
it to CLAUDE.md instead.

## Hooks

- Secret-bearing and local-private files are blocked from editing.
- `git commit` and `git push` are hard-blocked; `git add` requires explicit confirmation.
- Destructive database, production-ops, and dangerous git commands may require explicit confirmation.
- The `systemctl` guard covers `footbag.service` specifically; other host services are not guarded.

