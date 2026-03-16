# IMPLEMENTATION_PLAN.md

> **Plan Mode only.** This document is for use during Plan Mode sessions. Do not load or reference it in normal operation.

## Purpose

Near-term implementation planning and sequencing for the repository.

Use it for:
- dependency-aware implementation order
- near-term refactor sequencing
- migration and import planning
- infrastructure and deployment prerequisites
- verification planning
- phase-based work coordination

Do not use it as the source of truth for long-term product requirements or architecture. Current code is the source of truth for implemented behavior. Canonical docs in `docs/` are the source of truth for long-term design intent.

---

## Current deployed baseline

The current deployed public slice is the baseline, not a throwaway prototype.

Current implemented public routes:
- `/`
- `/clubs`
- `/events`
- `/events/year/:year`
- `/events/:eventKey`
- `/health/live`
- `/health/ready`

Current implementation constraints:
- server-rendered Express + Handlebars
- thin controllers
- service-owned page shaping and use-case logic
- one prepared-statement `db.ts` module
- logic-light templates
- route ordering matters for `/events/year/:year` before `/events/:eventKey`
- `OperationsPlatformService` currently composes only the minimal DB readiness check

Current verification baseline:
- a single integration test file covers public events routes plus health, home, and clubs
- browser verification is explicit-human-request-only
- import/migration flows, 500 behavior, and broader operational flows need stronger coverage

---

## Dependency map

### Application stack
```
routes → controllers → services → db.ts prepared statements → SQLite
templates depend on service-owned page-model shaping
/health/ready currently depends only on the minimal DB probe via OperationsPlatformService
```

### Feature dependency chain
```
auth layer
  ← member registration / account claim
    ← email outbox worker activation
      ← SES domain verification (infra, already Terraformed)
  ← organizer write flows
  ← admin work queue

clubs public page
  ← ClubService public methods
    ← clubs table (EXISTS in schema)

legacy data visible on site
  ← MVFP import script (CSVs ready, build scripts exist)
    ← migration strategy (numbered migrations must precede schema evolution)

CI/CD automation
  ← staging running end-to-end
    ← AWS host bootstrap COMPLETE
```

### Infrastructure dependency chain
```
production deploy
  ← staging validated + CloudFront active
    ← host bootstrap: Docker → /srv/footbag → rsync → DB init → footbag.service
      ← AWS + Terraform (DONE)

email delivery
  ← SES domain verification + outbox worker
    ← app running in Docker on host

CloudWatch monitoring
  ← CloudWatch agent installed on host
    ← app running
```

### Architectural hazards
- Route ordering in `publicRoutes.ts` is semantically significant.
- `eventKey` validation and normalization live above `db.ts`.
- `db.ts` must not absorb business rules, request parsing, or generic abstractions.
- Canonical docs are broader than implemented code; always distinguish implemented vs intended.
- Migration strategy must be in place before any schema change — even small ones.

---

## v0.2 blocking note

IFPA rules integration planning can continue, but implementation must wait for Julie's official published wording before rule text is treated as current.

---

## Phase roadmap

**Format:** Each phase has a goal, concrete tasks (with size: S/M/L), explicit dependencies, and a gate condition before the next phase starts.

Size labels: S = small, M = medium, L = large.

---

### Phase 0 — In-flight completion

**Goal:** Clear the backlog of in-progress work so Phase 1 starts from a clean, fully deployed baseline.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| ~~0-A~~ | ~~Apply revision-plan.md doc/config patch (rename versioned docs, tighten hooks/skills/CLAUDE.md)~~ | ~~M~~ | DONE |
| ~~0-B~~ | ~~AWS host bootstrap: Docker install on host (§4.7 Step 2)~~ | ~~S~~ | DONE |
| ~~0-C~~ | ~~AWS host bootstrap: /srv/footbag, rsync, DB init, footbag.service (§4.7 Steps 3–6)~~ | ~~M~~ | DONE |
| ~~0-D~~ | ~~Build and start app in Docker on host (§4.8)~~ | ~~S~~ | DONE |
| ~~0-E~~ | ~~Staging verification: direct-IP + CloudFront smoke check (§4.9)~~ | ~~S~~ | DONE |
| 0-F | SNS email subscription confirmation | S | 0-D |

**Gate:** Substantially complete — site is live on staging and serving all public routes. CloudFront is responding. Task 0-F (SNS subscription confirmation) still outstanding.

---

### Phase 1 — Verification foundation + CI/CD

