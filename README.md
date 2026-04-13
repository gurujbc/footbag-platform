# footbag-platform

> Modernizing **footbag.org** under the auspices of the **International Footbag Players Association (IFPA)**.

This repository contains the open-source modernization project for the global footbag community website.

- **Maintainer:** [David Leberknight](https://github.com/davidleberknight) (initially hosted on David's personal GitHub account)
- **Institutional context:** Developed under IFPA auspices
- **Goal:** A simple, low-cost, volunteer-maintainable platform for long-term community use

Legacy site (HTTP only): [http://www.footbag.org/](http://www.footbag.org/)

## Start Here

- **Humans:** read [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md)
- **AI tools:** read [PROJECT_SUMMARY_CONCISE.md](PROJECT_SUMMARY_CONCISE.md)
- **Work done already, near-term plan, and current scope:** read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Current Project State

Some functionality is done and deployed on AWS. This is the baseline for ongoing work.

Sneak Preview: [https://doye1nvv64qep.cloudfront.net/events/event_2025_beaver_open](https://doye1nvv64qep.cloudfront.net/events/event_2025_beaver_open)

- Some legacy migration tooling is done, including a full mirror of the current live footbag.org.
- Historical data processing scripts under development. Legacy event-results data cleanup is done, club data processing is underway.
- The current implemented slice is evolving. For the authoritative current scope, implemented routes, and known accepted gaps, see `IMPLEMENTATION_PLAN.md`.
- Official rule/policy simplification proposals approved by IFPA Board Decision; awaiting final IFPA language.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md).
- [docs/GOVERNANCE.md](docs/GOVERNANCE.md) (security, privacy, and historical data publication policy).
- [SECURITY.md](SECURITY.md) (for vulnerability reporting — **do not use public issues**).
- See [CLAUDE.md](CLAUDE.md) for Claude Code's standard operating rules.
- Talk to Dave.

## Project Documentation

- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — data model and schema semantics.
- [docs/DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md) — architectural decisions and rationale.
- [docs/DEV_ONBOARDING.md](docs/DEV_ONBOARDING.md) — developer setup and onboarding.
- [docs/DEVOPS_GUIDE.md](docs/DEVOPS_GUIDE.md) — deployment and operations.
- [docs/DIAGRAMS.md](docs/DIAGRAMS.md) — architecture diagrams.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — terminology and jargon.
- [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md) — project overview.
- [docs/SERVICE_CATALOG.md](docs/SERVICE_CATALOG.md) — back-end code service contracts.
- [docs/USER_STORIES.md](docs/USER_STORIES.md) — intended functional behaviors and success criteria.
- [docs/VIEW_CATALOG.md](docs/VIEW_CATALOG.md) — route and web-page contracts.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — current sprint scope, dependency analysis, and planning.

## Technology Stack

TypeScript · Node.js · Express · Handlebars · SQLite · AWS (Lightsail, S3, SES, CloudFront) · Docker · Terraform · Stripe 

## License and Trademarks

- Code in this repository is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).
- IFPA names, logos, and marks are **not** granted under Apache-2.0 — see [TRADEMARKS.md](TRADEMARKS.md).

---

*Built for the global footbag community.*
