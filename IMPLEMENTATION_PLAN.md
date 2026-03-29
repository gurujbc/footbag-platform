# IMPLEMENTATION_PLAN.md

This document is active during normal repo work. It is the current-slice tracker and scope governor for maintainers, contributors, and AI assistants. ("slice" and "sprint" are used interchangeably.)

For non-trivial work, read this top status block first, then only the relevant downstream docs and code.
This file — not auto memory — is the source of truth for current slice status, accepted shortcuts, and in-scope vs out-of-scope boundaries.

## Source-of-truth order for active work

- `docs/USER_STORIES.md` is the functional source of truth; for current work, focus on the specific User Stories in question.
- Current code is the source of truth for implemented behavior.
- This plan governs current-slice scope, sequencing, out-of-scope boundaries, and known drift.
- Derived docs in `docs/` remain canonical references for the areas they cover, but only `docs/VIEW_CATALOG.md` is intentionally partial for the current public slice.

## Active slice now

### Sprint: Member Auth + Profile MVP

See full item descriptions in the "Next sprint" section below (now active).

**Status:** Items A, B, D, E, F, G complete. Item C (legacy account claim) is the one remaining item.

**Routing (implemented):** Member profiles live at `/members/:memberId/*`. Historical persons live at `/history/*` (not in primary nav; accessed via event-result participant links only). Account creation at `/register`. The item descriptions below reflect the implemented routes.

Both remaining clubs-sprint items are blocked on James (members ungating: data review; world records: records CSV). Clubs sprint archived below.

---

### Archived sprint: Club + members ungating + world records

**Status:** Clubs work complete. Two items remain blocked on James; archived pending unblock.

**Completed this sprint:**
- Club seed extraction: `legacy_data/scripts/extract_clubs.py` + `load_clubs_seed.py`; `scripts/reset-local-db.sh` updated
- `src/services/clubService.ts`: `listPublicClubs()`, `getClubsByCountry()`, world-map data shaping
- Clubs index page (`/clubs`): country-grouped list with SVG world map (interactive, JS-enhanced; degrades to list without JS; hidden on mobile ≤768px)
- Clubs country page (`/clubs/:countrySlug`): clubs grouped by region, external links
- Clubs detail page (`/clubs/:countrySlug/:clubSlug`): individual club view
- Integration tests: `tests/integration/clubs-auth.routes.test.ts`
- Home page polish: 3-column card layout, aligned buttons, correct tab title ("Footbag Worldwide"), fixed active nav highlight
- Hero text updates: clubs intro, members intro

**Remaining this sprint:**

### Item 1 — Members ungating

**Blocked on:** James confirming legacy data complete and member-list presentation reviewed.

When unblocked:
- Remove `authMiddleware` from `/members` and `/members/:personId` in `src/routes/publicRoutes.ts`
- Review member-list template for presentation issues before removing gate
- Update `docs/GOVERNANCE.md` note if needed
- Integration test: confirm `/members` returns 200 without auth
- Fully clean and integrate club-member data

### Item 2 — World records page

**Blocked on:** James providing the records CSV file.

Route: `/records` (new public page). Sequencing: extend-service-contract → add-public-page → write-tests → doc-sync

- `legacy_data/scripts/extract_records.py` (new): explore `legacy_data/mirror_footbag_org/` for world records pages; output `legacy_data/seed/records.csv` (gitignored); columns TBD after mirror exploration (expected: discipline, record_holder, record_value, date_set, location, notes)
- `legacy_data/scripts/load_records_seed.py` (new): load into DB; evaluate at sprint start whether a `world_records` table is needed or existing schema fits
- Wire both scripts into `scripts/reset-local-db.sh`
- `src/services/recordsService.ts` (new): `listWorldRecords(): WorldRecord[]`
- `src/controllers/recordsController.ts` (new)
- `src/views/public/records.hbs` (new): records grouped by discipline
- Add `/records` to nav in `src/views/layouts/main.hbs`
- Add `/records` route in `src/routes/publicRoutes.ts`
- Integration tests for GET `/records`

### Completed last sprint (clubs sprint + infra sprint)