**Goal:** Iteration is safe. Deploys are one-command. CI catches regressions before they reach staging.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 1-A | Expand integration tests: home page assertions, clubs page, 404 route, 500 error handler, invalid eventKey formats | M | — |
| 1-B | Expand integration tests: health/ready edge cases, middleware behavior | S | — |
| 1-C | Write `scripts/deploy-staging.sh`: rsync + docker compose pull + restart, idempotent | S | Phase 0 gate |
| 1-D | GitHub Actions workflow: run `npm test` on push + PR | M | 1-A, 1-B |
| 1-E | CloudFront pass 2: enable_cloudfront = true in Terraform, apply to staging | M | Phase 0 gate |
| 1-F | Security hardening: X-Origin-Verify header (CloudFront → origin validation), S3 OAC | M | 1-E |
| 1-G | CloudWatch agent install on host | S | Phase 0 gate |

**Gate:** CI is green on all tests. Deploy is one script invocation. CloudFront is fully active on staging. CloudWatch is receiving metrics.

---

### Phase 2 — Migration plumbing + legacy data import

**Goal:** Real historical data is visible on the public site. Schema can evolve safely.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 2-A | Numbered migration framework: `database/migrations/` directory, migration runner script, `schema_v0_1.sql` as baseline migration 001 | M | Phase 1 gate |
| 2-B | MVFP legacy import: load `legacy_data/event_results/seed/mvfp/` CSVs into schema (175 persons, 4 events, 294 results, 484 participants) via idempotent SQL import script | L | 2-A |
| 2-C | Integration tests for import: fixture-based tests verifying imported events + results appear on public routes | M | 2-B |
| 2-D | Staging import rehearsal: run import against staging DB; verify public routes show real data | S | 2-B, Phase 1 gate |
| 2-E | Document import contract appendix: source inventory, trust levels, normalization rules, member matching strategy | M | 2-B |
| 2-F | Decide: production deploy timing (after staging import validated) | S | 2-D |

**Notes:**
- MVFP CSVs are already normalized (`legacy_data/event_results/seed/mvfp/`). Build script `06_build_mvfp_seed.py` and verify script exist. This is an implementation task, not a design task.
- Imported persons are **not** activated member accounts. They are identity records for future account-claim flow. Keep this boundary explicit.
- Do not change executable schema/seed filenames without an explicit decision.

**Gate:** Imported events and results are visible on `/events` and `/events/:eventKey` on staging. Import is idempotent and rehearsable.

---

### Phase 3 — Clubs page + broader data

**Goal:** Clubs page is live with real data. Broader legacy event coverage begins.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 3-A | `ClubService` public methods: `listPublicClubs()`, page model shaping (see Service Catalog) | M | — |
| 3-B | Clubs controller + route: replace "coming soon" placeholder with real data rendering | M | 3-A |
| 3-C | Clubs integration tests: clubs listing, empty state, individual club route (if scoped) | M | 3-B |
| 3-D | Clubs seed data: at least NHSA and a few historical clubs from legacy mirror | S | 2-A (migration plumbing) |
| 3-E | Broader legacy event import: assess `mirror_footbag_org` coverage; import next batch of historical events beyond MVFP 4 | L | 2-B |
| 3-F | Production deploy (if staging validated from Phase 2 and CloudFront active) | M | Phase 2 gate, 1-E |

**Gate:** `/clubs` serves real data. Production deploy is live (if approved).

---

### Phase 4 — Auth foundation

**Goal:** Members can register, log in, and claim legacy identities. Email delivery is operational.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 4-A | Auth middleware: JWT cookie validation + per-request DB state check (see Design Decisions for cookie/session design) | L | — |
| 4-B | `IdentityAccessService` bootstrap: registration, login, logout, password hashing | L | 4-A |
| 4-C | Login / register / logout pages + controllers | M | 4-B |
| 4-D | Email outbox worker: activate `worker.ts` stub for outbox_emails processing via SES | L | Phase 0 gate (SES configured), 4-B |
| 4-E | Email verification flow: registration sends verification email, link activates account | M | 4-C, 4-D |
| 4-F | Account claim flow: imported legacy person → authenticated member account linkage | M | 4-B, Phase 2 gate (persons imported) |
| 4-G | Password reset flow: email-based reset using outbox worker | M | 4-D, 4-E |
| 4-H | Auth integration tests: login, logout, registration, session validation, password reset | M | 4-A – 4-G |

