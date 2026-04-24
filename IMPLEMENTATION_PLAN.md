# IMPLEMENTATION_PLAN.md

Current-slice tracker and scope governor. Source of truth for active sprint status, accepted shortcuts, and in-scope vs out-of-scope boundaries. "Slice" and "sprint" are used interchangeably.

## Active slice now

### Parallel tracks (current sprint)

Two developers work in parallel. **AI assistants: read only the track section matching the active developer; other tracks are out-of-scope noise.** Identify the developer from the git user, the prompt, or by asking.

| Dev | Handle | Track | Section |
|---|---|---|---|
| Dave | (primary maintainer) | Tier 2 hardening (CloudWatch, backup, audit logging, catalog audit) | "Sprint: Tier 2 hardening" |
| James | JamesLeberknight | Historical pipeline completion (data import / legacy migration) | "James's track" (routing only; detail in `legacy_data/IMPLEMENTATION_PLAN.md`) |

Cross-track changes require explicit human coordination.

### Sprint: Tier 2 hardening

Pre-cutover revert / rotation / scrub checklist lives in `docs/MIGRATION_PLAN.md` §28.8 (permanent gate; 7 items). Do not duplicate here.

**Staging wiring readiness probe:** long-term test `tests/smoke/staging-readiness.test.ts` (run via `npm run test:smoke`, gated behind `RUN_STAGING_SMOKE=1`, excluded from default `npm test`) asserts the permanent contract that staging runtime identity reaches AWS and KMS/SES calls succeed. Operator runs it from the Lightsail host or a workstation with the staging profile on every subsequent staging AWS wiring change (blocked on host-Node install below).

**In scope (review tasks first, then build):**

