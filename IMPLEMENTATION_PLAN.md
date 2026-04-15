# IMPLEMENTATION_PLAN.md

Current-slice tracker and scope governor. Source of truth for active sprint status, accepted shortcuts, and in-scope vs out-of-scope boundaries. "Slice" and "sprint" are used interchangeably.

## Active slice now

### Parallel tracks (current sprint)

Three developers work in parallel. **AI assistants: read only the track section matching the active developer; other tracks are out-of-scope noise.** Identify the developer from the git user, the prompt, or by asking.

| Dev | Handle | Track | Section |
|---|---|---|---|
| Dave | (primary maintainer) | Member Auth + Profile MVP (back-end product work) | "Sprint: Auth + Profile MVP consolidation" |
| James | JamesLeberknight | Historical pipeline completion (data import / legacy migration) | "James's sprint" |
| John | guruJBC | Look-and-feel enhancements (visual / design polish) | "John's track" |

Cross-track changes require explicit human coordination.

### Sprint: Auth + Profile MVP consolidation

**Status:** MVP items A, B, D, E, F, G complete. Item C (legacy account claim) early-test shortcut; production rewrite deferred to Phase 4. Identity Phase 1 complete. Sprint is in consolidation.

**Item C note:** Current code is the early-test shortcut: direct lookup + confirm + merge. No email verification, token round-trip, rate limiting, or name reconciliation. Shortcut methods live in `identityAccessService` as `lookupLegacyClaim` and `completeClaim`; these will move to a dedicated `LegacyMigrationService` in the production rewrite. Routes are `POST /history/claim` + `POST /history/claim/confirm`, not the token-based `GET /history/claim/verify/:token` in `SERVICE_CATALOG.md`.

**Routing (implemented):** `/members` dashboard (auth) or welcome (public). `/members/:memberKey/*` profiles. `/history/:personId` historical detail; `/history` 301s to `/members`. `/register` registration. Home Media Gallery is coming-soon (no `/media` route).

### Active sprint decisions (positive state)

- Auth is DB-backed via `identityAccessService.verifyMemberCredentials`. Env-var stub fallback remains for dev. Session mechanism is the signed-cookie stub in `src/middleware/authStub.ts`.
- **Intentional:** "Footbag Hacky" is a seeded preview-user account using a non-email login identifier. Permanent special login for preview/demo users. Literal login identifier is not published in checked-in docs.
- Seed password via `STUB_PASSWORD` env var (never in checked-in files).
- Avatar: local photo storage only (Busboy streaming, 5 MB limit). Upload lives inline on profile-edit.
- `PageViewModel<TContent>` contract enforced across non-home public pages.
- Cache-Control: authenticated responses get `Cache-Control: private, no-store` via app middleware (app-level implementation of DD §6.7; not the AWS managed `CachingDisabled` policy).

### Consolidation items in scope this sprint

- **H** — `/events` upcoming-events region reinstated with empty-state (`docs/VIEW_CATALOG.md §6.8`). Current state: region omitted; DB has zero upcoming events (all 810 are `completed`); `featuredPromo` hero is hardcoded outside the service path. Fix: reinstate with standard empty-state, leave `featuredPromo` alone.
- **I** — Scrub literal preview-user login identifier from checked-in docs, test comments, seed script strings. Scope: `tests/integration/auth.routes.test.ts` (lines 5, 65), `tests/integration/app.routes.test.ts` (line 70), `legacy_data/scripts/seed_members.py` (lines 90, 93, 131).

Deferred candidates: avatar server-side processing (media/S3 sprint); stub pages (blocked on 4-D / media / governance); 4-A' auth hardening (next sprint); backup/restore (Tier 2 next sprint).

### Completed items (code is source of truth)