**Notes:**
- JWT sessions are NOT sufficient authority alone; current DB state must be checked on every request (see `PROJECT_SUMMARY_CONCISE.md` auth invariants).
- Password changes must invalidate sessions via the password-version mechanism.
- State-changing routes must follow documented CSRF / HTTP semantics patterns.
- Do not begin organizer write flows or admin work queue until 4-A/4-B are solid and tested.

**Gate:** Members can register, verify email, log in, log out, and claim a legacy person identity. Password reset works end-to-end via email.

---

### Later phases (not yet sequenced)

Prerequisites are noted.

- **Organizer write flows** (event creation, results publishing) — depends on auth + admin work queue
- **Admin work queue UI** — depends on auth
- **Membership tiers / dues / Stripe integration** — depends on auth + IFPA rules decision
- **Voting / elections** — depends on auth + membership tiers
- **Media galleries** — depends on auth + S3 media bucket (Terraformed, not yet wired)
- **IFPA rules integration** — gated on Julie's official published wording
- **Hall of Fame** — depends on auth + admin work queue
- **Mailing list management** — depends on email worker
- **Richer readiness checks** — expand `/health/ready` when real operational dependencies exist

---

## Work package A — legacy data import and normalization

### Why this is first-class work
Legacy data import directly affects the usefulness of the current public event/results surface and introduces identity/account risks beyond simple event ingestion.

### Current state
- MVFP seed CSVs are ready: `legacy_data/event_results/seed/mvfp/` (4 events, 175 persons, 294 results, 484 participants)
- Build script: `legacy_data/event_results/scripts/06_build_mvfp_seed.py`
- Verify script: `legacy_data/event_results/scripts/verify_mvfp_seed.py`
- Full legacy mirror: `legacy_data/mirror_footbag_org/` (broader event/result coverage; post-MVFP import batch)

### Requirements
- Idempotent import behavior (rehearsable on staging)
- Deterministic test fixtures for import correctness
- Preserve legacy identifiers for traceability
- Imported persons are NOT activated accounts — they are placeholder identity records for future account-claim flow
- Explicit publish criteria before imported data goes live

### Member/account migration risks
- Imported member identities may not map cleanly to future authenticated accounts
- Email quality and uniqueness may be incomplete in legacy data
- Password reset and account-claim flows must be explicitly sequenced before any member login rollout
- Imported historical participants need placeholder identity records separate from activated members

---

## Work package B — IFPA rules integration

### Scope
Application and documentation alignment for new IFPA-rule wording after official wording is published.

### Analysis buckets
For each rule change, classify as: docs-only / configuration-only / schema-affecting / service-logic affecting / UI-display affecting.

### Likely impact areas
- Membership-tier logic and eligibility
- Sanctioned-event and attendance-derived rules
- Official roster and flag behavior
- Registration and result validation
- Legacy-data interpretation where historical records interact with new policy language

### Gate
Do not implement final rule wording until Julie's official published wording exists.

---

## Cross-cutting prerequisites before wider feature expansion

1. Migration strategy in place before any schema change (Phase 2-A).
2. Integration-test coverage expanded beyond current single-file baseline (Phase 1-A/B).
3. Import-safe verification scripts and fixture coverage (Phase 2-C).
4. Browser smoke-check expectations defined for public routes (explicit-human-request-only for automation).
5. Readiness expansion tied to real operational dependencies, not speculative checks.
6. Auth invariants from `PROJECT_SUMMARY_CONCISE.md` enforced before any write flow.

---

## Refactors that make later work cheaper or safer

- Numbered migrations before nontrivial schema evolution (Phase 2-A is this).
- Import/normalization code isolated from request-serving code.
- Test coverage for `/`, `/clubs`, health endpoints, 404/500, import/migration logic.
- Service boundaries explicit before adding write flows or authentication flows.
- Readiness composition expanded only after backup/config/job dependencies actually exist.

---

## Verification matrix

For each increment, confirm:
- code paths touched
- DB/schema implications
- migration or import rehearsal needs
- route/integration tests required
- browser checks only when explicitly requested
- staging/deployment prerequisites
- rollback or restore path if data changes are involved

---

## Open risks and decisions

- Imported legacy identities may not cleanly map to future authenticated members; account-claim design is not final.
- Password reset and account-claim semantics depend on that mapping.
- Current readiness implementation is intentionally narrower than long-term docs.
- Canonical docs remain broader than implemented code; phase planning must constantly separate implemented from intended.
- Executable schema/seed filenames remain versioned for now — need an explicit later decision on naming convention.
- Production deploy timing is conditional on Phase 2 staging validation.
- IFPA rules integration is an external dependency (Julie's published wording).
