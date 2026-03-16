---
name: extend-service-contract
description: Extend or adjust a service boundary in the current codebase. Use when the task changes service methods, service-owned shaping, db statement usage, or service-level error/contract behavior.
---

# Extend Service Contract

1. Inspect first:
   - `CLAUDE.md`
   - `src/services/CLAUDE.md`
   - `src/db/CLAUDE.md`
   - the relevant service file
   - touched `db.ts` statement groups
   - `serviceErrors.ts` if relevant
   - nearby tests

2. Preserve current ownership:
   - `db.ts` returns flat rows and statement helpers
   - services own business rules, validation, grouping, and page-oriented shaping
   - controllers stay thin
   - templates stay logic-light

3. Do not introduce:
   - repository abstractions
   - ORMs
   - mediator/orchestrator layers
   - generic query-builder layers

4. If a task changes intended long-term ownership, read the canonical docs only after inspecting current code.

5. Before editing, state:
   - current contract
   - proposed contract
   - touched files
   - risks
   - verification plan
