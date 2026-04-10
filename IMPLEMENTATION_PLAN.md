# IMPLEMENTATION_PLAN.md

This document is active during normal repo work. It is the current-slice tracker and scope governor for maintainers, contributors, and AI assistants. ("slice" and "sprint" are used interchangeably.)

For non-trivial work, read this top status block first, then only the relevant downstream docs and code.
This file, not auto memory, is the source of truth for current slice status, accepted shortcuts, and in-scope vs out-of-scope boundaries.

## Source-of-truth order for active work

- `docs/USER_STORIES.md` is the functional source of truth; for current work, focus on the specific User Stories in question.
- Current code is the source of truth for implemented behavior.
- This plan governs current-slice scope, sequencing, out-of-scope boundaries, and known drift.
- Derived docs in `docs/` remain canonical references for the areas they cover, but only `docs/VIEW_CATALOG.md` is intentionally partial for the current public slice.

## Active slice now

### Parallel tracks (current sprint)

Three developers work the current sprint in parallel. **AI assistants: read only the track section matching the active developer; other tracks are out-of-scope context noise.** Identify the developer from the git user, the prompt, or by asking.

| Dev | Handle | Track | Section to read |
|---|---|---|---|
| Dave | (this repo's primary maintainer) | Member Auth + Profile MVP (functional/back-end product work) | "Sprint: Member Auth + Profile MVP" below + "Active sprint decisions" |
| James | JamesLeberknight | Historical pipeline completion (data import / legacy migration) | "James's sprint: Historical pipeline completion" |
| John | guruJBC | Look-and-feel enhancements (visual / design polish) | "John's track: Look-and-feel enhancements" |

Cross-track changes (anything that touches another track's owned files) require explicit human coordination. Do not silently broaden scope across tracks.

### Sprint: Auth + Profile MVP consolidation

**Status:** MVP items A, B, D, E, F, G complete. Item C (legacy account claim) early-test shortcut is implemented; production rewrite deferred to Phase 4 (needs Steve's export). Identity sprint Phase 1 code (name model, slug lifecycle, person links, competition history fields) is complete. Sprint has shifted from MVP build-out to consolidation: fixing low-hanging shortcuts, known divergences, and visible deviations that do not depend on external blockers (James's data, Steve's export, 4-D outbox, 4-A' auth hardening).

**Item C implementation note:** The current code is the early-test shortcut: direct lookup + confirm + merge. No email verification, no token round-trip, no rate limiting, no name reconciliation guard. The full production version requires email verification, name reconciliation (last-name mismatch blocks, first-name mismatch warns), and `first_competition_year` COALESCE. Current shortcut methods live in `identityAccessService` as `lookupLegacyClaim` and `completeClaim`; these will move to a dedicated `LegacyMigrationService` in the production rewrite. Routes are `POST /history/claim` (lookup) and `POST /history/claim/confirm` (merge), not the token-based `GET /history/claim/verify/:token` described in `SERVICE_CATALOG.md`.

**Routing (implemented):** `/members` member dashboard (auth) or welcome page (public). `/members/:memberKey/*` profiles. `/history/:personId` historical detail; `/history` redirects to `/members`. `/register` registration. Nav "Members" points to `/members`. Home Media Gallery is coming-soon (no `/media` route).

**Blocked items from prior sprints:** Members ungating and world records page both blocked on James. See "Blocked / deferred" section below.

---

### Active sprint decisions (live constraints)

- Auth is DB-backed via `identityAccessService.verifyMemberCredentials`. Env-var stub fallback remains for dev. Current session mechanism is the signed-cookie stub in `src/middleware/authStub.ts`.
- **Intentional:** "Footbag Hacky" is a seeded preview-user account using a non-email login identifier. Permanent special login for preview/demo users, not a deviation. The literal login identifier is not published in checked-in docs.
- Seed password via `STUB_PASSWORD` env var (never in checked-in files).
- Avatar: local photo storage only (Busboy streaming, 5 MB limit). No S3/media pipeline this sprint. Upload lives inline on profile-edit only (dedicated upload page removed). **Known deviation:** no server-side photo processing (resize, crop, optimization) yet; raw uploads are stored as-is. Photo processing pipeline deferred to media/S3 sprint.
- Claim email deviation: in non-production, the claim link is shown on-screen (email outbox deferred).
- `PageViewModel<TContent>` contract enforced across non-home public pages.
- **In scope this sprint (consolidation item H):** reinstate the `/events` upcoming-events region required by `docs/VIEW_CATALOG.md` §6.8 with proper empty-state behavior. Current state: region is omitted; DB has zero upcoming events (all 810 events are `completed`); the `featuredPromo` hero is hardcoded outside the service path. The `eventService.listPublicUpcomingEvents` data path remains intact. Fix path: reinstate the region with standard empty-state, leave `featuredPromo` alone for now, and keep the region ready to populate when real upcoming events land in the DB.

### Consolidation items in scope this sprint

Low-hanging fruit that does not depend on external blockers. Each closes a known divergence or shortcut without pulling in 4-A', 4-D, Steve's export, or James's work.

- **H** — `/events` upcoming-events region reinstated with empty-state (`docs/VIEW_CATALOG.md` §6.8 alignment). See deviation note above.
- **I** — Scrub literal preview-user login identifier from checked-in docs, test comments, and seed script strings. Move the literal value to an env-var-driven seed path so it exists only in local/environment config. Scope: `IMPLEMENTATION_PLAN.md` (done), `tests/integration/auth.routes.test.ts` (comments on lines 5, 65), `tests/integration/app.routes.test.ts` (comment on line 70), `legacy_data/scripts/seed_members.py` (comments on lines 90, 131 and hardcoded literal on line 93). Memory feedback rule saved.

Candidates considered and deferred:
- Avatar server-side processing (resize/crop/optimize): deferred to media/S3 sprint, not ripe now.
- Stub pages for media / settings / password / download / delete: all blocked on external sprints (4-D outbox, media pipeline, GOVERNANCE review for export/deletion).
- 4-A' auth hardening: L-sized, belongs in next sprint as scheduled.
- Backup/restore workflow: no production deploys planned for a long time (testing-only posture); remains in next-sprint Tier 2.

### Item C — Legacy account claim (early-test shortcut implemented; production rewrite in Phase 4)

The current code is the early-test shortcut. The production design targets below describe the full flow that will replace it.

Route prefix: `/history/claim`. Sequencing: extend-service-contract → add-public-page → write-tests.

Follows `M_Claim_Legacy_Account` user story in full except the email send step (see deviation below).

- `account_tokens` (already in schema) handles claim tokens via `token_type = 'account_claim'` and `target_member_id`. See `docs/DATA_MODEL.md §4.19`.
- `legacyClaim` DB statement group: find placeholder by legacy_member_id / legacy_user_id / legacy_email; create/find/consume token; atomic merge + placeholder delete
- `identityAccessService`: `initiateClaim`, `validateClaimToken`, `completeClaim`
- Routes: `GET /history/claim`, `POST /history/claim`, `POST /history/claim/confirm`
- Templates: claim form, claim confirmation
- **Name reconciliation** (production): last-name mismatch blocks merge; first-name mismatch warns
- **`first_competition_year` merge**: COALESCE; member value wins, import fills if NULL
- Integration tests: lookup found/not-found (enumeration-safe), token validation, wrong-member check, confirm merge + placeholder deleted

**Accepted deviation:** claim link shown on-screen in non-production (email outbox deferred). Unblock: Phase 4-D email outbox activation.
**Out of scope this sprint:** `M_Review_Legacy_Club_Data_During_Claim` (no provisional club leadership data). Unblock: club-member leadership import.

### Completed items (code is source of truth for details)

- **A** — DB-backed multi-user auth (argon2, session cookie, integration tests)
- **B** — Test seed data (`seed_members.py`, Footbag Hacky stub account)
- **D** — Member account area: profile view/edit, avatar upload. Stub pages: media, settings, password, download, delete
- **E** — Historical persons "Players" nav label and `/history` pages
- **F** — Integration tests (run `npm test` for current count and coverage)
- **G** — Account registration (`/register` flow, auto-login on success)
- **Identity Phase 1** — Name model (real_name + display_name, surname constraint, slug set at registration), person links (personHref helper), historical name display on profiles, `first_competition_year` and `show_competitive_results` fields

### Known current gaps vs long-term user stories

- Profile edit is narrower than the full story (external URLs, broader contact/preferences not yet implemented)
- Profile viewing is narrower (own profile + HoF/BAP public exception only; no broad member-profile viewing)
- These are accepted current-slice limitations and must not be silently erased from `docs/USER_STORIES.md`

### Out of scope this sprint

- Email verification flow
- Password reset / change password (stub page only)
- S3 media pipeline (avatar upload uses local photo storage only)
- Account deletion, data export (stub pages only)
- `M_Review_Legacy_Club_Data_During_Claim` sub-flow (no provisional club leadership rows exist yet)
- Registration slug customization (user picks own slug with surname constraint; see V_Register_Account)
- Public member directory / search
- Membership tiers / dues
- Email outbox activation
- Auth hardening (JWT, CSRF, session invalidation) -- Phase 4-A'

### Removed (do not search for these)

- Display name editing in profile edit. Name and slug are permanent post-registration.

### Verification

Canonical commands: `npm test` and `npm run build`.

Not yet covered by tests: 500 error handler, world-record routes, honor-roll routes, worker behavior, browser/UI. Browser verification is explicit-human-request-only.

---

## Next sprint: Infrastructure hardening + email activation

**Goal:** Close the highest-impact temporary deviations that block future feature work. These three items can run in parallel and together unblock the entire Phase 4 cascade (email verification, password reset, legacy claim production rewrite, organizer write flows).

### Tier 1 items (this sprint)

| # | Task | Size | Unblocks | Dependencies |
|---|------|------|----------|-------------|
| 1-E | CloudFront pass 2: enable on staging, validate, enable on production | M | 1-F security hardening, production deploy, maintenance failover | None |
| 4-A' | Auth hardening: JWT cookie, per-request DB state check, CSRF, password-version session invalidation | L | Organizer write flows, admin work queue, all state-changing routes | None |
| 4-D | Email outbox worker: activate `worker.ts` for outbox_emails via SES | L | Email verification (4-E), password reset (4-G), legacy claim rewrite (4-F'), mailing lists | SES configured (already Terraformed) |

### Sequencing notes

- 1-E, 4-A', and 4-D have no dependencies on each other; all three can proceed in parallel.
- 4-A' is the highest-risk deviation: all future state-changing routes depend on CSRF and session invalidation being in place.
- 4-D activates the worker stub that is already scaffolded; SES domain verification is already Terraformed.
- 1-E is the smallest item and the prerequisite for the rest of the Phase 1 infrastructure chain (1-F, 1-G).

### Tier 2 items (queue after Tier 1, or in parallel where independent)

- **1-G CloudWatch agent** (S): easy win, no dependency beyond Phase 0
- **Backup/restore workflow** (M): S3 bucket scaffolded, no producer yet; must be in place before production data is at risk

### Acceptance criteria

- 1-E: CloudFront active on staging with valid HTTPS; origin still reachable for health checks; `npm test` and manual staging verification pass
- 4-A': JWT-based session cookie with per-request DB state check; CSRF token on all state-changing forms; password change invalidates existing sessions; all existing integration tests pass plus new tests for session invalidation and CSRF rejection
- 4-D: Worker processes outbox_emails rows; SES sends in staging (sandbox mode acceptable); dead-letter / retry semantics defined; integration test for outbox processing

---

## James's sprint: Historical pipeline completion (parallel)

James has merged his footbag-results pipeline into this repo under `legacy_data/`. Events, results, persons, and the club extract/load scripts are in place. This sprint completes the remaining goals: club classification, bootstrap leaders, club-only persons, world records, name variants, and the legacy identity columns that the claim flow depends on.

### What is already done

- **Pipeline merged**: `legacy_data/pipeline/`, `legacy_data/scripts/`, `legacy_data/event_results/` all in repo
- **Events + results + persons soup-to-nuts**: `legacy_data/run_pipeline.sh complete` runs mirror + curated → canonical → QC → workbook → seed → DB
- **Club extract/load scripts wired**: `extract_clubs.py`, `load_clubs_seed.py`, `extract_club_members.py`, `load_club_members_seed.py` run from `scripts/reset-local-db.sh`; produces `seed/clubs.csv` (1,035 raw rows) and `seed/club_members.csv` (2,399 rows); loads `clubs` and `legacy_person_club_affiliations`
- **`legacy_data/CLAUDE.md`**: exists; currently scoped to events/results/persons pipeline only
- **`legacy_data/skills/`**: directory exists

### What still needs to be done

1. **Club-only persons extraction** (~1,600): extract people who appear in the mirror only as club members (never competed) and add them to the canonical persons set. Prerequisite for classification — otherwise active-player signals are artificially deflated for club-only clubs (per `docs/MIGRATION_PLAN.md §10.1` ordering constraint).
2. **Club classification** per `docs/MIGRATION_PLAN.md §10.1` rules R1-R9. Deterministic classifier that assigns every extracted club to pre-populate / onboarding-visible / dormant / junk. Must set `bootstrap_eligible` flag and populate `legacy_club_candidates`.
3. **Leadership inference + confidence scoring**: populate `club_bootstrap_leaders` for pre-populated clubs with `confidence_score >= 0.70`. Rules in MIGRATION_PLAN §3 bootstrap rule.
4. **Legacy identity columns** on persons: add `legacy_user_id` and `legacy_email` to the canonical persons CSV where the mirror provides them. Today the canonical `persons.csv` has only `member_id`; the claim flow needs all three keys to find placeholders by any of legacy_member_id / legacy_user_id / legacy_email.
5. **Name variants table seed** (~290 pairs): mine from identity work; seed the new variants table (schema TBD per MIGRATION_PLAN §12.16).
6. **World records CSV export**: James's pipeline has 166 tricks in its records data; export in platform-loadable format. No `out/records/` export exists in this repo yet. Unblocks the `/records` page.
7. **Persons count reconciliation**: canonical `persons.csv` has 3,366 rows; MIGRATION_PLAN §19 and §2.1 say ~4,861. James must reconcile and update MIGRATION_PLAN (or expand the canonical set) so docs and data agree.
8. **Extend `legacy_data/CLAUDE.md`**: current scope is events/results only. Add sections covering clubs, classification, bootstrap, records, variants, and `docs/MIGRATION_PLAN.md` references. Same for any associated `legacy_data/skills/`.
9. **Integrate all of the above into `run_pipeline.sh complete`**: today the `complete` target stops at events/results/persons; it must be the one entry point that also produces clubs (classified), bootstrap leaders, club-only persons, variants, and records. `scripts/reset-local-db.sh` should then simply call it. Current state: `reset-local-db.sh` runs scripts 07 (build seed) and 08 (load) directly from `legacy_data/event_results/canonical_input/` for speed, plus the club/member extract/load scripts inline. When `run_pipeline.sh complete` becomes soup-to-nuts, `reset-local-db.sh` collapses to a one-liner that delegates to it.
10. **Data review sign-off**: confirm legacy data is complete and member-list presentation is reviewed.

### Deliverables (remaining)

- Expanded canonical `persons.csv` with club-only persons and `legacy_user_id` / `legacy_email` columns populated where known
- Club classifier output: `legacy_club_candidates` rows with `bootstrap_eligible` flag per §10.1
- `club_bootstrap_leaders` rows for pre-populated clubs meeting the 0.70 confidence threshold
- Name variants seed file and schema
- World records CSV in platform format
- `run_pipeline.sh complete` as the single soup-to-nuts entry point (no extra steps required in `reset-local-db.sh` beyond calling it)
- Extended `legacy_data/CLAUDE.md` covering clubs/records/variants
- Data review sign-off

### Low-priority: score_text pass-through from legacy HTML

The UI now renders `score_text` per result row when present (player profile detail column). The schema field exists (`event_result_entries.score_text`) but the pipeline currently drops it; only 1 of 26,210 entries has a value. Legacy HTML contains extractable data worth passing through for specific disciplines where the data is interesting, good quality, and consistent:

- **Consecutives / DDOP**: kick counts in parentheses after player names, e.g. "(826)". Clean, consistent format across years. Extract as display-ready strings like "826 kicks". Present in post-1996 mirror HTML (e.g. `worlds96/results.html`). Pre-1997 sources (`authoritative-results-1980-1985.txt`, curated CSVs) have placements only, no kick counts.
- **Specific freestyle categories** (Sick 3, routine trick lists where structured per-entry): trick names or short descriptions. Include only where source HTML has consistent, structured per-entry data.

Skip generic point totals, judge scores, and net rankings. These just restate placement and add noise.

The canonical CSV schema already has `score_text` and `notes` columns (`event_results.csv`), but both are empty for all result rows today. The pipeline adapters (mirror adapter, curated adapter) would need to extract and populate `score_text` from the source HTML/text where available. The DB seed scripts (`07_build_mvfp_seed_full.py`, `08_load_mvfp_seed_full_to_sqlite.py`) already carry the field through to `event_result_entries.score_text`.

Not blocking anything. UI is ready to render whatever lands in the field.

### Unblocks

- Members ungating (requires data review sign-off)
- World records page (requires records CSV)
- Club bootstrap at cutover (requires classification + leader population)
- Auto-link coverage for club-only members (requires expanded persons.csv)
- Legacy account claim at registration (requires `legacy_member_id` / `legacy_user_id` / `legacy_email` coverage)

---

## John's track: Look-and-feel enhancements (parallel)

John (guruJBC) is working in parallel on visual / design polish: making the public site look and feel more cool, modern, and inviting. This is a design-quality track, not a feature track. It runs alongside Dave's and James's sprints and must not block either.

### AI guidance for John's prompts

**When the active developer is John, AI assistants must follow these rules:**

1. **Catalogs are guides, not handcuffs.** `docs/VIEW_CATALOG.md` and `docs/SERVICE_CATALOG.md` define the page contracts and service boundaries any *new code* must integrate with. Honor those contracts when adding or wiring up code.
2. **Look-and-feel is flexible.** John may freely experiment with templates, CSS, layout, typography, color, motion, imagery, hero treatments, card styling, spacing, and other purely visual aspects. Catalog descriptions of "look" are not binding for this track; descriptions of *contracts* (view-model field names, service method shapes, route paths, authz rules) are.
3. **Prototype / design mode is allowed within narrow limits.** Acceptable: new partials, new CSS classes, new client-side progressive-enhancement JS files, image assets, swapping component visuals, restructuring section ordering on a public page, hero/media additions, alternate card treatments, animation. Not acceptable without explicit human approval: schema changes, service-method signature changes, new routes, new domain behavior, deletions of contract fields, anything that changes what data the page receives or what URLs exist.
4. **When in doubt, ask before broadening scope.** If a visual change would force a service-shape change to look right, surface the trade-off to John before writing code instead of silently extending the contract.
5. **Doc edits still require explicit human approval** (per root `CLAUDE.md`). Visual experiments do not need doc updates as long as they stay within existing contracts.
6. **Per Dave's standing rule:** discuss significant visual / UI changes with John before writing code.

### Track scope

- Public-page polish: home, events landing, event detail, players, clubs, HoF, login/register
- Reusable visual primitives in `src/public/css/style.css` and partials under `src/views/partials/`
- Client-side progressive enhancements in `src/public/js/` (vanilla JS, no bundler)
- Static assets in `src/public/img/`
- Layout / shared chrome (`src/views/layouts/main.hbs`) — coordinate before changing site-wide chrome

### Out of scope for John's track

- Service-layer logic, DB schema, migrations, controllers (other than thin template wiring needed to render new view-model fields agreed with the owning service track)
- Authentication, member profile CRUD, identity, payments
- Legacy data pipeline
- Infrastructure, deployment, CI

### Coordination

- Visual changes that need a new view-model field must be coordinated with the relevant service-track owner (Dave for member/event/club services, James for historical/legacy data) before implementation.
- John's track may freely add `imageUrl`-style optional contract extensions through the proper service path (extend interface → populate in service → render in template → update VC), with human approval, but should not invent ad-hoc parallel data flows.

---

## Blocked / deferred

### Members ungating — work in progress

The historical players full-list page at `/history` has been removed (301 redirects to `/members`). Member search at `/members` uses the `members_searchable` view which excludes unverified placeholder rows. Historical person detail pages at `/history/:personId` still require auth for non-HoF/BAP persons. Ungating those detail pages for public access is a work in progress.

Current route split (implemented): `/history` and `/history/:personId` are historical-person surfaces; `/members/:memberKey/*` is the member-account area. No historical-person ungating change is active beyond the HoF/BAP honor-surface exceptions already implemented.

### World records page — blocked on James

Blocked on James providing the records CSV file. Route: `/records` (new public page). Sequencing: extend-service-contract → add-public-page → write-tests → doc-sync.

- `src/services/recordsService.ts`, `src/controllers/recordsController.ts`, `src/views/public/records.hbs` (new)
- Add `/records` to nav and routes
- Integration tests for GET `/records`

### BAP honor-roll pages — deferred

Member-page indicators are already implemented. Full honor-roll pages deferred.

### Broader service contracts

`docs/SERVICE_CATALOG.md` may remain broader than the active slice; implementation status is governed here, not there.

---

## Out of scope now

- Schema migration framework (schema changes handled by DB rebuild; no migration runner needed)
- Full auth implementation (Phase 4; deferred until legacy data is complete)
- Media / news / tutorial implementation work
- Broad person-identity redesign or platform-wide persons subsystem
- Fuzzy event-key rewriting or hyphen/underscore alias behavior
- A `publicController` target design

---

## Known drift rules

- `docs/VIEW_CATALOG.md` is intentionally partial and only needs to catalog implemented or actively specified current-slice views.
- `docs/SERVICE_CATALOG.md` may remain broader than the active slice and should not be treated as a status board.
- When code and docs diverge, contributors and AI assistants must say so explicitly rather than flattening the disagreement.

---

## Implementation constraints

The current deployed public slice is the baseline, not a throwaway prototype. Real historical data is loaded and visible on public routes.

- Server-rendered Express + Handlebars
- Thin controllers; service-owned page shaping and use-case logic
- One prepared-statement `db.ts` module; `db.ts` must not absorb business rules, request parsing, or generic abstractions
- Logic-light templates
- Route ordering in `publicRoutes.ts` is semantically significant (e.g., `/events/year/:year` before `/events/:eventKey`)
- `eventKey` validation and normalization live above `db.ts`
- `OperationsPlatformService` currently composes only the minimal DB readiness check
- Schema changes require a DB rebuild (no migration runner; this is intentional). Migration strategy must be in place before any schema change, even small ones.
- Canonical docs are broader than implemented code; always distinguish implemented vs intended

---

## Accepted temporary deviations

These are known, intentional shortcuts. Each has an explicit unblock condition. Agents must not treat long-term docs, prior memory, or broader catalog docs as overriding these. Long-term catalogs should preserve target design; current-slice exceptions belong here.

### Feature deviations

1. **Auth is DB-backed but not hardened.** HMAC-signed cookie with DB-backed argon2 credential verification. Env-var stub fallback remains for dev. No CSRF flow, no password-version or session-invalidation model, no JWT. Unblock: replace with real JWT/DB sessions, add CSRF, session invalidation before production member onboarding. **Scheduled: next sprint, task 4-A'.**

2. **Member profiles have conditional public visibility.** `/members/:memberKey` public for HoF/BAP (read-only), auth-required otherwise. `/members` dashboard (auth) or welcome page (public).

3. **Member search is authenticated only.** Search at `/members` covers members and historical persons with dedup. No public directory.

4. **Worker has no real jobs.** `worker.ts` exits cleanly; the worker container is scaffolded only. No outbox, email, or background-job processing is active. Unblock: Phase 4 email outbox activation. **Scheduled: next sprint, task 4-D.**

### Infrastructure deviations

5. **No closed backup/restore workflow.** S3 bucket is scaffolded; no backup producer exists; no restore drill run. `/health/ready` is a DB-probe only. Unblock: implement backup job in worker and run a restore rehearsal before any production data is at risk.

6. **Maintenance mode is not production-grade.** CloudFront maintenance-origin/error behavior is omitted from Terraform; direct-origin failover not implemented. Unblock: Phase 1-E CloudFront pass 2. **Partially addressed: next sprint, task 1-E enables CloudFront; maintenance page deferred to 1-F.**

7. **CloudFront hardening incomplete.** X-Origin-Verify header absent from Nginx; OAC/ordered-cache controls deferred; direct-origin bypass unprotected. Unblock: Phase 1-F security hardening.

8. **CI/CD pipeline is partial.** App CI is active (`.github/workflows/ci.yml` runs build + test + terraform fmt/validate). Three deploy scripts: `deploy-code.sh` (code-only), `deploy-rebuild.sh` (destructive DB rebuild), `deploy-migrate.sh` (stub, not yet implemented). Remaining: CloudFront (1-E), security hardening (1-F), CloudWatch agent (1-G). **Partially addressed: next sprint, task 1-E.**

9. **Monitoring is partial and intentionally gated.** CloudWatch log groups and alarms Terraformed; agent install TODO; monitoring gates default false; backup freshness metric has no producer. Unblock: Phase 1-G.

10. **Runtime config is manually managed.** App reads local env vars from `/srv/footbag/env` only. SSM/IAM scaffolding exists but app runtime does not consume it. Unblock: when runtime AWS calls (SSM, S3, SES, KMS) are activated. **Partially addressed: next sprint, task 4-D activates first AWS runtime call (SES).**

11. **Bootstrap security shortcuts remain.** Operator IAM and SSH access use bootstrap-era posture. Unblock: explicit security hardening pass before production launch.

12. **Browser validation is manual-only.** No automated browser/UI tests. Route and integration tests are the first verification path. Browser checks are explicit-human-request-only.

13. **`image` container is absent.** Docker Compose defines `nginx`, `web`, and `worker`; the `image` container (photo processing, S3 sync) is a later-phase artifact. Unblock: Phase 3+ media pipeline work.

14. **`/health/ready` is a DB-probe only.** Long-term design includes memory-pressure gating and broader dependency checks (see `docs/DESIGN_DECISIONS.md §8.4`). Unblock: Phase 1-G monitoring pass + backup job activation.

---

## Dependency map

### Application stack
```
routes → controllers → services → db.ts prepared statements → SQLite
templates depend on service-owned page-model shaping
/health/ready depends only on minimal DB probe via OperationsPlatformService
```

### Feature dependency chain
```
auth hardening (4-A')
  ← email outbox worker (4-D)
    ← SES domain verification (already Terraformed)
  ← organizer write flows (do not begin until 4-A' is solid and tested)
  ← admin work queue

legacy member import + claim flow
  ← Steve's export
  ← James's historical pipeline (clubs + club-only persons)

CI/CD — COMPLETE (app CI + deploy scripts)
  remaining: 1-E CloudFront, 1-F security hardening, 1-G CloudWatch agent
```

### Infrastructure dependency chain
```
production deploy
  ← staging validated + CloudFront active
    ← host bootstrap (DONE)

email delivery
  ← SES domain verification + outbox worker
    ← app running in Docker on host

CloudWatch monitoring
  ← CloudWatch agent installed on host
```

---

## v0.2 blocking note

IFPA rules integration planning can continue, but implementation must wait for Julie's official published wording before rule text is treated as current. For each change, classify impact: docs-only / config-only / schema-affecting / service-logic affecting / UI-display affecting.

---

## Phase roadmap

### Phase 0 — In-flight completion
**Gate:** COMPLETE.

### Phase 1 — Verification foundation + CI/CD
**Goal:** Iteration is safe. Deploys are one-command. CI catches regressions. Phase 1 infra tasks run in parallel with feature work; they are not blockers.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 1-E | CloudFront pass 2: enable in Terraform, apply to staging | M | Phase 0 gate |
| 1-F | Security hardening: X-Origin-Verify header, S3 OAC | M | 1-E |
| 1-G | CloudWatch agent install on host | S | Phase 0 gate |

**Gate:** PARTIAL. App CI green, deploy scripts exist. Remaining: CloudFront (1-E), CloudWatch (1-G).

### Phase 2 — Legacy data import
**Goal:** Real historical data visible on public site. No migration framework; schema changes require DB rebuild.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 2-C | Integration tests: fixture-based tests for imported events + results on public routes | M | -- |
| 2-D | Production deploy (after staging validated) | S | Phase 1 gate |
| 2-E | Broader legacy event import from mirror | L | -- |

**Requirements:** Idempotent import behavior (rehearsable on staging). Deterministic test fixtures for import correctness. Explicit publish criteria before imported data goes live. Imported persons are **not** activated member accounts; they are placeholder identity records for the future account-claim flow.

**Gate:** PARTIAL. Historical data loaded and visible. Production deploy conditional on Phase 1 staging validation.

### Phase 3 — Clubs page + broader data
**Gate:** `/clubs` serves real data (DONE). Production deploy pending 1-E.

Remaining: 3-E broader legacy event import (L, depends on 2-B).

### Phase 4 — Auth hardening + email activation
**Goal:** Harden auth (JWT, CSRF, session invalidation). Activate email delivery. Complete legacy claim flow. Enable password reset.

**Already implemented (from current sprint):**
- 4-A (partial): DB-backed auth with argon2, HMAC-signed session cookie. Not yet: JWT, per-request DB state check, CSRF, session invalidation.
- 4-B (partial): `IdentityAccessService` with `verifyMemberCredentials`, `registerMember`. Not yet: password-version tracking, session invalidation on password change.
- 4-C: Login, register, logout fully implemented and tested.
- 4-F (partial): Legacy claim early-test shortcut implemented. Not yet: email verification, name reconciliation, rate limiting.

| # | Task | Size | Dependency |
|---|------|------|-----------|
| 4-A' | Auth hardening: JWT cookie, per-request DB state check, CSRF, password-version session invalidation | L | -- |
| 4-D | Email outbox worker: activate `worker.ts` stub for outbox_emails via SES | L | SES configured |
| 4-E | Email verification flow: registration sends verification email, link activates account | M | 4-D |
| 4-F' | Legacy claim production rewrite: email-verified flow, name reconciliation, rate limiting | M | -- |
| 4-G | Password reset flow: email-based reset using outbox worker | M | 4-D |

**Notes:**
- JWT sessions are NOT sufficient authority alone; DB state must be checked on every request.
- Password changes must invalidate sessions via the password-version mechanism.
- State-changing routes must follow documented CSRF / HTTP semantics patterns.
- Do not begin organizer write flows or admin work queue until 4-A' is solid and tested.

**Gate:** Auth hardened. Members can verify email, claim legacy identities, and reset passwords via email.

### Later phases (not yet sequenced)

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

## Open risks

- Password reset depends on email outbox activation (Phase 4-D).
- Production deploy timing conditional on Phase 1-E staging validation.
- IFPA rules integration is an external dependency (Julie's published wording).
- Schema file is `database/schema.sql` (unversioned); seed pipeline runs via `scripts/reset-local-db.sh`.
