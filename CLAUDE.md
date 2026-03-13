# CLAUDE.md — footbag-platform

This file is read by Claude Code at the start of every session.

---

## Project overview

Modernizing footbag.org for the International Footbag Players Association (IFPA).
**Start here:** `PROJECT_SUMMARY_CONCISE.md` for project overview context if such understanding is required by the prompt.

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

## Non-negotiable rules

1. Never edit documentation, .github/, or .claude/ files without explicit human approval.
2. Never take a destructive or risky action without explicit human approval.

## Skills

`.claude/skills/doc-sync/SKILL.md` : load before proposing any edits to project documentation.

## Hooks

`block-secrets.sh` fires on every Edit/Write/MultiEdit. Hard blocks `.env`, `*.key`, `*.pem`,
and related files permanently. No override exists.

`block-git-commit.sh` fires on every Bash call. Hard blocks `git commit` and `git push`.
Prompts for confirmation before `git add`. No override exists.

## Source-of-truth order

Explicit human decisions in this session > current code > existing docs. 
If unclear, escalate to human. Never guess or assume.
