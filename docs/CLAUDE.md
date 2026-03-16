# CLAUDE.md

## Purpose

Local rules for documentation-first work in this repository.

## Source precedence

- Explicit human decisions in the current task override everything else.
- `docs/USER_STORIES.md` is the functional source of truth.
- The top active-slice/status block in `IMPLEMENTATION_PLAN.md` governs current scope and out-of-scope boundaries.
- Current code is the source of truth for implemented behavior.
- Derived docs must be read in that light: `docs/VIEW_CATALOG.md` may be intentionally partial for the current public slice, while `docs/SERVICE_CATALOG.md` remains a broader canonical service-contract reference.
- Surface conflicts explicitly instead of silently blending incompatible sources.

## Documentation rules

- Canonical docs remain canonical references; do not turn them into scope trackers except where `docs/VIEW_CATALOG.md` is intentionally partial by design.
- `IMPLEMENTATION_PLAN.md` is intentionally the active-slice tracker and scope governor.
- Read only the relevant sections needed for the task.
- Use the `doc-sync` skill when the task is documentation drift detection or documentation synchronization.
- Do not edit project documents unless the human explicitly gives consent.