Key deliverables: clubs page with real legacy data (world map, country pages, detail pages), home page polish, 404/500 error pages, data-independent smoke check, terraform fmt/validate CI job, branch protection on main. Three deploy scripts created: `scripts/deploy-code.sh` (code-only, DB untouched), `scripts/deploy-rebuild.sh` (destructive staging/dev DB rebuild), `scripts/deploy-migrate.sh` (stub, not yet implemented).

### Decisions for this sprint

- Members ungating: BLOCKED — do not remove `requireAuth` until James confirms legacy data complete and member-list presentation is reviewed
- Club join/leave flows: out of scope
- World records schema: evaluate at sprint start whether a `world_records` table is needed
- Real login (Phase 4 auth): DEFERRED — legacy data must be 100% before member onboarding
- `src/types/page.ts` is live and correct; `PageViewModel<TContent>` contract enforced across non-home public pages

### Sprint verification checklist

1. `bash scripts/reset-local-db.sh` — completes without errors
2. `npm run dev` → visit `http://localhost:3000/clubs` — world map + clubs listed by country
3. `npm test` — all tests pass
4. `bash scripts/deploy-code.sh '<password>'` — code-only deploy (DB untouched), smoke check passes

## Next sprint (planned, not yet active)

### Sprint: (pending — Member Auth is now active; see above)

---

### Sprint: Member Auth + Profile MVP (NOW ACTIVE)

**Goal:** Replace the single-credential stub with multi-user DB-backed login. Seed real test member accounts (David Leberknight, James Leberknight, Julie Symons). Give logged-in members a navigable account area with a real profile view/edit and stub pages for all future member features. Make the distinction between historical persons and active member accounts explicit in the UI.

**Pre-implementation gate:** Read `docs/GOVERNANCE.md` before any work touching auth, members, or historical-persons visibility.

**Decisions for this sprint:**
- Auth is DB-backed via `identityAccessService.verifyMemberCredentials`. Env-var stub fallback remains for dev convenience.
- Login form uses `email` field. The `login_email` column accepts any string; real members use email addresses.
- **Known deviation:** "Footbag Hacky" is a seeded stub account with `login_email = 'footbag'` (not a real email). Preserves existing dev login path through real DB-backed auth. Unblock: remove when no longer needed for development.
- Schema: `account_tokens` with `token_type = 'account_claim'` handles claim tokens. No new table needed.
- Seed password via `STUB_PASSWORD` env var (never in checked-in files).
- Account creation uses `/register` flow (Item G); no batch seed of named accounts.
- Avatar: upload implemented with local photo storage (Busboy streaming, 5 MB limit). No S3/media pipeline this sprint.
- Historical persons live at `/history/*` with clear "Historical Records" labeling.
- `/members/:memberId` has conditional visibility: public read-only for HoF/BAP members; login required for all others.
- Claim email deviation: in non-production, the claim link will be shown on-screen (email outbox deferred). See accepted deviations.

**Items:**

#### Item A — DB-backed multi-user auth ✓ DONE

- `argon2` for `argon2id` hashing
- `src/db/db.ts` statements: `findMemberByEmail(email)`, `updateMemberLastLogin(memberId)`
- `src/services/identityAccessService.ts`: `verifyMemberCredentials(email, password)` returns member row or null
- `authController.postLogin`: DB-first verification, env-var stub fallback for dev
- Session cookie carries `userId`, `role`, `displayName`, `slug`
- Integration tests: login with DB credentials, bad password, stub user fallback

#### Item B — Test seed data ✓ DONE

- `legacy_data/scripts/seed_members.py`: creates the Footbag Hacky stub account (`login_email = 'footbag'`); argon2 parameters match the Node.js `argon2` package defaults
- Password from `STUB_PASSWORD` env var; `--allow-missing-passwords` flag for local dev
- Wired into `scripts/reset-local-db.sh`
- Other member accounts are created via the `/register` flow (Item G)

#### Item C — Legacy account claim (real partial implementation)

Route prefix: `/history/claim` (not `/account/claim` — see routing design change note above). Sequencing: extend-service-contract → add-public-page → write-tests.

Follows `M_Claim_Legacy_Account` user story in full except the email send step (see deviation below).

