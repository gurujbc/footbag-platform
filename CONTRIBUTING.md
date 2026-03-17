# Contributing

Contributions are welcome. This project is maintained by
[David Leberknight](https://github.com/davidleberknight) under IFPA auspices.

## Before you start

Search existing issues first. For significant changes, open an issue before
writing code. Read [`GOVERNANCE.md`](GOVERNANCE.md) — particularly the
Category A / Category B distinction. For security vulnerabilities, use the
private path in [`SECURITY.md`](SECURITY.md) — do not file public issues.

## Filing an issue

Use a clear title. Describe what is wrong or missing, the specific file or area
affected, what you expected, and steps to reproduce for bugs.

**If your issue touches IFPA rules, competition policy, ranking or eligibility
definitions, or IFPA branding**, say so clearly. It will be labelled
`status: pending-ifpa-board` and cannot be resolved until IFPA Board approves.
Everything else is under maintainer authority and moves normally.

## Pull requests

1. Fork and branch from `main` (or `drafts/[topic]` for Category B content).
2. Keep commits small. Use conventional prefixes: `feat:`, `fix:`, `docs:`, `chore:`.
3. Sign off every commit: `git commit -s`
4. Fill in the PR template completely.

**DCO:** No CLA required. Sign-off certifies you have the right to submit your
contribution under the Apache 2.0 licence per the
[Developer Certificate of Origin v1.1](https://developercertificate.org/).

## Code conventions

- TypeScript: no new type errors; follow existing patterns.
- Business logic belongs in services, not controllers or templates.
- Schema changes: follow conventions in `docs/DATA_MODEL.md` and `database/schema_v0_1.sql`.
- Prefer the smallest safe change that preserves volunteer readability.
- No new external dependencies without prior discussion.

## Privacy and governance

Any task touching members, historical persons, search, contact fields, rosters, participant lists, exports, event results, HoF, BAP, world records, rankings, stats, or auth must follow [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md). Read it before writing or reviewing code in those areas.
