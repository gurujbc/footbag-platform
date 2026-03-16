# Footbag Website Modernization — Project Summary for AI

## Purpose

Use this file for quick orientation and document routing.

## Current-state rule

For non-trivial work, read the top active-slice/status block in `IMPLEMENTATION_PLAN.md`. The plan is active during normal repo work and governs the current slice.

`docs/USER_STORIES.md` is the functional source of truth.

Current code is the source of truth for implemented behavior.

## Fast routing
- Use this file for contextual refresh and document routing only.
- For functional requirements and user stories with acceptance criteria, load `docs/USER_STORIES.md` first.
- For current slice/scope, known drift, and sequencing, read the top active-slice/status block in `IMPLEMENTATION_PLAN.md`; for sequencing, dependency analysis, or phased planning, read the full document in Plan Mode.
- For page/UI/view/route/view-model details already in scope, load `docs/VIEW_CATALOG.md`.
- For service-layer ownership and method contracts, load `docs/SERVICE_CATALOG.md`; use the plan to determine what is implemented now versus what is broader design / planned work.
- For database schema explanation, load `docs/DATA_MODEL.md` or `database/schema_v0_1.sql`.
- For non-functional requirements and technical/design detail, load `docs/DESIGN_DECISIONS.md`.

## Current implemented baseline

Current code is the source of truth for implemented behavior.

The currently implemented public routes are:
- `GET /`
- `GET /clubs` (placeholder — real data coming in Sprint 3)
- `GET /events`
- `GET /events/year/:year`
- `GET /events/:eventKey`
- `GET /health/live`
- `GET /health/ready`

## Current operating model

- Home (`/`) is the landing-page composition exception in the public architecture.
- Public event identity is exact and underscore-based: `event_{year}_{event_slug}` / `#event_{year}_{event_slug}`.
- Historical imported people may appear in legacy results without being current Members.
- Media, news, and tutorial flows remain in the user stories but are out of scope for the current slice.

## Project identity

- **Repo:** github.com/davidleberknight/footbag-platform
- **Institutional context:** Developed under IFPA auspices (International Footbag Players Association)

## Project mission and operating philosophy

- Modernize footbag.org into a long-lived community platform.
- Optimize for **volunteer maintainability** and low operational complexity.
- Prefer **simplicity, transparency, and explicitness** over clever abstractions.
- Use standard, widely understood technologies and patterns so future contributors can onboard quickly.
- Keep code and docs aligned so the project remains maintainable over time.
- Route and integration tests are the first verification path; browser verification is explicit-human-request-only.

## Big-picture architecture (mental model to preserve)

- **Server-rendered web application** (Handlebars templates + TypeScript enhancements).
- **Layered architecture**: controllers -> services -> infrastructure adapters.
- **SQLite-first** for application data; S3 for photos/media object storage.
- **Single DB access module/pattern** (`db.ts` style) using prepared statements and transaction helpers.
- **JWT cookie auth with per-request DB validation** (session token is not sole authority).
- **Email outbox + worker pattern** (core writes are not coupled to direct send success).
- **Single origin deployment** behind CloudFront; maintenance page served by CloudFront/S3 when origin is unavailable.

## Project scope snapshot (AI useful summary)

This project is building a community website with member functionality, admin tools, and operational flows. 
Major areas include:

- members and authentication
- membership tiers/dues and eligibility-related state
- clubs and events
- media galleries/photos/video links/tags
- payments, donations, subscriptions, and reconciliation
- email delivery via outbox/worker
- voting/elections with ballot confidentiality and auditability
- admin work queue / operational admin capabilities
- authenticated legacy archive access

## High-impact invariants (reasoning guardrails)

### Architecture invariants
- Preserve the server-rendered model unless a task explicitly requires a documented architectural change.
- Put business rules in **services**, not controllers/templates.
- Keep external integrations behind infrastructure adapters.
- Prefer small, explicit changes that preserve readability for volunteer maintainers.