- No new table needed: `account_tokens` (already in schema) handles claim tokens via `token_type = 'account_claim'` and `target_member_id` (the imported placeholder row). See `docs/DATA_MODEL.md §4.19`.
- `legacyClaim` DB statement group targeting `account_tokens`: find placeholder by legacy_member_id / legacy_user_id / legacy_email; create/find/consume token (insert into `account_tokens` with `token_type = 'account_claim'`); atomic merge + placeholder delete
- `identityAccessService`: `initiateClaim`, `validateClaimToken`, `completeClaim`
- Routes: `GET /history/claim`, `POST /history/claim`, `GET /history/claim/verify/:token`, `POST /history/claim/verify/:token`
- Templates: claim form, claim-sent page (with dev claim link), claim-verify confirmation
- Integration tests: lookup found/not-found (enumeration-safe), token validation, wrong-member check, confirm merge + placeholder deleted

**Accepted deviation:** claim link is shown on-screen in non-production (email outbox deferred). Unblock: Phase 4-D email outbox activation.
**Out of scope this sprint:** `M_Review_Legacy_Club_Data_During_Claim` (no provisional club leadership data). Unblock: club-member leadership import.

#### Item D — Member account area (routes + nav) ✓ DONE

**Real (full implementation):**
- `GET /members` (auth-gated) — redirect to `/members/:slug` (own profile)
- `GET /members/:memberId` — own profile (auth required) or public read-only for HoF/BAP members; non-HoF/BAP visitors redirected to login
- `GET /members/:memberId/edit` + `POST /members/:memberId/edit` (auth, own-profile only) — edit display name, bio, city, region, country, phone, email visibility
- `GET /members/:memberId/avatar` + `POST /members/:memberId/avatar` (auth, own-profile only) — avatar upload (Busboy streaming, 5 MB limit, local photo storage)

**Stub pages (placeholder "coming soon" template, own-profile only):**
- `GET /members/:memberId/media` — Share Media
- `GET /members/:memberId/settings` — Account Settings
- `GET /members/:memberId/password` — Change Password
- `GET /members/:memberId/download` — Download My Data
- `GET /members/:memberId/delete` — Delete Account

**Nav:** "My Account" link in `main.hbs` when `isAuthenticated`; shows member display name

#### Item E — Historical persons page label ✓ DONE

- Add a visible "Historical Records" label / explainer to `/members` index and detail pages
- Short text: these are legacy imported player records, not current member accounts
- No data or routing changes; templates only

#### Item F — Integration tests ✓ DONE

- `tests/integration/auth.routes.test.ts` — login with DB credentials, bad password, stub fallback
- `tests/integration/register.routes.test.ts` — registration, validation, email conflict
- `tests/integration/member.routes.test.ts` — profile view/edit, auth gates, cross-member guards
- `tests/integration/avatar.routes.test.ts` — avatar upload, validation, size limits
- `tests/integration/clubs-auth.routes.test.ts` — clubs routes
- `tests/integration/app.routes.test.ts` — health, home, clubs, hof, events, login, logout, auth redirects, history, 404
- Total: 148 tests across 6 files

#### Item G — Account registration ✓ DONE

Implemented during the sprint but not originally planned as a separate item.

- `GET /register` — registration form (redirects to profile if already authenticated)
- `POST /register` — creates member account via `identityAccessService.registerMember()`; validates display name, email uniqueness, password match/strength; auto-logs in on success
- `src/views/auth/register.hbs` — registration template
- Integration tests in `tests/integration/register.routes.test.ts`

**Sprint verification checklist:**
1. `bash scripts/reset-local-db.sh` — completes, seeds Footbag Hacky account
2. `npm test` — all 148 tests pass (6 files)
3. `npm run build` — clean TypeScript compilation
4. Log in as Footbag Hacky → see profile → edit bio → save → see change
5. Register a new account → auto-login → see profile
6. Visit `/history` → see "Historical Records" label
7. Visit `/members/:memberId` for a HoF/BAP member without auth → see public profile

**Out of scope:**
- Email verification flow
- Password reset / change password (stub page only)
- S3 media pipeline (avatar upload uses local photo storage only)
- Account deletion, data export (stub pages only)
- `M_Review_Legacy_Club_Data_During_Claim` sub-flow (no provisional club leadership rows exist yet)
- Public member directory / search
- Membership tiers / dues
- Email outbox activation (claim link shown on-screen in dev as accepted deviation)
- Auth hardening (JWT, CSRF, session invalidation) -- Phase 4-A'

