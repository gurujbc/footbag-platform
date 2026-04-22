# IMPLEMENTATION_PLAN.md

Current-slice tracker and scope governor. Source of truth for active sprint status, accepted shortcuts, and in-scope vs out-of-scope boundaries. "Slice" and "sprint" are used interchangeably.

## Active slice now

### Parallel tracks (current sprint)

Three developers work in parallel. **AI assistants: read only the track section matching the active developer; other tracks are out-of-scope noise.** Identify the developer from the git user, the prompt, or by asking.

| Dev | Handle | Track | Section |
|---|---|---|---|
| Dave | (primary maintainer) | Tier 2 hardening + pre-cutover (CloudWatch, backup, audit logging, catalog audit) | "Sprint: Tier 2 hardening + pre-cutover checklist" |
| James | JamesLeberknight | Historical pipeline completion (data import / legacy migration) | "James's sprint" |
| John | guruJBC | Look-and-feel enhancements (visual / design polish) | "John's track" |

Cross-track changes require explicit human coordination.

### Sprint: Tier 2 hardening + pre-cutover checklist

**Pre-prod cutover checklist (deferred, do not start):**

1. JWT TTL revert: `exp` + session-cookie `maxAge` from staging 10min back to 24h baseline. `src/services/jwtService.ts DEFAULT_TTL_SECONDS`, `src/middleware/auth.ts SESSION_COOKIE_MAX_AGE_MS`. DD §3.5.
2. SES sender cutover to `noreply@footbag.org`: re-run `docs/DEV_ONBOARDING.md` §8.8 against the canonical address, update `SES_FROM_IDENTITY` in `/srv/footbag/env` and the `OutboundEmail` policy `Resource` ARN to the canonical identity, restart the app. Env + IAM only, no code. Blocked on IFPA domain acquisition.
3. SES sandbox-mode flip: once the SES production-access ticket is approved (see post-auth-hardening carryover below), set `SES_SANDBOX_MODE=0` in `/srv/footbag/env` or remove the line, then restart. Clears the staging-warning card on email-gated pages (DD §5.6). Env only, no code.
4. `terraform apply` from `terraform/staging/` to restore tight port-22 rule (Path H §8.10 browser-SSH override loosened beyond `operator_cidrs`).

**Staging wiring readiness probe:** long-term test `tests/smoke/staging-readiness.test.ts` (run via `npm run test:smoke`, gated behind `RUN_STAGING_SMOKE=1`, excluded from default `npm test`) asserts the permanent contract that staging runtime identity reaches AWS and KMS/SES calls succeed. Operator runs it from the Lightsail host or a workstation with the staging profile on every subsequent staging AWS wiring change (blocked on host-Node install below).

**In scope (review tasks first, then build):**

