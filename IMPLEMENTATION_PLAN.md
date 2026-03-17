# IMPLEMENTATION_PLAN.md

This document is active during normal repo work. It is the current-slice tracker and scope governor for maintainers, contributors, and AI assistants.

For non-trivial work, read this top status block first, then only the relevant downstream docs and code.

## Source-of-truth order for active work

- `docs/USER_STORIES.md` is the functional source of truth; for current work, focus on the specific User Stories in question.
- Current code is the source of truth for implemented behavior.
- This plan governs current-slice scope, sequencing, out-of-scope boundaries, and known drift.
- Derived docs in `docs/` remain canonical references for the areas they cover, but only `docs/VIEW_CATALOG.md` is intentionally partial for the current public slice.

## Active slice now

- **Event results pages:** historical-record UX refinement — provenance, caveats, layout improvements; year-listing pages do not show results inline (results live on separate result-slug pages); result pages more prominent
- **Members pages:** major reframe from ambiguous "members section" into explicit public historical-record index and detail surfaces; reduce directory-style language; auth stub gates any content not appropriate for anonymous visitors
- **World records:** add as public historical record surfaces (new in this slice)
- **BAP/HoF:** honor-roll pages and member-page indicators
- **Historical-data caveats:** no uncaveated derived stats; scope and completeness messaging where needed; no misleading "all-time" or "career total" claims from partial import data
- **First fake auth foundation stub:** retire `isLoggedIn` env-toggle; introduce stubbed session middleware; real route-level authorization behavior; designed to mirror the future real auth path except for the stub credential mechanism; runs in all environments including staging during this sprint
- **TDD expansion:** integration tests for members routes, world-record routes, and auth-stub visibility behaviors
- Home page stats: event count, player count, year count (already queryable)
- Teammate links on member detail (service change needed to carry person IDs through)

## Drafted next, but not active code focus now

- Clubs page with real data (no club data yet; deferred until data exists)
- Broader service contracts may remain documented in `docs/SERVICE_CATALOG.md`, but implementation status is governed here, not there.

## Out of scope now

- Schema migration framework — schema changes are handled by rebuilding the DB; no migration runner needed
- Full auth implementation (Phase 4 sequencing unchanged; current sprint introduces the first fake auth stub only, not real JWT/DB auth)
- media/news/tutorial implementation work
- broad person-identity redesign
- a platform-wide persons subsystem
- authenticated account-claim requirements for historical imported people
- fuzzy event-key rewriting or hyphen/underscore alias behavior
- a `publicController` target design

## Known current drift rules

- `docs/VIEW_CATALOG.md` is intentionally partial and only needs to catalog implemented or actively specified current-slice views.
- `docs/SERVICE_CATALOG.md` may remain broader than the active slice and should not be treated as a status board.
- When code and docs diverge, contributors and AI assistants must say so explicitly rather than flattening the disagreement.

## Current deployed baseline

The current deployed public slice is the baseline, not a throwaway prototype.

Current implemented public routes:
- `/`
- `/clubs` (placeholder — no real data)
- `/events`
- `/events/year/:year`
- `/events/:eventKey`
- `/members` (auth-gated; redirects to `/login` when not authenticated)
- `/members/:personId` (auth-gated; redirects to `/login` when not authenticated)
- `GET /login` (auth stub login form)
- `POST /login` (auth stub login handler — sets session cookie, redirects to `/members`)
- `POST /logout` (clears session cookie, redirects to `/`)
- `/health/live`
- `/health/ready`

Real MVFP data is loaded: 175 historical persons, 4 events, results and participants visible on public routes.

Current implementation constraints:
- server-rendered Express + Handlebars
- thin controllers
- service-owned page shaping and use-case logic
- one prepared-statement `db.ts` module
- logic-light templates
- route ordering matters for `/events/year/:year` before `/events/:eventKey`
- `OperationsPlatformService` currently composes only the minimal DB readiness check
- schema changes require a DB rebuild (no migration runner; this is intentional)

Current verification baseline:
- a single integration test file (`tests/integration/events.routes.test.ts`) covers public events routes plus health, home, and clubs
- members routes and auth-stub visibility states not yet covered by tests
- browser verification is explicit-human-request-only

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

**Note: Phase 1 infra tasks run in parallel with the current feature slice. They are not blockers for feature work.**

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

### Phase 2 — Legacy data import

**Goal:** Real historical data is visible on the public site.

**Note: No migration framework. Schema changes require a DB rebuild using `schema_v0_1.sql` + seed.**

| # | Task | Size | Dependency |
|---|------|------|-----------|
| ~~2-B~~ | ~~MVFP legacy import: 175 persons, 4 events, 294 results, 484 participants~~ | ~~L~~ | DONE |
| 2-C | Integration tests: fixture-based tests verifying imported events + results appear on public routes | M | — |
| 2-D | Production deploy (after staging validated) | S | Phase 1 gate |
| 2-E | Broader legacy event import: assess `mirror_footbag_org` coverage; import next batch beyond MVFP 4 | L | — |

**Notes:**
- MVFP data is loaded. Real events and members are visible on public routes.
- Imported persons are **not** activated member accounts. Identity records only, for future account-claim flow.

**Gate:** Imported events and results are visible on staging. Production deploy approved.

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
- MVFP data loaded: 4 events, 175 persons, 294 results, 484 participants — visible on public routes
- Build script: `legacy_data/event_results/scripts/06_build_mvfp_seed.py`
- Verify script: `legacy_data/event_results/scripts/verify_mvfp_seed.py`
- Full legacy mirror: `legacy_data/mirror_footbag_org/` (broader event/result coverage; post-MVFP import batch)
- Schema changes: rebuild DB using `schema_v0_1.sql` + `database/seeds/seed_mvfp_v0_1.sql`; no migration runner

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

1. Schema changes require a DB rebuild (no migration runner; rebuild from `schema_v0_1.sql` + seed).
2. Integration-test coverage expanded beyond current single-file baseline (Phase 1-A/B, ongoing with TDD).
3. Import-safe verification scripts and fixture coverage (Phase 2-C).
4. Browser smoke-check expectations defined for public routes (explicit-human-request-only for automation).
5. Readiness expansion tied to real operational dependencies, not speculative checks.
6. Auth invariants from `PROJECT_SUMMARY_CONCISE.md` enforced before any write flow.

---

## Refactors that make later work cheaper or safer

- Schema changes handled by DB rebuild; no migration runner needed.
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
