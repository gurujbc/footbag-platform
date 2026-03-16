# Project Documentation

Design and specification documents for the footbag-platform modernization project.

> **AI tools:** read [`../PROJECT_SUMMARY_CONCISE.md`](../PROJECT_SUMMARY_CONCISE.md) first for orientation and routing.

## Canonical documents

- [`PROJECT_SUMMARY.md`](PROJECT_SUMMARY.md) — big-picture product, architecture, and operating philosophy
- [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) — rationale, constraints, and non-negotiable design commitments
- [`DATA_MODEL.md`](DATA_MODEL.md) — canonical entities, relationships, schema conventions, DB-vs-app boundaries
- [`USER_STORIES.md`](USER_STORIES.md) — functional scope and acceptance criteria
- [`DIAGRAMS.md`](DIAGRAMS.md) — architecture and data-flow diagrams
- [`GLOSSARY.md`](GLOSSARY.md) — cross-document terminology
- [`SERVICE_CATALOG.md`](SERVICE_CATALOG.md) — service contracts and ownership
- [`VIEW_CATALOG.md`](VIEW_CATALOG.md) — public page standards and current public route catalog
- [`DEVOPS_GUIDE.md`](DEVOPS_GUIDE.md) — build, deploy, operate, recover, and infrastructure procedures
- [`DEV_ONBOARDING.md`](DEV_ONBOARDING.md) — developer setup and local/staging iteration guidance

## Where to look

- What must the system do? → `USER_STORIES.md`
- Why was it designed this way? → `DESIGN_DECISIONS.md`
- What entities exist and how are they related? → `DATA_MODEL.md` + `database/schema_v0_1.sql`
- What does a public page/route look like? → `VIEW_CATALOG.md`
- What does a service own? → `SERVICE_CATALOG.md`
- How do I build, deploy, or recover? → `DEVOPS_GUIDE.md`
- How do I set up the project and iterate locally? → `DEV_ONBOARDING.md`

## What does not belong here

Near-term sequencing, current sprint-like implementation order, and dependency-aware work planning belong in `../IMPLEMENTATION_PLAN.md`, not in the canonical docs.
