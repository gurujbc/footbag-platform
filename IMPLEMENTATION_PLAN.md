# IMPLEMENTATION_PLAN.md

Current-slice tracker and scope governor. Source of truth for active sprint status, accepted shortcuts, and in-scope vs out-of-scope boundaries. "Slice" and "sprint" are used interchangeably.

## Active slice now

### Parallel tracks (current sprint)

Three developers work in parallel. **AI assistants: read only the track section matching the active developer; other tracks are out-of-scope noise.** Identify the developer from the git user, the prompt, or by asking.

| Dev | Handle | Track | Section |
|---|---|---|---|
| Dave | (primary maintainer) | Auth hardening + email activation (back-end infra + security) | "Sprint: Auth hardening + email activation" |
| James | JamesLeberknight | Historical pipeline completion (data import / legacy migration) | "James's sprint" |
| John | guruJBC | Look-and-feel enhancements (visual / design polish) | "John's track" |

Cross-track changes require explicit human coordination.

### Sprint: Auth hardening + email activation

**Status:** All code complete; staging deployed and behaviorally smoke-validated end-to-end (login → KMS-signed JWT; register → outbox → SES → recipient inbox). Three-table identity refactor fully landed (members + historical_persons FKs to `legacy_members`; UNIQUE indexes in place; `legacy_members` temporarily populated with 2,507 rows from `legacy_data/scripts/load_legacy_members_seed.py` pending the legacy-account export — see item 12 in James's sprint). Tests: 833/833; tsc clean.

**Active gotcha — must revert before prod cutover:** JWT `exp` and session-cookie `maxAge` temporarily reduced from 24h to 10 minutes for staging observability. `src/services/jwtService.ts DEFAULT_TTL_SECONDS` and `src/middleware/auth.ts SESSION_COOKIE_MAX_AGE_MS`. DD §3.5 baseline is 24h.

**Known deviation — staging SES sender (pending `footbag.org` domain acquisition):** `SES_FROM_IDENTITY` and the `OutboundEmail` IAM policy resource ARN point to a Google Workspace email alias on an institutional (non-`footbag.org`) domain the project controls (specific address recorded in local operator notes, never committed) instead of `noreply@footbag.org` because the domain is not yet owned by IFPA. Documented target values in `docs/DEV_ONBOARDING.md` §8.8 / §8.9 4b / §8.10b remain correct and are not rewritten.

Substitute-aware operating notes for a volunteer executing Path H while this deviation is active:

- §8.8: skip the Cloudflare Email Routing preflight (it targets `footbag.org` routing and is not relevant to the substitute domain). Before triggering the SES verification email for the substitute, send a manual test from an external account to the substitute address and confirm it arrives at the primary Workspace user's inbox; Workspace alias propagation is usually immediate but can take a few minutes on first-ever alias use. Verify the substitute address in SES in place of the canonical.
- §8.9 step 4b: the `OutboundEmail` policy `Resource` ARN is the substitute identity ARN (shape `arn:aws:ses:us-east-1:<ACCOUNT_ID>:identity/<SUBSTITUTE_ADDRESS>`), not the canonical ARN. The `JwtSigning` statement is unaffected by the substitute pattern.
- §8.10 step 5b: `SES_FROM_IDENTITY` on the host is the substitute address.

Cutover to `noreply@footbag.org` once the domain is acquired: re-run §8.8 against the canonical address, then update `SES_FROM_IDENTITY` in `/srv/footbag/env` and the `OutboundEmail` policy `Resource` ARN to point at the canonical identity, then restart the app. Later, SES domain identity with DKIM is a separate production-access activation. Env-var and IAM-policy resource-ARN update only; no code change.

**Staging wiring readiness probe:** long-term test `tests/smoke/staging-readiness.test.ts` (run via `npm run test:smoke`, gated behind `RUN_STAGING_SMOKE=1`, excluded from default `npm test`) asserts the permanent contract that staging runtime identity reaches AWS and KMS/SES calls succeed. Operator runs it from the Lightsail host or a workstation with the staging profile on every subsequent staging AWS wiring change (blocked on host-Node install per Path H carryover §3).

**Goal:** Close DD §3.2-3.5, §3.8 and USER_STORIES M_Login / M_Change_Password / M_Reset_Password / V_Register_Account. Unblocks organizer write flows, admin work queue, and all future state-changing routes.

**Path H carryovers to reconcile before prod cutover** (details in `AWS_PROJECT_SPECIFICS.md` §21.9):

1. **Lightsail browser SSH firewall override.** Console change made during §8.10 sshd-hang recovery loosened the port-22 rule beyond `operator_cidrs`. Next `terraform apply` from `terraform/staging/` will restore the tighter rule. Unblock: run `terraform apply`.
2. **STUB_PASSWORD exposed in chat.** Staging preview-user password leaked during §8.11 login test. Rotate by updating local `.env`, redeploying (which re-seeds with the new hash), and updating the vault entry. Unblock: complete rotation before any external tester receives the preview credential.
3. **Host Node runtime + tests dir absent.** DEV_ONBOARDING §8.11 implicitly assumes `node` on host PATH; no such install exists, and `scripts/deploy-rebuild.sh` rsync excludes `tests/`. Permanent fix: install Node 22 via `nodesource` and extend the rsync includes. Unblock: post-sprint infrastructure tidy-up.

**AWS prerequisite (Deliverable 0):** Operator completes the steps in `docs/DEV_ONBOARDING.md` Path H (§8): KMS asymmetric RSA-2048 SIGN_VERIFY key `alias/footbag-staging-jwt`; source-profile IAM user `footbag-staging-source-profile` (single `sts:AssumeRole` statement); runtime role `footbag-staging-app-runtime` extended with KMS Sign/GetPublicKey on the JWT key and `ses:SendEmail` (not SendRawEmail) scoped to the `noreply@footbag.org` identity, and its trust policy replaced to trust the source-profile user; SES sandbox identity for `noreply@footbag.org` and test recipient; host credential wiring in `/root/.aws/credentials` + `/root/.aws/config` (root-owned, 0600); non-secret env additions in `/srv/footbag/env`. No AWS mutation by AI assistants.

**In scope:**
- JWT sessions via AWS KMS asymmetric RSA-2048, `kid` header, 24h expiry (DD §3.5).
- Per-request DB `password_version` check; mismatch rejects JWT.
- Swappable JWT signing adapter: `LocalJwtAdapter` in dev/test (local keypair), `KmsJwtAdapter` in staging/prod. Selection via `JWT_SIGNER` env var. Both implement the `JwtSigningAdapter` interface.
- CSRF per DD §3.3: SameSite + verb discipline + Content-Type checks; no synchronizer tokens.
- Rate-limit utility (fixed window per DD §8.3) wired into login, change-password, password-reset, verify-resend.
- Email verification at registration (block-until-verified). Legacy-link check at verify-success redirect.
- Password reset flow with 5/hour per-email rate limit (DD §3.8).
- Confirmation emails for password change and password reset.
- `CommunicationService` (DD §5.5) with swappable SES adapter (`StubSesAdapter` dev/test, `LiveSesAdapter` staging/prod). Outbox drain via `OperationsPlatformService.runEmailWorker`.
- `accountTokenService` per DD §3.8 (random + SHA-256 at rest, single-use).
- Remove env-var login stub fallback (`STUB_USERNAME`/`STUB_PASSWORD`) per DD §3.9.

**Out of scope this sprint (drift notes):**
- Audit logging for password-change and login rate-limit threshold crossings (US M_Change_Password line 550 and M_Login line 512).
- Login rate-limit cooldown (`login_cooldown_minutes` seed row remains unwired; simple fixed-window only).
- Password-reset IP bucket (DD §3.8 says email-only; US M_Reset_Password line 525 says email+IP; followed DD).
- Daily token-cleanup job (DD §3.8 line 969).
- SES bounce/complaint webhook handling (DD §5.4, SERVICE_CATALOG line 973).
- JWT key rotation procedure with 24h overlap (DD §3.4 line 813).
- "Change unverified email" flow.
- SES domain identity, SES production-access, custom domain, CloudFront changes.
- JWT session re-issue on near-expiry (DD §3.4 line 807 — re-issue when `exp` < 6h). Middleware currently validates only; no re-issue.
- `SecretsAdapter` (DD §3.6) scaffold deferred until first SSM-backed secret consumer lands (Stripe API keys / admin bootstrap tokens). Add `EnvSecretsAdapter` + `SsmSecretsAdapter` together with the first consumer.

**Post-deploy one-time operator action (pending first staging deploy):**

- Backfill existing `sent` outbox rows: `sudo sqlite3 /srv/footbag/footbag.db "UPDATE outbox_emails SET body_text=NULL WHERE status='sent';"` (scrub applies to new sends automatically via `markSent`).

**Footbag Hacky** (seeded preview-user): explicitly preserved. `seed_members.py` sets `email_verified_at` so block-until-verified does not lock it out.

**Dev/prod parity:** `JWT_SIGNER=local` + `SES_ADAPTER=stub` in dev and CI; `JWT_SIGNER=kms` + `SES_ADAPTER=live` in staging/prod. Same code paths, same tests, differences confined to adapter wiring per DD §7.1.

**Verification:** `npm test` and `npm run build` per phase. Staging verification of PR1 requires AWS setup complete and code deployed; see `docs/DEV_ONBOARDING.md` Path H §8.11 for the post-deploy curl checks.

### Open production-rewrite item (carried over)

**Legacy account claim:** current code is the early-test shortcut (direct lookup + confirm + merge via `identityAccessService.lookupLegacyAccount` / `claimLegacyAccount`; routes `POST /history/claim` + `POST /history/claim/confirm`). Production rewrite moves to a dedicated `LegacyMigrationService` with email-verified token flow (`GET /history/claim/verify/:token` per `docs/SERVICE_CATALOG.md`), name reconciliation, and rate limiting. Deferred to Phase 4.

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

Email verification, password reset, S3 media pipeline, account deletion, data export, `M_Review_Legacy_Club_Data_During_Claim`, registration slug customization, public member directory, membership tiers/dues, email outbox activation, auth hardening (Phase 4-A').

**Account-deletion implementation hook:** when PII purge lands (see M_Delete_Account in `docs/USER_STORIES.md` + DD §2.4 rule 5), the purge transaction must call `legacyClaim.clearClaim(legacy_member_id)` alongside setting `personal_data_purged_at`. Prepared statement already exists at `src/db/db.ts` `legacyClaim.clearClaim`.

### Removed (do not search)

- Display name editing in profile edit. Name and slug are permanent post-registration.

### Verification

Canonical commands: `npm test` and `npm run build`. Not yet covered by tests: 500 handler, world-record routes, honor-roll routes, worker behavior, browser/UI. Browser verification is explicit-human-request-only.

---

## Next sprint (after auth hardening + email activation lands)

Tier 1 items (4-A' auth hardening and 4-D email outbox worker) are now the active Dave sprint above. These Tier 2 items remain for the sprint that follows.

- **1-G CloudWatch agent** (S)
- **Backup/restore workflow** (M): bucket scaffolded, no producer; must be in place before production data is at risk.
- **Post-auth-hardening carryovers** from the active sprint's drift notes: audit logging for password change + login rate-limit threshold, daily token-cleanup job, SES bounce/complaint webhook handling, JWT key rotation procedure with 24h overlap, login rate-limit cooldown wiring, SES domain identity + production-access ticket.
- **Catalog completeness audit** (M): VIEW_CATALOG + SERVICE_CATALOG invariant sweep. Missing items to verify are documented: `PageViewModel<TContent>` contract, thin-controller discipline, db.ts purity, service-owned URL construction, adapter pattern, file-naming conventions (`<domain>Service.ts`, `<domain>Controller.ts`, `<PageName>Content`, `<Entity>ViewModel`), error-class naming (`<Kind>Error`), shared shaping helpers (`personHref`, `shapePartnershipPair`, `shapeFreestyleRecord`, `groupPlayerResults`), HTTP helpers (`issueSessionCookie`, `handleControllerError`), Handlebars helpers, cross-catalog consistency (service entries pair with page entries).
- **Net player-route redirect cleanup** (S): `/net/players/:personId` and `/net/players/:personId/partners/:teamId` (`src/routes/publicRoutes.ts:55-59`) exist only to 302 to `/history/:personId` and `/net/teams/:teamId`. Grep for consumers; if none, delete both handlers and remove VIEW_CATALOG §5 entries. Audit other routes that exist solely to redirect beyond the intentional `/history` → `/members` canonical redirect.
- **James-authored code separation audit** (M): before go-live, confirm QC internal code is 100% separated from public release code per PIPELINE_QC.md design rules + deletion procedure. Mixed files to verify: `src/services/netService.ts` (~38% public / 62% QC), `src/controllers/netController.ts`, `src/views/net/` (target: split to `src/views/internal-qc/net/`), `src/db/db.ts` QC-only prepared-statement groups (`netReview`, `netCandidates`, `netCurated`, `netCuratedBrowse`, `netRecoverySignals`, `netRecoveryCandidates`, `netReviewSummary`, `netTeamCorrectionApproval`, `personsQc`), `database/schema.sql` QC-only tables (`net_raw_fragment`, `net_candidate_match`, `net_curated_match`, `net_recovery_alias_candidate`, `net_review_queue`). 100% QC files: `personsService.ts`, `personsQcChecks.ts`, `personsController.ts`, `src/views/persons/`. Sweep public templates for pipeline-curation columns (confidence, notes, date_precision, source_reference) — prior findings 11.1 and 11.2 flagged two sites in freestyle.
- **Approval-fatigue review v2** (S): decide whether to add `Bash(find:* -exec*)` + `Bash(find:* -execdir*)` to `permissions.deny` as mechanical backstop on top of the behavioral ban. Also cover read-only `for`/`while` loops, `xargs`, command substitution, subshells, pipelines, `if [[ -f x ]]` tests. Per class: decide hook regex vs `permissions.allow` prefix vs behavioral-only rule. Reference: repo-root `approval_fatigue.md`.
- **Preserve clubs-map anchor hooks** (XS): on country page (`/clubs/:countrySlug`), keep `id="region-{regionSlug}"` on region sections and `data-club-id="{clubId}"` on club entries. Intentional anchor-jump targets for the future interactive map.

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
15. **Terraform trust-policy stub for runtime role.** `terraform/staging/iam.tf:16-85` declares `aws_iam_role.app_runtime`'s trust policy as `ec2.amazonaws.com` (bootstrap stub from the unreachable-on-Lightsail instance-profile scaffold). Path H §8.9 step 4c Console-amended the trust policy to trust the source-profile IAM user; HCL reconciliation deferred. Source-profile + AssumeRole chain per DD §7.2 is otherwise active: long-lived keys at `/root/.aws/credentials` (root-owned, 0600), app uses `AWS_PROFILE=footbag-staging-runtime`. Unblock: post-sprint infrastructure tidy-up.
16. **Bootstrap security shortcuts remain.** Operator IAM + SSH use bootstrap posture. Unblock: pre-launch security pass.
17. **Browser validation manual-only.** Route/integration tests are first verification path.
18. **`image` container absent.** Docker Compose has `nginx`, `web`, `worker`. Unblock: Phase 3+ media pipeline.
19. **`/health/ready` is DB-probe only.** DD §8.4 adds memory-pressure gating + broader dependency checks. Unblock: 1-G + backup activation.

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