---

## Drafted next, but not active code focus now

- BAP honor-roll pages — deferred; member-page indicators are already implemented
- Broader service contracts may remain documented in `docs/SERVICE_CATALOG.md`, but implementation status is governed here, not there.

## Out of scope now

- Schema migration framework — schema changes are handled by rebuilding the DB; no migration runner needed
- Full auth implementation (Phase 4 sequencing unchanged; deferred until legacy data is complete)
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
- `/` — home page
- `/clubs` — real data; SVG world map (JS-enhanced, degrades to list, hidden mobile); country index
- `/clubs/:slug` — handles both country pages (clubs grouped by region) and individual club detail pages
- `/hof` — Hall of Fame landing page; links out to standalone HoF site
- `/events` — event listing
- `/events/year/:year` — year archive
- `/events/:eventKey` — event detail
- `/history` — historical persons index ("Historical Records" label)
- `/history/:personId` — historical person detail
- `/members` (auth-gated) — redirects to own profile
- `/members/:memberId` — own profile (auth required) or public read-only for HoF/BAP members; non-HoF/BAP visitors redirected to login
- `/members/:memberId/edit` (auth, own-profile only) — profile editor
- `/members/:memberId/avatar` (auth, own-profile only) — avatar upload
- `/members/:memberId/:section` (auth, own-profile only) — stub pages (media, settings, password, download, delete)
- `GET /login` — DB-backed login form
- `POST /login` — DB-first auth with env-var fallback; sets session cookie
- `GET /register` — account creation form
- `POST /register` — creates member account, auto-logs in
- `POST /logout` — clears session cookie, redirects to referrer or `/`
- `/health/live`
- `/health/ready`

Real historical data is loaded and visible on public routes.

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
- canonical verification commands: `npm test` and `npm run build`
- route and integration tests are the first verification path
- 148 tests across 6 files:
  - `app.routes.test.ts` — health, home, clubs, hof, events (list/year/detail), login, logout, auth redirects, history, 404
  - `auth.routes.test.ts` — DB-backed login, bad password, stub fallback
  - `register.routes.test.ts` — registration, validation, email conflicts
  - `member.routes.test.ts` — profile view/edit, auth gates, cross-member guards, public HoF/BAP profiles
  - `avatar.routes.test.ts` — avatar upload, validation, size limits
  - `clubs-auth.routes.test.ts` — clubs routes
- not yet covered: 500 error handler, world-record routes, honor-roll routes (deferred), worker behavior, legacy claim flow, browser/UI verification
- browser verification is explicit-human-request-only

## Accepted temporary deviations

These are known, intentional shortcuts. Each has an explicit unblock condition. Agents must not treat long-term docs, prior memory, or broader catalog docs as overriding these.
For current implementation work, this plan governs current scope.
Long-term catalogs should preserve target design; current-slice exceptions belong here, not as scattered caveats throughout every cataloged page.

1. **Auth is DB-backed but not hardened.** HMAC-signed cookie with DB-backed argon2 credential verification. Env-var stub fallback remains for dev. No CSRF flow, no password-version or session-invalidation model, no JWT. Unblock: replace with real JWT/DB sessions, add CSRF, session invalidation before production member onboarding.

2. **Member profiles have conditional public visibility.** `/members/:memberId` is publicly visible for HoF/BAP members (read-only profile with competitive results). All other member profiles require authentication. `/members` (landing) is auth-gated and redirects to own profile. Historical persons live at `/history/*` (separate from member profiles). Unblock: finalize the privacy-safe public member discovery/search design.

3. **No public member directory or search.** There is no public member listing page. `/members` redirects authenticated users to their own profile. Historical persons are browsable at `/history`. Unblock: design and implement a privacy-safe public member directory.

4. **Worker has no real jobs.** `worker.ts` exits cleanly; the worker container is scaffolded only. No outbox, email, or background-job processing is active. Unblock: Phase 4 email outbox activation.