- **Catalog completeness audit** (M). `docs/VIEW_CATALOG.md` + `docs/SERVICE_CATALOG.md` invariant sweep: `PageViewModel<TContent>` contract, thin-controller discipline, db.ts purity, service-owned URL construction, adapter pattern, file-naming conventions (`<domain>Service.ts`, `<domain>Controller.ts`, `<PageName>Content`, `<Entity>ViewModel`), error-class naming (`<Kind>Error`), shared shaping helpers (`personHref`, `shapePartnershipPair`, `shapeFreestyleRecord`, `groupPlayerResults`), HTTP helpers (`issueSessionCookie`, `handleControllerError`), Handlebars helpers, cross-catalog consistency.
- **QC code separation audit** (M). Before go-live, confirm QC internal code is 100% separated from public release per `PIPELINE_QC.md`. Mixed files: `src/services/netService.ts` (~38% public / 62% QC), `src/controllers/netController.ts`, `src/views/net/` (target split: `src/views/internal-qc/net/`), `src/db/db.ts` QC-only statement groups (`netReview`, `netCandidates`, `netCurated`, `netCuratedBrowse`, `netRecoverySignals`, `netRecoveryCandidates`, `netReviewSummary`, `netTeamCorrectionApproval`, `personsQc`), `database/schema.sql` QC-only tables (`net_raw_fragment`, `net_candidate_match`, `net_curated_match`, `net_recovery_alias_candidate`, `net_review_queue`). 100% QC files: `personsService.ts`, `personsQcChecks.ts`, `personsController.ts`, `src/views/persons/`. Sweep public templates for pipeline-curation columns (confidence, notes, date_precision, source_reference); prior findings 11.1 and 11.2 flagged two sites in freestyle.
- **Net player-route redirect cleanup** (S). `/net/players/:personId` and `/net/players/:personId/partners/:teamId` (`src/routes/publicRoutes.ts:55-59`) only 302 to `/history/:personId` and `/net/teams/:teamId`. Grep for consumers; if none, delete both handlers and remove VIEW_CATALOG §5 entries. Audit other redirect-only routes beyond the intentional `/history` to `/members` canonical.
- **Approval-fatigue review v2** (S). Decide per class hook-regex vs `permissions.allow` prefix vs behavioral-only rule: `Bash(find:* -exec*)` + `-execdir*` mechanical backstop on top of the behavioral ban, read-only `for`/`while` loops, `xargs`, command substitution, subshells, pipelines, `if [[ -f x ]]` tests. Reference: repo-root `approval_fatigue.md`.
- **Post-auth-hardening carryovers:** audit logging for password-change and login rate-limit threshold crossings (US M_Change_Password line 550, M_Login line 512); daily token-cleanup job (DD §3.8 line 969); SES bounce/complaint webhook (DD §5.4, SERVICE_CATALOG line 973); JWT key rotation with 24h overlap (DD §3.4 line 813); login rate-limit cooldown wiring (`login_cooldown_minutes` seed row); SES domain identity + production-access ticket.
- **1-G CloudWatch agent** (S). Unblocks richer `/health/ready` memory-pressure gating per DD §8.4.
- **Backup/restore workflow** (M). S3 bucket scaffolded, no producer, no restore drill. Must land before prod data is at risk.
- **Preserve clubs-map anchor hooks** (XS). Retain `id="region-{regionSlug}"` on region sections and `data-club-id="{clubId}"` on club entries on `/clubs/:countrySlug`; intentional anchor-jump targets for the future interactive map.

**Post-sprint infra tidy-up (not blocking sprint closure):** install Node 22 on staging host via nodesource; extend `scripts/deploy-rebuild.sh` rsync includes to ship `tests/` so operator can run `npm run test:smoke` on-host.

**Verification:** `npm test` and `npm run build` per change.

### Open production-rewrite item (carried over)

**Legacy account claim:** current code is the early-test shortcut (direct lookup + confirm + merge via `identityAccessService.lookupLegacyAccount` / `claimLegacyAccount`; routes `POST /history/claim` + `POST /history/claim/confirm`). Production rewrite moves to a dedicated `LegacyMigrationService` with email-verified token flow (`GET /history/claim/verify/:token` per `docs/SERVICE_CATALOG.md`), name reconciliation, and rate limiting. Deferred to Phase 4.

**Historical-person direct claim (scenarios D and E per MIGRATION_PLAN §8):** shipped. `identityAccessService.lookupHistoricalPersonForClaim` / `claimHistoricalPerson`; routes `GET /history/:personId/claim` + `POST /history/:personId/claim/confirm`; `/history/:personId` shows a "Claim this identity" CTA for authenticated viewers whose `real_name` surname matches the HP `person_name`. Surname mismatch blocks; first-name variant warns. Transitive legacy_members claim runs atomically when the HP carries an unclaimed `legacy_member_id` back-link. Will fold into `LegacyMigrationService` when that service is extracted in Phase 4.

**HP field carry-forward on claim:** shipped. Both claim paths now merge `historical_persons.country`, `hof_member`, `bap_member`, `hof_induction_year`, and `first_year` onto the member row in the same transaction that sets `members.historical_person_id`, so search / hero / public profile surfaces reflect the HP honors and country. Backfill for already-claimed members runs via the one-shot SQL in `scripts/` (below).

