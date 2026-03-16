# CLAUDE.md — footbag-platform

This file is read by Claude Code at the start of every session.

---

## Project overview

Modernizing footbag.org for the International Footbag Players Association (IFPA).

**Start here:**
- `PROJECT_SUMMARY_CONCISE.md` for orientation and document routing, if required for task.
- `IMPLEMENTATION_PLAN.md` — consult only when in Plan Mode (sequencing, dependencies, phased work).

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

1. Never edit documentation, `.github/`, or `.claude/` files without explicit human approval.
2. Never take a destructive or risky action without explicit human approval.
3. All hooks in .claude are non-negotiable.
4. Refer to appropriate Claude skills whenever appropriate for the task at hand.

## Workflow rules

- Explicit human decisions in this session override everything else.
- Current code is the source of truth for implemented behavior.
- Documentation in /docs describe long-term product and design intent, not necessarily the current Sprint's reality.
- If a human prompt is primarily a planning task and Claude is not already in Plan Mode, ask exactly:
  `Do you want to invoke Plan Mode for this prompt?`
- Do not use browser automation or MCP tools unless the human explicitly asks for browser testing or verification.

## Skills

- Use `.claude/skills/doc-sync/SKILL.md` before proposing any approved doc edits.
- After completing any change of significance to design, behavior, or requirements, invoke doc-sync to check whether documentation needs updating before considering the task done.
- Use the narrower workflow skills when their task descriptions match the request.

## Hooks

- Secret-bearing and local-private files are blocked from editing.
- `git commit` and `git push` are hard-blocked; `git add` requires explicit confirmation.
- Destructive database, production-ops, and dangerous git commands may require explicit confirmation.
- The `systemctl` guard covers `footbag.service` specifically; other host services are not guarded.

## Source-of-truth order

Explicit human decisions in this session > current code > existing docs.

If unclear, escalate to the human. Never guess.
