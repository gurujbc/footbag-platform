# CLAUDE.md

## Purpose

Local rules for editing project documentation.

## Source precedence

- Prefer the latest local docs when they conflict with older external snapshots.
- Treat `PROJECT_SUMMARY_CONCISE.md` as the quickest repo overview and routing file.
- Use project docs to reconcile intended scope and contracts before proposing doc changes.
- Surface conflicts instead of silently blending incompatible sources.
- Always ask the human if in doubt.

## Documentation rules

- Canonical docs in `docs/` are long-term, design-oriented references.
- Do not turn canonical docs into slice trackers or sprint notes.
- Near-term sequencing and implementation order belong in `IMPLEMENTATION_PLAN.md`.
- Always invoke the `doc-sync` skill before proposing any doc edits.
- DO NOT EDIT project documents unless the human explicitly gives consent.