- **Catalog completeness audit** (M). `docs/VIEW_CATALOG.md` + `docs/SERVICE_CATALOG.md` invariant sweep: `PageViewModel<TContent>` contract, thin-controller discipline, db.ts purity, service-owned URL construction, adapter pattern, file-naming conventions (`<domain>Service.ts`, `<domain>Controller.ts`, `<PageName>Content`, `<Entity>ViewModel`), error-class naming (`<Kind>Error`), shared shaping helpers (`personHref`, `shapePartnershipPair`, `shapeFreestyleRecord`, `groupPlayerResults`), HTTP helpers (`issueSessionCookie`, `handleControllerError`), Handlebars helpers, service-boundary drift, cross-service coupling, undocumented services, cross-domain queries, cross-catalog consistency. Known specific mismatches to resolve during this sweep: (a) `authController.ts:12-44` defines 7 `*Content` interfaces inline instead of on the service; (b) `claimController` `res.render` calls omit `satisfies PageViewModel<TContent>`; (c) `personsController` and `legalController` use `logger.error + next(err)` instead of `handleControllerError`; (d) `homeController` + `hofController` have no try/catch/next; (e) SC §4.5 names `ConsecutiveService` but code is `recordsService`; (f) SC §3.2 assigns `searchMembers` to non-existent `MemberProfileLifecycleService` module (§3.4 assigns it to `MemberService`, which matches code); (g) SC §3.2 says `searchMembers` does prefix match but code (`db.ts:3171`) does substring `LIKE '%' || ? || '%'` (VC §6.2 agrees with code); (h) `historyService.ts:11` imports `surnameKey` from `identityAccessService` (move to a shared nameUtils); (i) `recordsService` queries both consecutive-kicks and freestyle passback records (cross-domain; SC says ConsecutiveService doesn't own freestyle); (j) `simulatedEmailService`, `personsService`, `personsQcChecks` not in SERVICE_CATALOG; (k) `authController.ts:108,121` renders `seo.title='Create Account'` while VC §6.16 says `'Register'`; (l) `COUNTRY_FLAGS` in `app.ts:37-79` and `COUNTRY_CODE` in `clubService.ts:9-64` split country-name canonicalization across modules; (m) QC-only deletion banner present on `netQcController.ts` and db.ts QC groups but missing from `personsService.ts`, `personsQcChecks.ts`, `personsController.ts`.
- **QC code separation audit** (M). Per MP §29 (hard go-live gate). Sweep public templates for pipeline-curation columns (confidence, notes, date_precision, source_reference) before retirement pass.
- **Approval-fatigue review v2** (S). Decide per class hook-regex vs `permissions.allow` prefix vs behavioral-only rule: `Bash(find:* -exec*)` + `-execdir*` mechanical backstop on top of the behavioral ban, read-only `for`/`while` loops, `xargs`, command substitution, subshells, pipelines, `if [[ -f x ]]` tests. Reference: repo-root `approval_fatigue.md`.
- **Post-auth-hardening carryovers (IP-scope only; MP §28.5/§28.6/§28.7 cover SES webhook, token cleanup, JWT rotation, session refresh, rate-limit cooldown, SES production access):** audit logging for register, changePassword, resetPassword, restoreAccount, and login rate-limit threshold crossings per SERVICE_CATALOG §3.1 (the `audit_entries` table exists in schema but has no writers today); redact token paths in the debug request logger (`src/app.ts:171-173` logs `req.url` at debug; `/verify/:token` and `/password/reset/:token` expose raw tokens when LOG_LEVEL=debug); add `email_verified_at IS NOT NULL` filter to `findMemberForSession` (`src/db/db.ts:3259-3268`) for defense-in-depth parity with `findMemberByEmail`; concurrent two-actor legacy-claim race test (testing.md mandate; `security.atomicity.test.ts` currently covers sequential only).
- **1-G CloudWatch agent** (S). Per MP §28.2. Unblocks richer `/health/ready` memory-pressure gating (DD §8.4).
- **Backup/restore workflow** (M). Per MP §28.1. Must land before prod data is at risk.
- **Docker log rotation** (S). `docker-compose.prod.yml` has no `logging:` block for `web`/`worker`/`nginx`; container stdout/stderr grow unbounded on the Lightsail host. Add `driver: json-file`, `max-size: "10m"`, `max-file: "3"` per service. Disk-fill risk, especially once worker poll tightens.
- **Preserve clubs-map anchor hooks** (XS). Retain `id="region-{regionSlug}"` on region sections and `data-club-id="{clubId}"` on club entries on `/clubs/:countrySlug`; intentional anchor-jump targets for the future interactive map.

**Post-sprint infra tidy-up (not blocking sprint closure):** install Node 22 on staging host via nodesource; extend `scripts/deploy-rebuild.sh` rsync includes to ship `tests/` so operator can run `npm run test:smoke` on-host.

**Verification:** `npm test` and `npm run build` per change.

### Open production-rewrite item (carried over)

**Legacy account claim:** current code is the early-test shortcut (direct lookup + confirm + merge via `identityAccessService.lookupLegacyAccount` / `claimLegacyAccount`; routes `POST /history/claim` + `POST /history/claim/confirm`). Production rewrite moves to a dedicated `LegacyMigrationService` with email-verified token flow (`GET /history/claim/verify/:token` per `docs/SERVICE_CATALOG.md`), name reconciliation, per-account / per-target / per-IP rate limiting (DD §3.8), and anti-enumeration messaging (SC §1.1 invariant: identical UX for found vs not-found; current `claimController.ts:111-116` returns distinct "No matching legacy record was found..." vs confirmation page, which must collapse to a single identical response). `claimLegacyAccount` also does not write the `member_tier_grants` rows specified in MIGRATION_PLAN §2 / §8 (`reason_code='migration.legacy_import'` and `'migration.legacy_claim_reconcile'`); deferred alongside the `legacy_tier_state` / `legacy_tier_expires_at` / `legacy_tier_ever_paid_tier2` schema extension gated on legacy-dump arrival. Migration-claim `audit_entries` for the 11 event types in MIGRATION_PLAN §17 (`legacy_claim_requested`, `legacy_claim_email_sent`, etc.) are also not written by the current shortcut; wiring lands with the email-verified flow. Deferred to Phase 4.

**Registration-time auto-link (MIGRATION_PLAN §6):** not yet implemented. Requires seeding the `name_variants` table (see `legacy_data/IMPLEMENTATION_PLAN.md`) and wiring the tier classifier into `verifyEmailByToken`. Deferred to Phase 4-F'.

**Club onboarding flow (MIGRATION_PLAN §9.3 Stages 1-3):** not implemented. Schema present (`member_club_affiliations`, `legacy_person_club_affiliations`, `legacy_club_candidates`, `club_bootstrap_leaders`) but no controller, service wiring, or tests. Target: Stage 1 direct-match confirmation, Stage 2 regional suggestions, Stage 3 no-clubs-nearby flow, each with writes to `member_club_affiliations` and bootstrap-leader activation for pre-populated clubs. Deferred to Phase 4.

**Routing invariants:** `/members` dashboard (auth) or welcome (public); `/members/:memberKey/*` profiles; `/history/:personId` historical detail; `/history` 301s to `/members`; `/register` registration; home Media Gallery is coming-soon (no `/media` route).

### Active sprint decisions (positive state)

- Auth is DB-backed via `identityAccessService.verifyMemberCredentials`. Session mechanism is JWT (RS256, KMS or local RSA-2048 signer per env) with per-request `password_version` check.
- **Intentional:** "Footbag Hacky" is a seeded preview-user account using a non-email login identifier. Permanent special login for preview/demo users. The literal login identifier may appear in seed scripts and test files (operational strings, comments, and print statements); the password is never committed and lives only in the `STUB_PASSWORD` env var. Canonical docs still refer to the preview-user account by role, not by identifier.
- `PageViewModel<TContent>` contract enforced across non-home public pages.

### Current gaps vs long-term user stories

- Profile edit is narrower than the full story (external URLs, broader contact/preferences not yet implemented)
- Profile viewing is narrower (own profile + HoF/BAP public exception only; no broad member-profile viewing)
- `/events` upcoming-events region remains omitted; reinstate (with empty-state per `docs/VIEW_CATALOG.md §6.8`) when the data contains actual upcoming events. All 810 current events are `completed`.
- These are accepted current-slice limitations; do not silently erase them from `docs/USER_STORIES.md`.

### Out of scope this sprint

S3 media pipeline, account deletion, data export, `M_Review_Legacy_Club_Data_During_Claim`, registration slug customization, public member directory, membership tiers/dues, legacy claim production rewrite (Phase 4-F'), club onboarding flow (MIGRATION_PLAN §9.3 Stages 1-3, Phase 4).

**Account-deletion implementation hook:** when PII purge lands (see M_Delete_Account in `docs/USER_STORIES.md` + DD §2.4 rule 5), the purge transaction must call `legacyClaim.clearClaim(legacy_member_id)` alongside setting `personal_data_purged_at`. Prepared statement already exists at `src/db/db.ts` `legacyClaim.clearClaim`.

### Removed (do not search)

- Display name editing in profile edit. Name and slug are permanent post-registration.

### Verification

Canonical commands: `npm test` and `npm run build`. Not yet covered by tests: 500 handler, honor-roll routes, browser/UI. Browser verification is explicit-human-request-only.

---

## James's track: Historical pipeline completion (parallel)

Tracked in `legacy_data/IMPLEMENTATION_PLAN.md`. Load only when working in that subtree. Platform-side blockers dependent on this track are listed under "Blocked / deferred" below.

---

## Accepted temporary deviations

Each has an explicit unblock condition. Long-term docs preserve target design; current-slice exceptions live here.

### Feature deviations

1. **Member profiles have conditional public visibility.** `/members/:memberKey` public for HoF/BAP; auth-required otherwise.
2. **Member search is authenticated only.** `/members` covers members + historical persons with dedup. No public directory.
3. **Avatar pipeline is local-only.** No server-side processing; raw uploads stored as-is (Busboy streaming, 5 MB limit); stable path + `?v={media_id}` cache-bust. `PhotoStorageAdapter` boot-time/parity/staging-smoke trio still to complete for S3 impl. Unblock: S3/media pipeline.
4. **Cache-Control at app layer, not CloudFront cache policy.** DD §6.7 target is the AWS managed `CachingDisabled` policy; current is Express middleware for authenticated responses. Functionally equivalent.
5. **`/legal` `admin@footbag.org` greyed as "mailbox not yet active".** `.contact-pending` span replaces `mailto:` across Privacy, Terms, Copyright contact lines. Unblock: IFPA domain acquisition + SES identity provisioning.
6. **Vimeo click-to-load facade not implemented.** Privacy section on `/legal` states Vimeo uses the click-to-load facade; only YouTube is covered today (`youtube-facade.js`). Unblock: media pipeline (Phase 3+).

### Infrastructure deviations

7. **No closed backup/restore workflow.** Unblock: Dave's Tier 2 sprint / MP §28.1.
8. **Maintenance mode not production-grade.** Unblock: 1-F / MP §28.3.
9. **CloudFront hardening incomplete.** Unblock: 1-F / MP §28.3.
10. **CI/CD partial.** App CI active; deploy scripts: `deploy-code.sh`, `deploy-rebuild.sh`, `deploy-migrate.sh` (stub). Remaining: 1-F, 1-G.
11. **Monitoring partial and gated.** Unblock: 1-G / MP §28.2.
12. **Terraform trust-policy stub for runtime role.** `terraform/staging/iam.tf:16-85` declares `aws_iam_role.app_runtime`'s trust policy as `ec2.amazonaws.com` (bootstrap stub from the unreachable-on-Lightsail instance-profile scaffold). Path H §8.9 step 4c Console-amended the trust policy to trust the source-profile IAM user; HCL reconciliation deferred. Source-profile + AssumeRole chain per DD §7.2 is otherwise active: long-lived keys at `/root/.aws/credentials` (root-owned, 0600), app uses `AWS_PROFILE=footbag-staging-runtime`. Unblock: post-sprint infrastructure tidy-up.
13. **Bootstrap security shortcuts remain.** Operator IAM + SSH use bootstrap posture. Unblock: pre-launch security pass.
14. **Browser validation manual-only.** Route/integration tests are first verification path.
15. **`image` container absent.** Docker Compose has `nginx`, `web`, `worker`. Unblock: Phase 3+ media pipeline.
16. **`/health/ready` is DB-probe only.** DD §8.4 adds memory-pressure gating + broader dependency checks. Unblock: 1-G / MP §28.1 + §28.2.
17. **`/internal` routes gated at member-level only.** All `/internal/*` routes (persons QC, net QC decision POSTs, candidate approve/reject) use `requireAuth` with no role check. Any registered member can approve/reject QC curation decisions that alter public Net data. Intentional dev/staging shortcut to unblock QC reviewers without a role system. Unblock: admin/operator role gate before go-live. Files: `src/routes/internalRoutes.ts`, `src/middleware/auth.ts`. When the gate lands, tests must pin auth-gate behavior on the 6 state-changing `/internal/*` POST routes; `internal.auth-gate.test.ts` currently covers `GET /internal/persons/qc` only.
18. **`terraform/staging/terraform.tfvars` missing `ses_sender_identity`.** Variable is declared in `terraform/staging/ses.tf` with no default, so `terraform plan|apply` from `terraform/staging/` fails today; SES identity was verified by hand via Console. Unblock: add `ses_sender_identity = "..."` to tfvars in the same task that reconciles the `OutboundEmail` IAM policy into HCL (MP §28.4 gate).
19. **SSM `app_db_path` value stale.** `terraform/staging/ssm.tf:33-37` hardcodes `/srv/footbag/footbag.db`; the runtime DB path (per `docs/DEV_ONBOARDING.md` Path H host bootstrap) is `/srv/footbag/db/footbag.db` and `deploy-rebuild.sh` migrates host env but not SSM. The app reads `FOOTBAG_DB_PATH` from `/srv/footbag/env` today, so this SSM value is unconsumed, but it will misfire when host-SSM reads are wired. Unblock: update the `ssm.tf` value to match the current mount path in the next Terraform pass.
20. **`SESSION_SECRET` validated at boot but never consumed.** `src/config/env.ts:120-131` requires `SESSION_SECRET` in prod (length ≥32, rejects `changeme`) but nothing in `src/` reads `config.sessionSecret`. JWT auth uses RSA/KMS signing, not HMAC; there is no express-session, cookie-session, or other HMAC consumer. Operators following rotation guidance rotate a no-op secret. Unblock: decide to either remove the env var + its validation (and any rotation runbook entries) or wire it to a genuine use (CSRF double-submit token, cookie signing, etc.).
21. **`TRUST_PROXY` implicit in production compose.** `docker/docker-compose.prod.yml` does not set `TRUST_PROXY`; `src/config/env.ts:108-118` defaults to 2 under `NODE_ENV=production`. Correct today but invisible to operators; a wrong value (too permissive) would bypass rate limiting. Unblock: set `TRUST_PROXY=2` explicitly in compose env after 1-F origin-bypass hardening closes (project memory note: re-evaluate integer hop count vs explicit subnet allow-list at that time).

---

## Blocked / deferred

- **Members ungating**: public historical-person detail pages blocked on James's data review sign-off. Current split: `/history*` historical surfaces, `/members/:memberKey/*` member-account area.
- **World records page**: route `/records` live with empty state; blocked on James's records CSV.
- **BAP honor-roll pages**: member-page indicators implemented; full honor-roll deferred.
- **Broader service contracts**: `docs/SERVICE_CATALOG.md` may remain broader than active slice; implementation status is governed here, not there.
- **Freestyle trick metadata tables**: 5 `freestyle_trick_*` tables scaffolded in `database/schema.sql`; no loader, no `db.ts` statements, no consumer. Phase 4+ (curated tricks browser).

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
