# CLAUDE.md

## Purpose

Local rules for schema and data-model work in `database/` and related database documentation.

## Authority

- Treat `docs/DATA_MODEL.md` and `database/schema_v0_1.sql` as the authoritative sources for persisted structure.
- Do not invent columns, relationships, or hidden derived persistence rules.

## Design rules

- Preserve SQLite-first simplicity and transparency.
- Keep schema concerns in the database layer and workflow or business rules in application code unless current docs explicitly say otherwise.
- Prefer explicit tables, columns, keys, and documented constraints over abstraction-heavy patterns.
- Do not introduce ORM-style thinking, repository terminology, or speculative whole-platform persistence layers here.

## Boundary note

- This file governs schema and database-documentation work.
- Do not use it to redefine live `src/db` code responsibilities; those belong under `src/db/CLAUDE.md`.
