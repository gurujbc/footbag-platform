---
name: extend-service-contract
description: Extend or adjust a service boundary in the current codebase. Use when the task changes service methods, service-owned shaping, db statement usage, or service-level error/contract behavior.
---

# Extend Service Contract

## When to use this skill

Use this skill — not general editing — when a task does any of the following:

- adds, removes, or renames a service method
- changes what a service method accepts (parameters) or returns (shape)
- adds, removes, or changes `db.ts` prepared statements used by a service
- changes which entity fields a service reads or writes
- changes service-level error codes or error semantics (`serviceErrors.ts`)
- moves business rules, authorization checks, or domain invariants in or out of a service
- changes a service's ownership boundary (e.g., what belongs to service A vs. service B)
- changes how a service shapes data for a page view-model

## Step 1 — Load authoritative docs before touching code

Read these before proposing any change:

1. **The top active-slice/status block in `IMPLEMENTATION_PLAN.md`** — confirm the service change is in scope now.
2. **`docs/USER_STORIES.md`** — find the acceptance criteria that motivate this change. Understand what behavior is being added or corrected.
3. **`docs/SERVICE_CATALOG.md`** — locate the section for the affected service. Read:
   - the service's stated ownership and responsibility boundary
   - current method contracts (parameters, return shapes, pre/postconditions)
   - listed business rules and invariants
   - persistence touchpoints and `db.ts` statement groups used
   - service-level error semantics
4. **`database/schema_v0_1.sql`** — verify exact column names, types, nullable vs. required, status enums, FK relationships, and any trigger behavior relevant to the change.
5. **`docs/DATA_MODEL.md`** — understand entity relationships, soft-delete conventions (`deleted_at`), audit patterns, and any data invariants that must be preserved.
6. **`docs/DESIGN_DECISIONS.md`** (targeted sections) — check for invariants relevant to the change:
   - §1.6 Controller to Service Pattern
   - §2.2 Data Access Pattern
   - §2.3 Soft Deletes
   - §2.4 Immutable Audit Logs
   - auth/security invariants if the service touches sessions, passwords, or ballots

`docs/SERVICE_CATALOG.md` may describe broader service contracts than the active slice. Use `IMPLEMENTATION_PLAN.md` to determine what is implemented now versus what remains broader planned/design contract.

## Step 2 — Inspect current code

After reading docs:
- the relevant service file(s) in `src/services/`
- `src/db/db.ts` — the relevant statement groups
- `src/services/serviceErrors.ts` if error codes are touched
- the controller(s) that call the service
- nearby integration tests in `tests/integration/`

## Step 3 — Preserve current ownership

- `db.ts` returns flat rows and prepared-statement helpers — it does not own business rules
- services own: business rules, validation, authorization, grouping, shaping, page-model building, domain invariants
- controllers stay thin: HTTP glue only — no business logic, no SQL
- templates stay logic-light: branch only on pre-shaped display values

Do not introduce:
- repository abstractions
- ORMs
- mediator or orchestrator layers
- generic query-builder layers
- ad hoc SQL in controllers or templates

## Step 4 — State your plan before editing

Before touching any file, state:
- the current contract (method signature, return shape, error codes)
- the proposed contract (what changes and why)
- which user story acceptance criteria are being satisfied
- touched files: service, db.ts statement groups, serviceErrors.ts, tests
- any data invariants that must be preserved (transactions, soft-delete, audit trail)
- risks and edge cases
- verification plan

## Step 5 — Verification

- write or update integration tests in `tests/integration/`
- run `npm test` to confirm all tests pass
- run `npm run build` (`tsc -p tsconfig.json`) to confirm no type errors
- after changes, invoke `doc-sync` to check whether SERVICE_CATALOG.md or DATA_MODEL.md needs updating