- **A** — DB-backed multi-user auth (argon2, session cookie, tests)
- **B** — Test seed data (`seed_members.py`, Footbag Hacky stub account)
- **D** — Member account area: profile view/edit, avatar upload. Stubs: media, settings, password, download, delete
- **E** — Historical persons "Players" nav label and `/history` pages
- **F** — Integration tests (run `npm test` for current count)
- **G** — Account registration (`/register`, auto-login)
- **Identity Phase 1** — Name model (real_name + display_name, surname constraint, slug at registration), person links (personHref), historical name display, `first_competition_year` and `show_competitive_results`
- **1-E CloudFront** — staging + production active (April 2026).
- **Legal** — `/legal` page (Privacy, Terms, Copyright & Trademarks).
- **Net portal landing** — `/net` redesigned to mirror `/freestyle` (hero with mascot, "What is Footbag Net?" narrative, Singles/Doubles competition-format cards, data-driven Explore cards, existing notable/recent sections preserved). Cross-track: Dave (service-contract extension of `getNetHomePage`) + John (look-and-feel). Asset `src/public/img/net-mascot.svg` sourced from IFPA-owned footbagworldwide.com.

### Current gaps vs long-term user stories

- Profile edit is narrower than the full story (external URLs, broader contact/preferences not yet implemented)
- Profile viewing is narrower (own profile + HoF/BAP public exception only; no broad member-profile viewing)
- These are accepted current-slice limitations; do not silently erase them from `docs/USER_STORIES.md`.

### Out of scope this sprint