5. **No closed backup/restore workflow.** S3 bucket is scaffolded; no backup producer exists in app or worker; no restore drill has been run. `/health/ready` is a DB-probe only. Unblock: implement backup job in worker and run a restore rehearsal before any production data is at risk.

6. **Maintenance mode is not production-grade.** CloudFront maintenance-origin/error behavior is omitted from Terraform; direct-origin failover is not implemented. Unblock: Phase 1-E CloudFront pass 2.

7. **CloudFront hardening incomplete.** X-Origin-Verify header is absent from Nginx; OAC/ordered-cache controls are deferred; direct-origin bypass is unprotected. Unblock: Phase 1-F security hardening.

8. **CI/CD pipeline is partial.** App CI is active: `.github/workflows/ci.yml` runs `npm run build` + `npm test` + terraform fmt/validate on push and PR. Three deploy scripts exist: `scripts/deploy-code.sh` (code-only), `scripts/deploy-rebuild.sh` (destructive DB rebuild), `scripts/deploy-migrate.sh` (stub, not yet implemented). Remaining gaps: CloudFront not wired into CI (1-E), security hardening (1-F), CloudWatch agent not installed (1-G). Unblock: Phase 1-E/F/G.

9. **Monitoring is partial and intentionally gated.** CloudWatch log groups and alarms are Terraformed; CloudWatch agent install is TODO; monitoring gates default false; backup freshness metric has no producer. Unblock: Phase 1-G agent install + backup job.

10. **Runtime config is manually managed.** App reads local env vars from `/srv/footbag/env` only. SSM/IAM scaffolding exists but app runtime does not consume it. Unblock: when runtime AWS calls (SSM, S3, SES, KMS) are activated.

11. **Bootstrap security shortcuts remain.** Operator IAM and SSH access use bootstrap-era posture, not the final hardened model. Unblock: explicit security hardening pass before production launch.

12. **Browser validation is manual-only.** No automated browser/UI tests. Route and integration tests are the first verification path. Browser checks are explicit-human-request-only.

13. **`image` container is absent.** Docker Compose defines `nginx`, `web`, and `worker`; the `image` container (photo processing, S3 sync) is a later-phase artifact and is not present. Unblock: Phase 3+ media pipeline work.

14. **`/health/ready` is a DB-probe only.** Current implementation validates only the minimal SQLite readiness path. Long-term design includes memory-pressure gating and broader dependency checks (see `docs/DESIGN_DECISIONS.md §8.4`). Unblock: Phase 1-G monitoring pass + backup job activation.

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
  ← legacy import scripts (CSVs ready, build scripts exist)
    ← migration strategy (numbered migrations must precede schema evolution)

CI/CD automation — COMPLETE (app CI + deploy scripts: deploy-code.sh, deploy-rebuild.sh)
  ← staging running end-to-end
    ← AWS host bootstrap COMPLETE
  remaining: 1-E CloudFront, 1-F security hardening, 1-G CloudWatch agent
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

**Gate:** COMPLETE — site is live on staging, all public routes serving, CloudFront responding, SNS confirmed.

---

### Phase 1 — Verification foundation + CI/CD

**Goal:** Iteration is safe. Deploys are one-command. CI catches regressions before they reach staging.

**Note: Phase 1 infra tasks run in parallel with the current feature slice. They are not blockers for feature work.**

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 1-E | CloudFront pass 2: enable_cloudfront = true in Terraform, apply to staging | M | Phase 0 gate |
| 1-F | Security hardening: X-Origin-Verify header (CloudFront → origin validation), S3 OAC | M | 1-E |
| 1-G | CloudWatch agent install on host | S | Phase 0 gate |

**Gate:** PARTIAL — app CI green, deploy scripts exist (deploy-code.sh, deploy-rebuild.sh). Remaining: CloudFront fully active on staging (1-E), CloudWatch receiving metrics (1-G).

---

### Phase 2 — Legacy data import

**Goal:** Real historical data is visible on the public site.

**Note: No migration framework. Schema changes require a DB rebuild using `database/schema.sql` + seed pipeline.**

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 2-C | Integration tests: fixture-based tests verifying imported events + results appear on public routes | M | — |
| 2-D | Production deploy (after staging validated) | S | Phase 1 gate |
| 2-E | Broader legacy event import: assess `mirror_footbag_org` coverage; import next batch from legacy mirror | L | — |