**Registration-time auto-link (MIGRATION_PLAN §7):** not yet implemented. Requires seeding the `name_variants` table (James's sprint §5) and wiring the tier classifier into `verifyEmailByToken`. Deferred to Phase 4-F'.

**Routing invariants:** `/members` dashboard (auth) or welcome (public); `/members/:memberKey/*` profiles; `/history/:personId` historical detail; `/history` 301s to `/members`; `/register` registration; home Media Gallery is coming-soon (no `/media` route).

### Active sprint decisions (positive state)

- Auth is DB-backed via `identityAccessService.verifyMemberCredentials`. Session mechanism is JWT (RS256, KMS or local RSA-2048 signer per env) with per-request `password_version` check. `STUB_USERNAME`/`STUB_PASSWORD` env-var fallback has been removed (DD §3.9). Legacy middleware file `src/middleware/authStub.ts` replaced by `src/middleware/auth.ts`.
- **Intentional:** "Footbag Hacky" is a seeded preview-user account using a non-email login identifier. Permanent special login for preview/demo users. Literal login identifier is not published in checked-in docs.
- Seed password via `STUB_PASSWORD` env var (never in checked-in files).
- Avatar: local photo storage only (Busboy streaming, 5 MB limit). Upload lives inline on profile-edit.
- `PageViewModel<TContent>` contract enforced across non-home public pages.
- Cache-Control: authenticated responses get `Cache-Control: private, no-store` via app middleware (app-level implementation of DD §6.7; not the AWS managed `CachingDisabled` policy).

### Consolidation items in scope this sprint

None. Items H and I deferred as known gaps (see "Current gaps" below).

Deferred candidates: avatar server-side processing (media/S3 sprint); stub pages (blocked on 4-D / media / governance); 4-A' auth hardening (next sprint); backup/restore (Tier 2 next sprint).

### Current gaps vs long-term user stories

- Profile edit is narrower than the full story (external URLs, broader contact/preferences not yet implemented)
- Profile viewing is narrower (own profile + HoF/BAP public exception only; no broad member-profile viewing)
- `/events` upcoming-events region remains omitted; reinstate (with empty-state per `docs/VIEW_CATALOG.md §6.8`) when the data contains actual upcoming events. All 810 current events are `completed`.
- Literal preview-user login identifier remains in test comments and seed script strings; the preview user (Footbag Hacky) functions as a dummy account for HoF-member previews. Scrub when revisited: `tests/integration/auth.routes.test.ts` (lines 5, 65), `tests/integration/app.routes.test.ts` (line 70), `legacy_data/scripts/seed_members.py` (lines 90, 93, 131).
- These are accepted current-slice limitations; do not silently erase them from `docs/USER_STORIES.md`.

### Out of scope this sprint

S3 media pipeline, account deletion, data export, `M_Review_Legacy_Club_Data_During_Claim`, registration slug customization, public member directory, membership tiers/dues, legacy claim production rewrite (Phase 4-F').

**Account-deletion implementation hook:** when PII purge lands (see M_Delete_Account in `docs/USER_STORIES.md` + DD §2.4 rule 5), the purge transaction must call `legacyClaim.clearClaim(legacy_member_id)` alongside setting `personal_data_purged_at`. Prepared statement already exists at `src/db/db.ts` `legacyClaim.clearClaim`.

### Removed (do not search)

- Display name editing in profile edit. Name and slug are permanent post-registration.

### Verification

Canonical commands: `npm test` and `npm run build`. Not yet covered by tests: 500 handler, world-record routes, honor-roll routes, worker behavior, browser/UI. Browser verification is explicit-human-request-only.

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
12. **Legacy-site data dump (Steve Goldberg coordination)** — final source for `legacy_members`. Current population is from `legacy_data/scripts/load_legacy_members_seed.py` (mirror-derived, 2,507 rows, columns limited to PK + `display_name` + `import_source='mirror'`). The legacy-site dump supersedes with full profile fields (`real_name`, `legacy_email`, `legacy_user_id`, `country`, `city`, `region`, `bio`, `birth_date`, `ifpa_join_date`, `first_competition_year`, `is_hof`, `is_bap`, `legacy_is_admin`) and flips `import_source` to `'legacy_site_data'`. Outstanding coordination:
    - **Namespace agreement.** The legacy-account export and mirror-derived IDs must use the same `legacy_member_id` namespace (same IDs for same real-world accounts). If they diverge, resolve before loading the export.
    - **MIGRATION_PLAN §5 + §9.** The platform-side doc rewrites (imported rows live in `legacy_members`; claim marks rather than deletes the legacy record) depend on the final dump structure. Coordinate before rewrites land.
    - **Test fixture support.** `tests/fixtures/factories.ts` already has a `legacy_members` factory and auto-creates stub rows on HP insert; additional richer fields in the legacy-account export may warrant factory extensions.

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

1. **Member profiles have conditional public visibility.** `/members/:memberKey` public for HoF/BAP; auth-required otherwise.
2. **Member search is authenticated only.** `/members` covers members + historical persons with dedup. No public directory.
3. **Avatar pipeline is local-only.** No server-side processing; raw uploads stored as-is. Stable path + `?v={media_id}` cache-bust. Unblock: S3/media pipeline.
4. **Cache-Control at app layer, not CloudFront cache policy.** DD §6.7 target is the AWS managed `CachingDisabled` policy; current is Express middleware for authenticated responses. Functionally equivalent.
5. **`/legal` `admin@footbag.org` greyed as "mailbox not yet active".** `.contact-pending` span replaces `mailto:` across Privacy, Terms, Copyright contact lines. Unblock: IFPA domain acquisition + SES identity provisioning.
6. **Vimeo click-to-load facade not implemented.** Privacy section on `/legal` states Vimeo uses the click-to-load facade; only YouTube is covered today (`youtube-facade.js`). Unblock: media pipeline (Phase 3+).

### Infrastructure deviations

7. **No closed backup/restore workflow.** S3 bucket scaffolded; no producer; no restore drill. Unblock: Tier 2 next sprint.
8. **Maintenance mode not production-grade.** CloudFront active; maintenance-origin/error behavior not implemented. Unblock: 1-F.
9. **CloudFront hardening incomplete.** X-Origin-Verify absent in Nginx; OAC/ordered-cache controls deferred; direct-origin bypass unprotected. Unblock: 1-F.
10. **CI/CD partial.** App CI active; deploy scripts: `deploy-code.sh`, `deploy-rebuild.sh`, `deploy-migrate.sh` (stub). Remaining: 1-F, 1-G.
11. **Monitoring partial and gated.** CloudWatch log groups + alarms Terraformed; agent install TODO. Unblock: 1-G.
12. **Terraform trust-policy stub for runtime role.** `terraform/staging/iam.tf:16-85` declares `aws_iam_role.app_runtime`'s trust policy as `ec2.amazonaws.com` (bootstrap stub from the unreachable-on-Lightsail instance-profile scaffold). Path H §8.9 step 4c Console-amended the trust policy to trust the source-profile IAM user; HCL reconciliation deferred. Source-profile + AssumeRole chain per DD §7.2 is otherwise active: long-lived keys at `/root/.aws/credentials` (root-owned, 0600), app uses `AWS_PROFILE=footbag-staging-runtime`. Unblock: post-sprint infrastructure tidy-up.
13. **Bootstrap security shortcuts remain.** Operator IAM + SSH use bootstrap posture. Unblock: pre-launch security pass.
14. **Browser validation manual-only.** Route/integration tests are first verification path.
15. **`image` container absent.** Docker Compose has `nginx`, `web`, `worker`. Unblock: Phase 3+ media pipeline.
16. **`/health/ready` is DB-probe only.** DD §8.4 adds memory-pressure gating + broader dependency checks. Unblock: 1-G + backup activation.

---

## Blocked / deferred

- **Members ungating**: public historical-person detail pages blocked on James's data review sign-off. Current split: `/history*` historical surfaces, `/members/:memberKey/*` member-account area.
- **World records page**: blocked on James's records CSV. Route `/records` is live; page renders without data. Controller `src/controllers/recordsController.ts`, service `src/services/recordsService.ts`, view `src/views/records/records.hbs`, tests pass.
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

**Phase 1 — Verification foundation + CI/CD.** Remaining: 1-F security hardening (M), 1-G CloudWatch agent (S).

**Phase 4 — Auth hardening + email activation.** Remaining:

| # | Task | Size | Dep |
|---|------|------|-----|
| 4-F' | Legacy claim production rewrite: email-verified flow, name reconciliation, rate limiting | M | -- |

Rules:
- JWT sessions alone are not sufficient authority; DB state must be checked per request.
- Password changes must invalidate sessions via password-version.
- State-changing routes must follow documented CSRF patterns.

Later phases (unsequenced): organizer write flows; admin work queue; membership tiers/Stripe; voting/elections; media galleries; IFPA rules integration; HoF; mailing lists; richer readiness checks.

---

## Open risks

- IFPA rules integration depends on Julie's published wording (external).
- Schema is `database/schema.sql` (unversioned); seed pipeline runs via `scripts/reset-local-db.sh`.