Email verification, password reset, S3 media pipeline, account deletion, data export, `M_Review_Legacy_Club_Data_During_Claim`, registration slug customization, public member directory, membership tiers/dues, email outbox activation, auth hardening (Phase 4-A').

### Removed (do not search)

- Display name editing in profile edit. Name and slug are permanent post-registration.

### Verification

Canonical commands: `npm test` and `npm run build`. Not yet covered by tests: 500 handler, world-record routes, honor-roll routes, worker behavior, browser/UI. Browser verification is explicit-human-request-only.

---

## Next sprint: Infrastructure hardening + email activation

**Goal:** Close the highest-impact deviations that block Phase 4 (email verification, password reset, legacy claim rewrite, organizer write flows).

### Tier 1 (parallel)

| # | Task | Size | Unblocks | Deps |
|---|------|------|----------|------|
| 4-A' | Auth hardening: JWT cookie, per-request DB state check, CSRF, password-version session invalidation | L | Organizer write flows, admin work queue, all state-changing routes | None |
| 4-D | Email outbox worker: activate `worker.ts` for outbox_emails via SES | L | Email verification (4-E), password reset (4-G), legacy claim rewrite (4-F'), mailing lists | SES configured (Terraformed) |

4-A' is the highest-risk deviation; all future state-changing routes depend on CSRF and session invalidation.

### Tier 2 (after Tier 1 or parallel where independent)

- **1-G CloudWatch agent** (S)
- **Backup/restore workflow** (M): bucket scaffolded, no producer; must be in place before production data is at risk.

### Acceptance criteria

- 4-A': JWT session cookie + per-request DB check; CSRF on state-changing forms; password change invalidates sessions; new tests for invalidation + CSRF rejection.
- 4-D: Worker processes outbox_emails; SES sends in staging (sandbox acceptable); DLQ/retry semantics defined; integration test for outbox processing.

---

## James's sprint: Historical pipeline completion (parallel)

James has merged his footbag-results pipeline into this repo under `legacy_data/`. Events, results, persons, and club extract/load scripts are in place. This sprint completes: club classification, bootstrap leaders, club-only persons, world records, name variants, legacy identity columns.

### Already done

- **Pipeline merged**: `legacy_data/pipeline/`, `legacy_data/scripts/`, `legacy_data/event_results/`
- **Events + results + persons soup-to-nuts**: `legacy_data/run_pipeline.sh complete` runs mirror + curated → canonical → QC → workbook → seed → DB
- **Club extract/load scripts wired**: `extract_clubs.py`, `load_clubs_seed.py`, `extract_club_members.py`, `load_club_members_seed.py` run from `scripts/reset-local-db.sh`; produces `seed/clubs.csv` (1,035 rows) and `seed/club_members.csv` (2,399 rows); loads `clubs` and `legacy_person_club_affiliations`
- **Net enrichment subsystem**: schema tables (`net_team`, `net_team_member`, `net_team_appearance`, `net_discipline_group`, `net_stat_policy`, `net_review_queue`, `net_team_appearance_canonical` view); scripts 12/13/14 under `legacy_data/event_results/scripts/`; `run_pipeline.sh net_enrichment` mode; TypeScript layer: `netService.ts`, `netController.ts`, `/net/teams` and `/net/teams/:teamId` routes, `src/views/net/` templates, Nav link; DB seeded with 4,176 teams, ~7,300 appearances, 607 QC review items
- **`legacy_data/CLAUDE.md`**: exists; currently scoped to events/results/persons pipeline only
- **`legacy_data/skills/`**: directory exists

### Still to do

1. **Club-only persons extraction** (~1,600): people who appear in mirror only as club members. Prerequisite for classification (per `docs/MIGRATION_PLAN.md §10.1`).
2. **Club classification** per `docs/MIGRATION_PLAN.md §10.1` R1–R9. Deterministic classifier → pre-populate / onboarding-visible / dormant / junk. Sets `bootstrap_eligible` flag and populates `legacy_club_candidates`.
3. **Leadership inference + confidence scoring**: populate `club_bootstrap_leaders` for pre-populated clubs with `confidence_score >= 0.70` (MIGRATION_PLAN §3).
4. **Legacy identity columns** on persons: add `legacy_user_id` and `legacy_email` to canonical persons CSV where mirror provides them. Claim flow needs all three keys.
5. **Name variants table seed** (~290 pairs): schema TBD per MIGRATION_PLAN §12.16.
6. **World records CSV export**: 166 tricks in James's records data; no `out/records/` export in repo yet. Unblocks `/records`.
7. **Persons count reconciliation**: canonical `persons.csv` has 3,366 rows; MIGRATION_PLAN §19/§2.1 say ~4,861. Reconcile.
8. **Extend `legacy_data/CLAUDE.md`**: add sections for clubs, classification, bootstrap, records, variants, `docs/MIGRATION_PLAN.md` refs.
9. **Integrate into `run_pipeline.sh complete`**: today `complete` stops at events/results/persons; extend to produce clubs (classified), bootstrap leaders, club-only persons, variants, records. `scripts/reset-local-db.sh` then collapses to a one-liner.
10. **Data review sign-off**: confirm legacy data is complete and member-list presentation is reviewed.
11. **Freestyle rules pages**: content for the four competition formats (Routine, Circle, Sick 3, Shred 30) — template(s) and route(s) for `/freestyle/rules` (single page with anchors, or per-format paths). Unblocks re-enabling the "Rules" buttons that were dropped from `/freestyle` landing competition-format cards.

### Deliverables (remaining)

- Expanded canonical `persons.csv` with club-only persons + `legacy_user_id` / `legacy_email`
- `legacy_club_candidates` rows with `bootstrap_eligible` per §10.1
- `club_bootstrap_leaders` rows for pre-populated clubs ≥0.70 confidence
- Name variants seed file + schema
- World records CSV in platform format
- `run_pipeline.sh complete` as single soup-to-nuts entry point
- Extended `legacy_data/CLAUDE.md`
- Data review sign-off

### Low-priority: score_text pass-through from legacy HTML

UI renders `score_text` per result row when present. Schema field exists (`event_result_entries.score_text`) but pipeline drops it; 1 of 26,210 entries has a value today. Legacy HTML has extractable data worth passing through:

- **Consecutives / DDOP**: kick counts in parentheses after player names, e.g. "(826)". Clean, consistent format. Extract as "826 kicks". Present post-1996. Pre-1997 sources have placements only.
- **Specific freestyle categories** (Sick 3, routine trick lists): trick names / short descriptions where source HTML is consistent.

Skip generic point totals, judge scores, net rankings. Canonical CSV schema has `score_text` + `notes` (`event_results.csv`), both empty today. Mirror/curated adapters would populate. DB seed scripts already carry the field through. Not blocking.

### Unblocks

- Members ungating (requires data review sign-off)
- World records page (requires records CSV)
- Club bootstrap at cutover (requires classification + leader population)
- Auto-link coverage for club-only members (requires expanded persons.csv)
- Legacy account claim at registration (requires three-key coverage)

---

## John's track: Look-and-feel enhancements (parallel)

John is working on visual / design polish: making the public site look more modern and inviting. Design-quality track, not feature. Must not block Dave's or James's sprints.

### AI guidance for John's prompts

1. **Catalogs are guides, not handcuffs.** `docs/VIEW_CATALOG.md` and `docs/SERVICE_CATALOG.md` define contracts that *new code* must integrate with. Honor contracts when adding code.
2. **Look-and-feel is flexible.** John may freely experiment with templates, CSS, layout, typography, color, motion, imagery, hero treatments, card styling. Catalog descriptions of "look" are not binding for this track; descriptions of *contracts* (VM field names, service shapes, route paths, authz rules) are.
3. **Prototype / design mode allowed within limits.** OK: new partials, new CSS, new progressive-enhancement JS, image assets, visual swaps, section reordering on a public page, hero/media additions, animation. Not OK without explicit human approval: schema changes, service-method signature changes, new routes, new domain behavior, deletions of contract fields, changes to page data or URL surface.
4. **When in doubt, ask** before broadening scope.
5. **Doc edits still require explicit human approval** (per root `CLAUDE.md`).
6. **Discuss significant visual/UI changes with John before writing code** (Dave's standing rule).

### Track scope

- Public-page polish: home, events landing, event detail, players, clubs, HoF, login/register
- Reusable visual primitives in `src/public/css/style.css` and partials under `src/views/partials/`
- Client-side progressive enhancements in `src/public/js/` (vanilla JS, no bundler)
- Static assets in `src/public/img/`
- Layout / shared chrome (`src/views/layouts/main.hbs`) — coordinate before site-wide changes

### Out of scope

Service-layer logic, DB schema, migrations, controllers (other than thin template wiring for new VM fields agreed with the service track owner); authentication; member CRUD; identity; payments; legacy pipeline; infra; CI.

### Coordination

Visual changes that need a new VM field must be coordinated with the relevant service-track owner (Dave for member/event/club; James for historical/legacy) before implementation. John's track may add `imageUrl`-style optional contract extensions via the proper path (extend interface → populate in service → render in template → update VC) with human approval; no ad-hoc parallel data flows.

---

## Accepted temporary deviations

Each has an explicit unblock condition. Long-term docs preserve target design; current-slice exceptions live here.

### Feature deviations

1. **Auth DB-backed but not hardened.** HMAC-signed cookie + DB-backed argon2. No CSRF, no password-version/session-invalidation, no JWT. Unblock: 4-A' (next sprint).
2. **Member profiles have conditional public visibility.** `/members/:memberKey` public for HoF/BAP; auth-required otherwise.
3. **Member search is authenticated only.** `/members` covers members + historical persons with dedup. No public directory.
4. **Worker has no real jobs.** `worker.ts` exits cleanly; scaffolded only. Unblock: 4-D (next sprint).
5. **Claim email shown on-screen in non-production.** Email outbox deferred. Unblock: 4-D.
6. **Avatar pipeline is local-only.** No server-side processing; raw uploads stored as-is. Stable path + `?v={media_id}` cache-bust. Unblock: S3/media pipeline.
7. **Cache-Control at app layer, not CloudFront cache policy.** DD §6.7 target is the AWS managed `CachingDisabled` policy; current is Express middleware for authenticated responses. Functionally equivalent.
8. **`/legal` `admin@footbag.org` greyed as "mailbox not yet active".** `.contact-pending` span replaces `mailto:` across Privacy, Terms, Copyright contact lines. Unblock: 4-D.
9. **Vimeo click-to-load facade not implemented.** Privacy section on `/legal` states Vimeo uses the click-to-load facade; only YouTube is covered today (`youtube-facade.js`). Unblock: media pipeline (Phase 3+).

### Infrastructure deviations

10. **No closed backup/restore workflow.** S3 bucket scaffolded; no producer; no restore drill. Unblock: Tier 2 next sprint.
11. **Maintenance mode not production-grade.** CloudFront active; maintenance-origin/error behavior not implemented. Unblock: 1-F.
12. **CloudFront hardening incomplete.** X-Origin-Verify absent in Nginx; OAC/ordered-cache controls deferred; direct-origin bypass unprotected. Unblock: 1-F.
13. **CI/CD partial.** App CI active; deploy scripts: `deploy-code.sh`, `deploy-rebuild.sh`, `deploy-migrate.sh` (stub). Remaining: 1-F, 1-G.
14. **Monitoring partial and gated.** CloudWatch log groups + alarms Terraformed; agent install TODO. Unblock: 1-G.
15. **Runtime config manually managed.** App reads `/srv/footbag/env`; SSM/IAM scaffolding not consumed. Unblock: first AWS runtime call (SES, via 4-D).
16. **Bootstrap security shortcuts remain.** Operator IAM + SSH use bootstrap posture. Unblock: pre-launch security pass.
17. **Browser validation manual-only.** Route/integration tests are first verification path.
18. **`image` container absent.** Docker Compose has `nginx`, `web`, `worker`. Unblock: Phase 3+ media pipeline.
19. **`/health/ready` is DB-probe only.** DD §8.4 adds memory-pressure gating + broader dependency checks. Unblock: 1-G + backup activation.

---

## Blocked / deferred

- **Members ungating**: public historical-person detail pages blocked on James's data review sign-off. Current split: `/history*` historical surfaces, `/members/:memberKey/*` member-account area.
- **World records page**: blocked on James's records CSV. Route `/records` is live; page renders without data. Controller `src/controllers/recordsController.ts`, service `src/services/consecutiveService.ts`, view `src/views/records/records.hbs`, tests pass.
- **BAP honor-roll pages**: member-page indicators implemented; full honor-roll deferred.
- **Broader service contracts**: `docs/SERVICE_CATALOG.md` may remain broader than active slice; implementation status is governed here, not there.

---

## Out of scope now

Schema migration framework (rebuild-based; intentional); full auth (Phase 4); media/news/tutorial implementation; broader person-identity redesign; fuzzy event-key rewriting; `publicController` target design.

---

## Implementation constraints

Current deployed public slice is the baseline, not a throwaway prototype. Real historical data is loaded and visible on public routes.

- Server-rendered Express + Handlebars
- Thin controllers; service-owned page shaping and use-case logic
- Single prepared-statement `db.ts`; no business rules, request parsing, or generic abstractions inside it
- Logic-light templates
- Route ordering in `publicRoutes.ts` is semantically significant (e.g., `/events/year/:year` before `/events/:eventKey`)
- `eventKey` validation/normalization above `db.ts`
- Schema changes require a DB rebuild (no migration runner; intentional). Migration strategy must be in place before any schema change.
- Canonical docs are broader than implemented code; always distinguish implemented vs intended.

---

## Known drift rules

- `docs/VIEW_CATALOG.md` is intentionally partial; only catalogs implemented or actively specified current-slice views.
- `docs/SERVICE_CATALOG.md` may remain broader than the active slice; not a status board.
- When code and docs diverge, say so explicitly rather than flattening the disagreement.

---

## v0.2 blocking note

IFPA rules integration planning can continue, but implementation must wait for Julie's official published wording before rule text is treated as current. For each change, classify impact: docs-only / config-only / schema-affecting / service-logic-affecting / UI-display-affecting.

---

## Phase roadmap (active/next only)

**Phase 0** — COMPLETE.

**Phase 1 — Verification foundation + CI/CD.** App CI green, deploy scripts exist, CloudFront active. Remaining: 1-F security hardening (M), 1-G CloudWatch agent (S).

**Phase 4 — Auth hardening + email activation.** Details in "Next sprint" above.

| # | Task | Size | Dep |
|---|------|------|-----|
| 4-A' | Auth hardening: JWT cookie, per-request DB check, CSRF, password-version session invalidation | L | -- |
| 4-D | Email outbox worker: activate `worker.ts` for outbox_emails via SES | L | SES configured |
| 4-E | Email verification: registration sends verification email, link activates | M | 4-D |
| 4-F' | Legacy claim production rewrite: email-verified flow, name reconciliation, rate limiting | M | -- |
| 4-G | Password reset via email | M | 4-D |

Rules:
- JWT sessions alone are not sufficient authority; DB state must be checked per request.
- Password changes must invalidate sessions via password-version.
- State-changing routes must follow documented CSRF patterns.
- Do not begin organizer write flows or admin work queue until 4-A' is solid and tested.

Later phases (unsequenced): organizer write flows; admin work queue; membership tiers/Stripe; voting/elections; media galleries; IFPA rules integration; HoF; mailing lists; richer readiness checks.

---

## Open risks

- Password reset depends on 4-D.
- IFPA rules integration depends on Julie's published wording (external).
- Schema is `database/schema.sql` (unversioned); seed pipeline runs via `scripts/reset-local-db.sh`.