**Notes:**
- Historical data is loaded. Real events and members are visible on public routes.
- Imported persons are **not** activated member accounts. Identity records only, for future account-claim flow.

**Gate:** Imported events and results are visible on staging. Production deploy approved.

---

### Phase 3 — Clubs page + broader data

**Goal:** Clubs page is live with real data. Broader legacy event coverage begins.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 3-E | Broader legacy event import: assess `mirror_footbag_org` coverage; import next batch of historical events | L | 2-B |
| 3-F | Production deploy (if staging validated from Phase 2 and CloudFront active) | M | Phase 2 gate, 1-E |

**Gate:** `/clubs` serves real data (DONE). Production deploy pending 1-E/staging validation.

---

### Phase 4 — Auth hardening + email activation

**Goal:** Harden auth (JWT, CSRF, session invalidation). Activate email delivery. Complete legacy claim flow. Enable password reset.

**Already implemented (from Member Auth + Profile MVP sprint):**
- ✓ 4-A (partial): DB-backed auth with argon2 password hashing, HMAC-signed session cookie. Not yet: JWT, per-request DB state check, CSRF, session invalidation.
- ✓ 4-B (partial): `IdentityAccessService` with `verifyMemberCredentials`, `registerMember`. Not yet: password-version tracking, session invalidation on password change.
- ✓ 4-C: Login, register, logout pages + controllers fully implemented and tested.
- ✓ 4-F (partial): Legacy claim is the one remaining item in the current sprint. Service methods, routes, and templates not yet built.
- ✓ 4-H (partial): 148 integration tests covering login, registration, member profiles. Not yet: claim flow, password reset, session invalidation.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 4-A' | Auth hardening: JWT cookie, per-request DB state check, CSRF protection, password-version session invalidation | L | — |
| 4-D | Email outbox worker: activate `worker.ts` stub for outbox_emails processing via SES | L | Phase 0 gate (SES configured) |
| 4-E | Email verification flow: registration sends verification email, link activates account | M | 4-D |
| 4-F' | Legacy claim flow completion: routes, templates, service methods (see current sprint Item C) | M | — |
| 4-G | Password reset flow: email-based reset using outbox worker | M | 4-D |

**Notes:**
- JWT sessions are NOT sufficient authority alone; current DB state must be checked on every request (see `PROJECT_SUMMARY_CONCISE.md` auth invariants).
- Password changes must invalidate sessions via the password-version mechanism.
- State-changing routes must follow documented CSRF / HTTP semantics patterns.
- Do not begin organizer write flows or admin work queue until 4-A' is solid and tested.

**Gate:** Auth is hardened (JWT, CSRF, session invalidation). Members can verify email, claim legacy identities, and reset passwords via email.

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

Legacy data import directly affects the current public event/results surface and introduces identity/account risks beyond simple event ingestion. Historical data is loaded and visible on public routes. Broader import coverage is in Phase 2-E / 3-E.

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

**Gate:** Do not implement until Julie's official published wording exists. For each change, classify impact: docs-only / config-only / schema-affecting / service-logic affecting / UI-display affecting.

---

## Cross-cutting prerequisites before wider feature expansion

1. Schema changes require a DB rebuild (no migration runner; rebuild from `database/schema.sql` + seed pipeline).
2. Import-safe verification scripts and fixture coverage (Phase 2-C).
3. Browser checks are explicit-human-request-only; no automation without explicit ask.
4. Auth invariants from `PROJECT_SUMMARY_CONCISE.md` enforced before any write flow.

---

## Open risks and decisions

- Legacy claim flow (Item C) is the remaining sprint item; claim routes and service methods not yet built.
- Password reset depends on email outbox activation (Phase 4-D).
- Current readiness implementation is intentionally narrower than long-term docs.
- Canonical docs remain broader than implemented code; phase planning must constantly separate implemented from intended.
- Schema file is `database/schema.sql` (unversioned); seed pipeline runs via `scripts/reset-local-db.sh`.
- Production deploy timing is conditional on Phase 2 staging validation.
- IFPA rules integration is an external dependency (Julie's published wording).