### Auth / security invariants
- JWT session cookies are **not sufficient authority** on their own; current DB state must be checked.
- Password changes invalidate sessions via the project’s password-version mechanism.
- State-changing behavior must follow the documented CSRF / HTTP semantics patterns.
- Ballot confidentiality is required; voting is auditable but not fully anonymous.

### Data / integrity invariants
- SQLite is the source of truth for app data (except photo/media objects in S3).
- DB transactions are architecture, not an implementation convenience.
- Multi-step workflows that change related state must preserve transactional consistency.
- Historical/audit/ledger-style records that are append-only or immutable must remain so.
- Effective membership tier / eligibility must use the project’s canonical read-model logic, not ad hoc derivation in feature code.

### Operational invariants
- Dev/prod parity matters for infrastructure adapters and workflows.
- Simplicity is intentional: do not introduce distributed components or operational complexity without explicit approval.
- For Lightsail environments, operator shell access uses hardened per-operator SSH to named host accounts; runtime AWS API access remains separate and uses assumed IAM roles.

## Conceptual code map (paths may vary)

Use this as a reasoning map; exact structure may differ in the repo:

- **presentation / templates / view-models** - rendered pages and client-side enhancements
- **controllers** - HTTP request/response handling, validation, session extraction
- **services** - business logic, authorization, orchestration, domain invariants
- **infrastructure adapters** - Stripe and AWS integrations
- **database access module** - prepared SQL, transactions, connection helpers
- **workers / background jobs** - outbox sending, reconciliation, maintenance tasks
- **docs** - project documentation suite (specs, decisions, diagrams, DevOps, onboarding)
- **infrastructure-as-code** - deployment/infrastructure configuration (Terraform)

## Documentation map (project doc suite categories)

This project uses a documentation suite. The AI should treat it as a modular knowledge base and load documents selectively.

### Core requirements and architecture documents
- **User Stories** - functional scope and acceptance criteria (what must exist / what users must be able to do).
- **Project Summary** - human-oriented big picture, solution architecture, and overall context.
- **Design Decisions** - rationale and non-negotiable design commitments / trade-offs.
- **Data Model** - canonical persisted entities, relationships, schema conventions, storage structure.

### Catalog and contract documents
- **View Catalog** - authoritative page/UI/view/route/view-model specification for the cataloged views; use this instead of looking for a separate UI or Server specification document.
- **Service Catalog** - authoritative service-layer specification and contract document: service ownership, controller-to-service expectations, method contracts, business logic expectations, persistence touchpoints, and service-level error semantics.
- **DevOps guide** - build, test, release, operate, recover, CI/CD, infrastructure procedures.

## When to load more detail (recommended wording / agent rule)

If the task requires details that could materially affect **correctness, security, data integrity, user-visible behavior, or architectural consistency**, and those details are not certain from this summary, the agent should **pause and read the relevant project documents before making recommendations or changes**.

In other words: use this file for orientation, but **escalate to the authoritative docs whenever guessing would be risky**.

Also: the agent may read the **full human-oriented documents** when needed; it is not limited to AI-only summaries.

## Document routing heuristics (what to read next)

- Need exact feature behavior or acceptance criteria -> **User Stories** (+ **View Catalog** when flow/UI context matters)
- Need page routes, rendered page behavior, page/view-model composition, or UI-facing implementation conventions for cataloged views -> **View Catalog**
- Need business rules, service boundaries, controller-to-service expectations, method contracts, or service-level error semantics -> **Service Catalog**
- Need entity relationships, persisted state conventions, schema invariants, or exact SQL surface -> **Data Model** + **Schema SQL**
- Need rationale / trade-offs / "why was it done this way" -> **Design Decisions**
- Need deployment, backups, recovery, infrastructure changes, or CI/CD -> **DevOps guide**. Use **Developer Onboarding** for blank-machine setup and first-pass bootstrap guidance.
- Need big-picture human context or document relationships -> **Project Summary** (full version)

