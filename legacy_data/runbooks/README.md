# legacy_data runbooks

Project-local operational procedures for the historical-pipeline subtree. These are not Claude Code harness skills; the harness does not load them, they do not appear in the available-skills list, and they cannot be invoked via the Skill tool or a slash command.

## What lives here

- Footbag-pipeline operational procedures (full pipeline run, identity rebuild, workbook build, alias cleanup, etc.)
- Workflows tied to specific files, scripts, schema, and conventions inside `legacy_data/`
- Commands, file paths, validation steps, and "do not do" lists scoped to this subtree

## What does NOT live here

- Generic, reusable AI-invokable skills with description-driven trigger matching → `.claude/skills/<slug>/SKILL.md`
- Cross-cutting invariants surfaced by the harness as guidance → `.claude/rules/`
- Long-form design docs → `docs/`

## How they are used

`legacy_data/CLAUDE.md` routes by topic to runbooks in this directory. Claude reads them when the routing entry surfaces in context, not via the Skill tool. A runbook that no CLAUDE.md routes to is effectively orphaned.

## Format

Free-form Markdown. No YAML frontmatter required. No fixed slug convention beyond `<topic>.md`. Keep them operational: commands, validation steps, and "do not do" lists; defer narrative explanation to the user-facing docs in `docs/`.

## Adding a new runbook

1. Add the file under `legacy_data/runbooks/<topic>.md`.
2. Add a routing line to `legacy_data/CLAUDE.md` under "Routing (use runbooks)".
3. If the procedure is generic and reusable across projects, consider promoting to `.claude/skills/<slug>/SKILL.md` instead.
