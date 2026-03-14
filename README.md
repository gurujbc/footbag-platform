# footbag-platform

> Modernizing **footbag.org** under the auspices of the **International Footbag Players Association (IFPA)**.

This repository contains the open-source modernization project for the global footbag community website.

- **Maintainer:** [David Leberknight](https://github.com/davidleberknight) (initially hosted on David's personal GitHub account)
- **Institutional context:** Developed under IFPA auspices
- **Goal:** A simple, low-cost, volunteer-maintainable platform for long-term community use

Legacy site (HTTP only): [http://www.footbag.org/](http://www.footbag.org/)

## Start here

- **Humans:** read `docs/PROJECT_SUMMARY_V0_1.md`
- **AI tools:** read `PROJECT_SUMMARY_CONCISE.md`

## Current project state

**Minimum Viable First Page (MVFP v0.1) is running on AWS Lightsail.**

Sneek Preview!! Look here:  [http://34.192.250.246/events/event_2025_beaver_open](http://34.192.250.246/events/event_2025_beaver_open)

- For this initial deployment, we have code, tests, AI-created seed data, and complete documentation.
- Some legacy migration tooling is done, including a full mirror of the current live footbag.org.
- Scripts to process and clean historic event-results data are nearly complete.
- This is why the MVFP scope is viewing events and results. 
- Some official rule/policy simplification proposals were recently **Approved by IFPA Board Decision** and will be incorporated in v0.2
- V0.2 will also have real event result data, and a bit more.

## Governance

Read `GOVERNANCE.md` before contributing.

This repository distinguishes between:

- **Category A (maintainer authority):** technical implementation, repo configuration, tooling, code/docs changes
- **Category B (requires IFPA Board approval):** official IFPA policy/rules, rankings/eligibility definitions, authorized IFPA branding decisions, repository ownership transfer

Changes that are **Pending IFPA Board Decision** must not be treated as official IFPA policy.

## Contributing

Please read:

- `CONTRIBUTING.md`
- `SECURITY.md` (for vulnerability reporting — **do not use public issues**)

## Using AI tools (Claude Code)

See `CLAUDE.md` for the full rules Claude operates under.
These are the project conventions enforced with Claude Code skills and hooks:

- **Secrets are hard-blocked.** Some key files cannot be edited by Claude under any circumstances.
- **Git commits and pushes are hard-blocked.** Claude can never commit or push to GitHub. 
- **Editing Project Docs requires explicit approval.** Claude must propose exact before and after text for human approval.

## Project docs

See `docs/` for project documentation and design materials.
See `database/` for the database schema sql.

## Technology stack

TypeScript · Node.js · Express · Handlebars · SQLite · AWS (Lightsail, S3, SES, CloudFront) · Docker · Terraform

Stripe and additional platform integrations are planned for future delivery slices.

## License and trademarks

- Code in this repository is licensed under the **Apache License 2.0** — see `LICENSE`
- IFPA names, logos, and marks are **not** granted under Apache-2.0 — see `TRADEMARKS.md`

---

*Built for the global footbag community.*