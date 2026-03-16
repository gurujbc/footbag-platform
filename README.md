# footbag-platform

> Modernizing **footbag.org** under the auspices of the **International Footbag Players Association (IFPA)**.

This repository contains the open-source modernization project for the global footbag community website.

- **Maintainer:** [David Leberknight](https://github.com/davidleberknight) (initially hosted on David's personal GitHub account)
- **Institutional context:** Developed under IFPA auspices
- **Goal:** A simple, low-cost, volunteer-maintainable platform for long-term community use

Legacy site (HTTP only): [http://www.footbag.org/](http://www.footbag.org/)

## Start here

- **Humans:** read `docs/PROJECT_SUMMARY.md`
- **AI tools:** read `PROJECT_SUMMARY_CONCISE.md`
- **Near-term sequencing:** read `IMPLEMENTATION_PLAN.md`

## Current project state

The current public slice is already deployed on AWS and is the baseline for ongoing work.

Sneak Preview: [http://34.192.250.246/events/event_2025_beaver_open](http://34.192.250.246/events/event_2025_beaver_open)

- Some legacy migration tooling is done, including a full mirror of the current live footbag.org.
- Scripts to process and clean historic event-results data are nearly complete.
- This is why the MVFP scope is viewing events and results.
- Some official rule/policy simplification proposals were recently **Approved by IFPA Board Decision** and will be incorporated in v0.2
- V0.2 will also have real event result data, and a bit more.
- An early-draft implementation plan is in `IMPLEMENTATION_PLAN.md`.

## Governance

Read `GOVERNANCE.md` before contributing.

This repository distinguishes between:

- **Category A (maintainer authority):** technical implementation, repo configuration, tooling, code/docs changes
- **Category B (requires IFPA Board approval):** official IFPA policy/rules, rankings/eligibility definitions, authorized IFPA branding decisions, repository ownership transfer

## Contributing

Please read:

- `CONTRIBUTING.md`
- `SECURITY.md` (for vulnerability reporting — **do not use public issues**)

## Using AI tools (Claude Code)

See `CLAUDE.md` for the full rules Claude operates under.

Project conventions enforced with Claude Code:
- secret-bearing and local-private files are blocked from editing
- git commits and pushes are blocked
- risky/destructive commands may require confirmation
- editing project docs, `.github/`, or `.claude/` requires explicit human approval

## Project docs

- `docs/` contains canonical long-term product, design, and operating docs
- `IMPLEMENTATION_PLAN.md` contains near-term sequencing, dependency analysis, and incremental planning
- `database/` contains the schema SQL and runtime database notes

## Technology stack

TypeScript · Node.js · Express · Handlebars · SQLite · AWS (Lightsail, S3, SES, CloudFront) · Docker · Terraform

Stripe and additional platform integrations are planned for later delivery.

## License and trademarks

- Code in this repository is licensed under the **Apache License 2.0** — see `LICENSE`
- IFPA names, logos, and marks are **not** granted under Apache-2.0 — see `TRADEMARKS.md`

---

*Built for the global footbag community.*
