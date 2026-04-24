# Footbag Website Modernization Project -- Service Catalog
This catalog is the target-design reference for the platform's service layer: method signatures, return shapes, persistence touchpoints, and service-boundary ownership. It describes the permanent design, not the active implementation. `IMPLEMENTATION_PLAN.md` is authoritative for current scope, in-progress work, and accepted temporary shortcuts where the active implementation intentionally differs from a target contract here. When this catalog and `IMPLEMENTATION_PLAN.md` disagree, the plan wins for current-state questions; this catalog wins for target-design questions. Never silently reconcile them.

---

## Table of Contents

- [1. Shared Conventions](#1-shared-conventions)
- [2. Service Quick Reference](#2-service-quick-reference)
- [3. Identity & Account](#3-identity--account)
  - [3.1 `IdentityAccessService`](#31-identityaccessservice)
  - [3.2 `MemberProfileLifecycleService`](#32-memberprofilelifecycleservice)
  - [3.3 `HistoryService`](#33-historyservice)
  - [3.4 `MemberService`](#34-memberservice)
- [4. Clubs & Events](#4-clubs--events)
  - [4.0 `HomeService`](#40-homeservice)
  - [4.1 `ClubService`](#41-clubservice)
  - [4.2 `EventService`](#42-eventservice)
  - [4.3 `CompetitionParticipationService`](#43-competitionparticipationservice)
  - [4.4 `FreestyleService`](#44-freestyleservice)
  - [4.5 `ConsecutiveService`](#45-consecutiveservice)
  - [4.6 `NetService`](#46-netservice)
- [5. Payments & Membership](#5-payments--membership)
  - [5.1 `PaymentService`](#51-paymentservice)
  - [5.2 `MembershipTieringService`](#52-membershiptieringservice)
- [6. Voting & Recognition](#6-voting--recognition)
  - [6.1 `VotingElectionService`](#61-votingelectionservice)
  - [6.2 `HallOfFameService`](#62-halloffameservice)
- [7. Content & Discovery](#7-content--discovery)
  - [7.1 `MediaGalleryService`](#71-mediagalleryservice)
  - [7.2 `HashtagDiscoveryService`](#72-hashtagdiscoveryservice)
  - [7.3 `NewsService`](#73-newsservice)
- [8. Communication](#8-communication)
  - [8.1 `CommunicationService`](#81-communicationservice)
- [9. Governance & Operations](#9-governance--operations)
  - [9.1 `AdminGovernanceService`](#91-admingovernanceservice)
  - [9.2 `OperationsPlatformService`](#92-operationsplatformservice)
- [10. Legacy Migration](#10-legacy-migration)
  - [10.1 `LegacyMigrationService`](#101-legacymigrationservice)

---

## 1. Shared Conventions

This catalog defines the long-lived service-ownership and service-contract standard.

This document is authoritative for the service contracts it includes.

It is intentionally partial. A capability may still be part of the broader product because it is defined elsewhere in the project docs even when it is not yet cataloged here.

There is no target-design `publicController` layer. Public controllers/routes stay thin and delegate to services.

**Rule notation:** `[DB]` = enforced by schema/trigger · `[APP]` = application-enforced · `[DB+APP]` = both layers

**Delete semantics:** `HD` = hard-delete (row gone) · `SD` = soft-delete (`deleted_at` set) · `SA` = status-archive (`status='archived'`; clubs only — no `deleted_at` column)

**Timestamp requirement:** All writers must use `strftime('%Y-%m-%dT%H:%M:%fZ','now')` — not `datetime('now')`, which produces a space-separated format that breaks lexical ordering in views, triggers, and timestamp string comparisons/sorts.

**Transaction / idempotency:** Coupled local writes (e.g., dual-write pairs) must be in a single atomic transaction. Webhook and job handlers must be idempotent. Domain services own idempotency behavior even when DB unique indexes assist. Outbox enqueue uses stable idempotency keys.

**Naming conventions:**
- Service files: `<domain>Service.ts` (e.g. `identityAccessService.ts`, `freestyleService.ts`).
- Controller files: `<domain>Controller.ts` (see `docs/VIEW_CATALOG.md` §4.2 for page-shape naming).
- Prepared-statement groups: object exports in `src/db/db.ts` named after the domain or feature (`auth`, `registration`, `publicEvents`, `netTeams`, `freestyleRecords`, etc.); QC-only groups carry the `// ---- QC-only (delete with pipeline-qc subsystem) ----` banner.
- Service errors: `<Kind>Error` extending `ServiceError` in `src/services/serviceErrors.ts`. Canonical classes: `ValidationError`, `NotFoundError`, `ServiceUnavailableError`, `ConflictError`, `RateLimitedError` (carries `retryAfterSeconds`). HTTP mapping lives in `docs/VIEW_CATALOG.md` §7.2.

**Adapter pattern:** Adapters are the only seam between app code and external services. Interface: `<Purpose>Adapter`; implementations: `<Backend><Purpose>Adapter`. Current adapters:
- `JwtSigningAdapter` — `LocalJwtSigningAdapter` (dev, HS256 with local secret) / `KmsJwtSigningAdapter` (staging/prod, AWS KMS).
- `SesAdapter` — `StubSesAdapter` (dev, in-process capture) / `LiveSesAdapter` (staging/prod, real SES).
- `PhotoStorageAdapter` — local-fs (dev) / S3 (staging/prod).

Adapters must fail-fast at boot when required env vars are absent. Integration tests stand up an injected fake client against the adapter interface; tests must never mock the AWS SDK package itself. See `tests/CLAUDE.md` §"Dev↔staging adapter parity" for the required three-test pattern (boot-time, interface parity, staging smoke).

**Rate-limit placement:** rate-limit enforcement (`rateLimitHit` + `throw new RateLimitedError(...)`) lives in services. Controllers catch `RateLimitedError` and map it to HTTP 429 with `Retry-After` set from `retryAfterSeconds`. Never implement rate limits in middleware or inline in controllers. All rate-limit bucket sizes and windows are read from `system_config_current` keys (e.g. `login_rate_limit_max_attempts`, `password_reset_rate_limit_window_minutes`).

**Anti-enumeration invariant:** Any endpoint that could leak account existence (login, register, password-reset request, email-verify/resend, member lookup, legacy claim) must return identical UX and identical timing for "exists" vs "does not exist." Services enforce this by running the same code path in both cases (e.g., always hitting the hash-compare, always running the rate-limit bucket); controllers must not short-circuit around an earlier existence check. Implemented by `IdentityAccessService` for account endpoints and by `MemberProfileLifecycleService.searchMembers` for member lookup.

**Read model conventions:**
- `member_tier_current` — **authoritative tier projection**; no tier cache columns exist on `members`. Use `calculateTierStatus(memberId)` as the sole authoritative tier-read path; never derive tier from `members` directly.
- `system_config_current` — computed view returning the latest effective row per `config_key` where `effective_start_at <= now`. Authoritative read surface for all runtime config lookups; never query the `system_config` table directly for operational use.
- `members_searchable` — member search **must** use this view; applies five exclusion conditions: soft-deleted, deceased, opted-out, PII-purged, and unverified (`email_verified_at IS NULL`). The last condition is the primary mechanism preventing imported legacy placeholder rows from appearing in search results.
- `members_active` — filters `deleted_at IS NULL`; use for general member lookups.
- `clubs_open` / `clubs_all` — `clubs_open` filters `status IN ('active','inactive')`; `clubs_all` includes archived (SA, no `deleted_at`).
- `email_templates_enabled` — filters `is_enabled = 1`; use for active template lookups.
- `recurring_donation_subscriptions_active` — use for non-canceled subscription queries; query the bare table directly when canceled rows are needed.
- `news_items` and `events` are the canonical read surfaces for these hard-delete domains; no `*_all` aliases are defined.

**Side-effect categories** (document which apply per method): audit append · outbox enqueue · news emission · work queue insert · alarm raise/ack

**Work queue invariant:** Every `work_queue_items` INSERT **must** trigger an admin-alert mailing list notification (slug `admin-alerts`; task type + entity ID only; no sensitive data). `[APP]` side effect on all inserting services.

**Event hard-delete rule:** Draft and canceled events are HD immediately; events with published results are preserved permanently and must never be deleted. `[APP]` guard required on every delete path before execution.

**`password_version` vs `password_hash_version`:** `password_version` is the **session/JWT invalidation counter** — increment on every password reset or change; all JWTs with an older value are immediately invalid. `password_hash_version` tracks hash algorithm version only. These must never be conflated.

**Ballot non-anonymity by design:** `ballots.voter_member_id` is stored in plaintext alongside the encrypted ballot. The participation fact (who voted) is intentionally non-anonymous. Ballot **content** is confidential via AES-256-GCM encryption.

**System config writes:** Config values are changed by inserting a new row into `system_config` with the new `value_json`, `effective_start_at`, and `changed_by_member_id`. Existing rows are immutable (UPDATE/DELETE blocked by DB triggers). `system_config_current` automatically reflects the latest effective value per key. Never UPDATE or DELETE rows in `system_config`.

---

## 2. Service Quick Reference

Use this section to identify the correct service before reading its full entry. Each entry states what the service owns, what it explicitly does not own (the most common source of misplacement), and its primary tables.

Source-of-truth note: This document defines service ownership, method contracts, business-rule boundaries, cross-service dependencies, and service-level error semantics. It does not own bookmarkable page-route contracts or page-layout contracts. Those belong to `docs/VIEW_CATALOG.md`.

Routing note: This project is page-oriented, not REST-API-oriented. Public route handlers should stay thin and delegate route interpretation and page shaping to services.

---

### Identity & Account

**`IdentityAccessService`**
- **Owns:** Current-slice account entry/auth flows: registration, credential verification, login/logout, and current session-cookie issuance/clearing
- **Does NOT own:** Member profile CRUD, historical-person reads, tier calculation, data exports
- **Primary tables:** `members`, `account_tokens`
- Future detail (retain explicitly): auth hardening to the long-term JWT/session design remains governed by `docs/DESIGN_DECISIONS.md` and `IMPLEMENTATION_PLAN.md`

**`MemberProfileLifecycleService`**
- **Owns:** Member profile CRUD, account soft-delete and PII purge workflow, deceased handling, GDPR data export, member search
- **Does NOT own:** Tier grants, payments
- **Primary tables:** `members`, `member_links`, `media_items`, `member_galleries`, `account_tokens`

**`HistoryService`**
- **Owns:** Current-slice historical-person index/detail reads, historical-results page shaping, and the distinction between historical imported people and current member accounts
- **Does NOT own:** Current member account lifecycle, profile CRUD, member search, or account-claim flow
- **Primary tables:** `historical_persons`, `event_result_entry_participants`, supporting event/result reads

**`MemberService`**
- **Owns:** Member-account page shaping and own-account profile operations: own profile read, limited public HoF/BAP profile read, profile edit page shaping (includes inline avatar upload), and supported account stub pages
- **Does NOT own:** Login/registration credential verification, broader member search, account-claim flow, or tier ledger calculation
- **Primary tables:** `members`, profile/media-related reads and writes

---

### Clubs & Events

**`HomeService`**
- **Owns:** Home page composition for `GET /`
- **Does NOT own:** generic event browsing or club-directory domain logic
- **Primary tables:** none directly; composes public read models from service-owned reads

**`ClubService`**
- **Owns:** Club lifecycle (create through archive), leader and co-leader management, club roster management, operability enforcement
- **Does NOT own:** Media, payments
- **Primary tables:** `clubs`, `club_leaders`

**`EventService`**
- **Owns:** Event lifecycle (create through completion/cancellation), discipline management, co-organizer management, sanction requests, results upload
- **Does NOT own:** Registration payments (PaymentService), competition participation records (CompetitionParticipationService)
- **Primary tables:** `events`, `event_disciplines`, `event_organizers`, `event_results_uploads`, `event_result_entries`

**`CompetitionParticipationService`**
- **Owns:** Event registration, discipline selections, participant list management, roster-access vouch grants (Pathway A)
- **Does NOT own:** Event creation, payment processing, official IFPA roster reporting/export (AdminGovernanceService)
- **Primary tables:** `registrations`, `registration_discipline_selections`, `roster_access_grants`, `tier1_vouch_requests`

**`FreestyleService`**
- **Owns:** All public freestyle section page reads: landing, records, leaders, about, moves, and trick detail pages
- **Does NOT own:** Event lifecycle, canonical result ingestion, or net/consecutive domain reads
- **Primary tables:** `freestyle_records` (read-only)

**`ConsecutiveService`**
- **Owns:** Public consecutive kicks records page read
- **Does NOT own:** Event lifecycle, freestyle, or net domain reads
- **Primary tables:** `consecutive_kicks_records` (read-only)

**`NetService`**
- **Owns:** Public net doubles team list and team detail page reads; discipline label resolution (conflict-flag-aware); evidence disclaimer rendering; statistics firewall enforcement (`canonical_only` data only)
- **Does NOT own:** Canonical result ingestion, freestyle, or consecutive domain reads
- **Primary tables:** `net_team`, `net_team_member`, `net_team_appearance_canonical` (view), `net_discipline_group` (read-only)

---

### Payments & Membership

**`PaymentService`**
- **Owns:** All Stripe interactions — one-time payments, recurring donation subscriptions, webhook processing, reconciliation
- **Does NOT own:** Tier grant logic (MembershipTieringService), registration confirmation (CompetitionParticipationService)
- **Primary tables:** `payments`, `payment_status_transitions`, `recurring_donation_subscriptions`, `recurring_donation_subscription_transitions`, `stripe_events`, `reconciliation_issues`

**`MembershipTieringService`**
- **Owns:** All tier grant writes, tier expiry processing, HoF/BAP/board flag management, admin role grants; `calculateTierStatus` is the sole authoritative tier-read path
- **Does NOT own:** Payment processing, registration
- **Primary tables:** `member_tier_grants`, `member_tier_current`, `members` (flag and role fields only; no tier cache columns)

---

### Voting & Recognition

**`VotingElectionService`**
- **Owns:** Vote lifecycle, ballot submission and encryption, eligibility snapshots, tally and publish, HoF nomination and affidavit flows
- **Does NOT own:** Admin role management, HoF inductee display (HallOfFameService)
- **Primary tables:** `votes`, `vote_options`, `vote_eligibility_snapshot`, `ballots`, `vote_results`, `hof_nominations`, `hof_affidavits`

**`HallOfFameService`**
- **Owns:** HoF landing page read for `GET /hof`; in-site HoF inductee display and historical record reads
- **Does NOT own:** HoF tier promotion or `is_hof` flag writes (MembershipTieringService), nomination/affidavit/election lifecycle (VotingElectionService)
- **Primary tables:** none (read-only rollup view of HoF-flagged rows owned by other services)

---

### Content & Discovery

**`MediaGalleryService`**
- **Owns:** Photo upload and processing, video link submission, gallery management, media tagging, media flag and moderation workflows
- **Does NOT own:** Tag stats recomputation (HashtagDiscoveryService), S3 lifecycle management (OperationsPlatformService)
- **Primary tables:** `media_items`, `member_galleries`, `media_tags`, `media_flags`

**`HashtagDiscoveryService`**
- **Owns:** Tag creation and validation, tag browse and search, tag stats cache, teaching moments data
- **Does NOT own:** Media tagging operations (MediaGalleryService)
- **Primary tables:** `tags`, `tag_stats`, `media_tags` (read for stats rebuild)

**`NewsService`**
- **Owns:** News item creation (auto-generated and admin-authored), moderation, public feed
- **Does NOT own:** Generating its own news — calling services invoke NewsService methods as a side effect of their own domain actions
- **Primary tables:** `news_items`

**`LegalService`**
- **Owns:** Static legal content shaping for the public `/legal` page (Privacy, Terms of Use, Copyright & Trademarks)
- **Does NOT own:** Policy decisions themselves — those are authored and approved out-of-band and captured as static content; no data persistence
- **Primary tables:** none (static content)

---

### Communication

**`CommunicationService`**
- **Owns:** Outbox polling and sending via SES, mailing list management, subscription management, email archival, SES bounce/complaint handling, email template management
- **Does NOT own:** Triggering sends directly — all other services enqueue to outbox; this service owns the worker
- **Primary tables:** `outbox_emails`, `mailing_lists`, `mailing_list_subscriptions`, `email_archives`, `email_templates`

---

### Governance & Operations

**`AdminGovernanceService`**
- **Owns:** Admin dashboard, work queue management, audit log viewing, system health, alarm management, official IFPA roster report/export, reconciliation digest data assembly, system config writes
- **Does NOT own:** Business logic of domain services it coordinates; runtime config reads (application code reads `system_config_current` directly — not through this service)
- **Primary tables:** `work_queue_items`, `audit_entries`, `system_config`, `system_alarm_events`, `reconciliation_issues`

**`OperationsPlatformService`**
- **Owns:** All background job orchestration, system job run logging, alarm raise/ack, backup jobs, static asset cleanup
- **Does NOT own:** Domain business logic — delegates all of it to domain services; row-level PII purge logic (MemberProfileLifecycleService)
- **Primary tables:** `system_job_runs`, `system_alarm_events`

---

## 3. Identity & Account

---

### 3.1 `IdentityAccessService`

**Purpose/Boundary:** Owns current-slice account entry/auth flows: registration, credential verification, password change/reset, email verification, legacy account claim. Does NOT own member profile CRUD, historical-person reads, tier calculation, data exports, or session-cookie issuance (session-cookie issuance and clearing are controller-level HTTP glue per DD §1.9; the service returns a signed JWT string and the controller sets/clears the cookie).

Future detail (retain explicitly): auth hardening to the long-term JWT/session design remains governed by `docs/DESIGN_DECISIONS.md` and `IMPLEMENTATION_PLAN.md`.

**JWT session model (current summary):**
- JWT is signed via `JwtSigningAdapter` (HS256 in dev, KMS in staging/prod).
- Payload embeds `memberId` and `passwordVersion`; middleware verifies `passwordVersion` against `members.password_version` on every authenticated request. Bumping `password_version` (on password change or reset) invalidates all outstanding sessions immediately.
- Session cookies are `HttpOnly`, `Secure` (production), `SameSite=Lax`. Controllers set/clear via `issueSessionCookie` / `clearSessionCookie` in `src/lib/sessionCookie.ts`; never write `Set-Cookie` directly.
- The archive passthrough (`generateLegacyArchiveAccess`) does not re-check `password_version` at the archive edge — archive JWTs expire naturally at `jwt_expiry_hours`; this is an accepted operational trade-off documented in DD and IP.

**Consumers:** Web controllers (auth flows), middleware (JWT validation), OperationsPlatformService (token cleanup)

**Key Methods:**
- `register(input) -> {memberId, verificationTokenSent}` — creates `members` row at Tier 0; enqueues verification email via CommunicationService; audit-logs
- `verifyEmail(token) -> {ok}` — validates SHA-256 token hash, marks `used_at`, activates account
- `verifyMemberCredentials(email, password) -> Member | null` — validates credentials against argon2 hash; enforces deceased/grace-period rules; throws `RateLimitedError` when the per-email/per-IP bucket is exceeded (enforced in-service; controller maps to HTTP 429 with `Retry-After`); returns the member row on success or null. Session issuance is the caller's responsibility (controller mints the JWT via `createSessionJwt` and sets the cookie through `issueSessionCookie`).
- `changePassword(input) -> {ok}` — increments `password_version` (invalidates all existing JWTs); updates `password_hash`; increments `password_hash_version` only on algorithm change; audit-logs
- `requestPasswordReset(email) -> {ok}` — rate-limited (5 requests/email/hour regardless of email existence); enqueues reset email with SHA-256-hashed token; consistent timing prevents enumeration
- `resetPassword(token, newPassword) -> {ok}` — validates token (1-hour expiry, unused); increments `password_version`; marks token consumed; audit-logs
- `generateLegacyArchiveAccess(jwt) -> {passthroughJwt}` — issues JWT passthrough for archive.footbag.org; **note:** archive edge does not perform `password_version` check — archive access expires naturally at `jwt_expiry_hours`; this is an accepted operational trade-off, not a bug
- `restoreAccount(memberId) -> {ok}` — clears `deleted_at` within grace period; audit-logs

**Authz:** Registration is open. All other methods require either a valid JWT or a valid one-time token. Login enforces rate limiting and lockout (`login_rate_limit_max_attempts`, `login_cooldown_minutes`).

**Persistence Touchpoints:** `members`, `members_active`, `account_tokens`, `audit_entries`, `outbox_emails`

**Key Rules:**
- `[DB]` `login_email` UNIQUE (un-purged members only — partial index)
- `[APP]` JWT payload must embed `password_version`; middleware must verify it matches current `members.password_version` on every authenticated request
- `[APP]` Token storage: SHA-256 hash only, never plaintext
- `[APP]` Email verification token TTL: `email_verify_expiry_hours` (default 24h); password reset TTL: `password_reset_expiry_hours` (default 1h); both read from `system_config_current`
- `[APP]` Grace-period accounts (SD, not purged): login detects `deleted_at IS NOT NULL` within `member_cleanup_grace_days` → restoration screen, not normal login
- `[APP]` Deceased members (`is_deceased = 1`) cannot log in regardless of credentials or account status

**Transaction + Idempotency:** `changePassword` and `resetPassword` must update `password_version` and `password_hash` atomically.

**Async / Side Effects:** outbox enqueue (verification email, reset email) · audit append

---

### 3.2 `MemberProfileLifecycleService`

**Purpose/Boundary:** Owns member profile CRUD, account soft-delete and PII purge workflow, deceased handling, GDPR data export, and member search. Does NOT own tier grants or payments.

> **Purge boundary:** This service owns the row-level PII clearing logic (`purgeAccountPII`). `OperationsPlatformService` owns orchestration — it determines which members qualify and calls this service after the applicable grace period. See §9.2.

**Consumers:** Member controllers, AdminGovernanceService, OperationsPlatformService (purge job)

**Key Methods:**
- `getProfile(memberId, viewerContext) -> {profile}` — applies visibility rules: email shown only to owner, or when `email_visibility = 'members'` (to logged-in members); `email_visibility = 'public'` is not a forward-looking supported value — contact fields must never be publicly exposed; tier badges to logged-in members only; honor badges (HoF, BAP, board) to all
- `editProfile(memberId, input) -> {ok}` — validates/sanitizes URLs (https, max 3 via `member_links`), bio; audit-logs changed fields
- `searchMembers(query) -> {results}` — **authenticated members only (Tier 0+); never public**; queries `members_searchable` view exclusively; min 2-char query; prefix match on display name; capped result count for broad queries with "refine your query" signal; no browse-all/exhaustive pagination; anti-enumeration by design
- `deleteAccount(memberId) -> {ok}` — SD: sets `deleted_at`; synchronously deletes all S3 photos and `media_items` / `member_galleries` rows (HD); if S3 deletion fails, entire operation fails — account must NOT be marked deleted until S3 photos are confirmed removed; if member is sole club leader AND `club.contact_email IS NULL`: also inserts 'Needs Contact' work-queue item → admin-alerts notification; audit-logs
- `requestDataExport(memberId) -> {downloadLinkToken}` — creates `account_tokens` row of type `data_export`; enqueues email with time-limited link (expires `data_export_link_expiry_hours`, default 72h)
- `generateDataExport(token) -> {jsonFile}` — validates `data_export` token; assembles profile, tier status, payment history, event registrations, media metadata, vote participation (no ballot content or receipt tokens); audit-logs
- `markDeceased(adminId, memberId, reason) -> {ok}` — sets `is_deceased = 1`, `deceased_at`; disables login; removes from `members_searchable`; removes from club roster (sets `is_current = 0` on `member_club_affiliations` row); unregisters from future events; if member is sole club leader or event organizer, inserts work-queue item ("Needs Leader" / "Needs Organizer") → triggers admin-alerts notification; if member is sole club leader AND `club.contact_email IS NULL`: also inserts 'Needs Contact' work-queue item → admin-alerts notification; PII cleanup is deferred to `OperationsPlatformService.runPIIPurgeJob()` deceased-member branch after `deceased_cleanup_grace_days` (default 30d); deceased and soft-deleted lifecycles are distinct; HoF/BAP honors and media attribution preserved; audit-logs
- `revertDeceasedFlag(adminId, memberId, reason) -> {ok}` — available within `deceased_cleanup_grace_days` only; clears `is_deceased`; audit-logs
- `purgeAccountPII(memberId) -> {ok}` — called only by `OperationsPlatformService.runPIIPurgeJob()` after the applicable grace period (soft-delete branch or deceased-member branch); sets `personal_data_purged_at`; clears `login_email`, `login_email_normalized`, `password_hash`, `password_changed_at`, `phone`, `whatsapp`, `legacy_email`, `legacy_user_id`, `street_address`, `postal_code`, `birth_date`; overwrites `real_name`, `display_name`, `display_name_normalized`, `city`, `country` with anonymized placeholders as needed (APP-022); retains row for referential integrity; HoF/BAP members: retain display name and honor badges

**Authz:** `editProfile`, `deleteAccount`, `requestDataExport` — owner only. `searchMembers` — authenticated Tier 0+ only; never callable from public routes. `markDeceased`, `revertDeceasedFlag` — admin only.

**Persistence Touchpoints:** `members`, `members_active`, `members_all`, `members_searchable`, `member_links`, `media_items`, `member_galleries`, `account_tokens`, `audit_entries`, `outbox_emails`, `work_queue_items`

**Key Rules:**
- `[APP]` Member search MUST use `members_searchable` view — do not add WHERE clauses on top of `members_active` or the bare `members` table
- `[APP]` Account deletion: S3 photo deletion must succeed before `deleted_at` is set (transactional consistency)
- `[APP]` Gallery HD is part of the same atomic operation as photo HD on account deletion (galleries are leaf nodes)
- `[APP]` PII purge must produce complete anonymized stub in one transaction (APP-022)
- `[APP]` `purgeAccountPII` is not callable by any service other than `OperationsPlatformService` — it is not a general-purpose purge method
- `[APP]` `is_deceased` removal only within `deceased_cleanup_grace_days`; after that only full account deletion is available
- `[APP]` Deceased and soft-deleted members are distinct cleanup paths: `deceased_cleanup_grace_days` applies only after `markDeceased`; `member_cleanup_grace_days` applies only after `deleteAccount`
- `[DB]` Partial UNIQUE index: one avatar per member; email unique for un-purged members
- `[APP]` Max 3 external URLs per member (APP-008)

**Transaction + Idempotency:** `deleteAccount` — S3 deletion + HD of media rows + SD of member row must be coordinated; failure at any step must not leave partial state. S3 deletion must succeed before `deleted_at` is set. `purgeAccountPII` — all NULL/overwrite writes in one transaction.

**Async / Side Effects:** outbox enqueue (export link email, deceased notification) · audit append · work queue insert (sole-leader/organizer on deceased) → admin-alerts notification

---

### 3.3 `HistoryService`

**Purpose/Boundary:** Owns the historical-person read models for the `/history` surfaces documented in `docs/VIEW_CATALOG.md`. This includes the historical-person detail page, the historical-results grouping used on those pages, and the service-layer distinction between imported historical people and current member accounts. It does NOT own current member-account lifecycle, profile CRUD, login/registration, member search, or account-claim flow.

**Consumers:** History controller, event-result participant linking flows

**Key Methods:**
- `getHistoricalPlayerPage(personId) -> { page, seo, navigation: { contextLinks }, content: { personId, displayName, honorificNickname?, eventGroups } }` — resolves one imported historical person into the detail page model; unknown/non-public IDs resolve as not-found; `eventGroups` carries typed event result history with service-computed `eventHref`; `navigation.contextLinks` carries the typed back link to `/members`

**Key Rules:**
- historical imported people vs current member accounts: see DD §2.4
- historical pages must not imply current-member ownership or contactability
- public honor visibility for HoF/BAP historical persons is bounded and explicit
- route handlers stay thin; page shaping belongs here

---

### 3.4 `MemberService`

**Purpose/Boundary:** Owns the member-account read/write page shaping for the `/members/*` surfaces documented in `docs/VIEW_CATALOG.md`. This includes the members landing page with member search, own-profile read, limited public HoF/BAP member profile read, profile edit page shaping (includes inline avatar upload), and supported account stub pages. It does NOT own login/registration credential verification, legacy claim flow, or tier ledger calculation.

**Consumers:** Member controller

**Key Methods:**
- `getMembersLandingPage(slug, displayName, query?) -> PageViewModel<MembersLandingContent>` — member dashboard page model with optional search; content includes `profileSlug`, `displayName`, and `search`
- `searchMembers(query) -> MemberSearchResult` — prefix-match search on `members_searchable` view; returns shaped results with honor badges; 20-result cap with `hasMore` flag
- `getOwnProfile(slug) -> PageViewModel<OwnProfileContent>` — own-profile page model
- `getPublicProfile(slug) -> PageViewModel<PublicProfileContent> | null` — limited public HoF/BAP profile; returns null for non-HoF/BAP members
- `getProfileEditPage(slug, error?) -> PageViewModel<ProfileEditContent>` — edit form page model
- `updateOwnProfile(slug, input) -> void` — validates and persists profile field changes (bio, location, contact prefs, competition history)

**Avatar upload** (implemented via `createAvatarService` factory in `avatarService.ts`):
- `uploadAvatar(memberId, fileBuffer) -> { thumbUrl }` — validates image type (JPEG/PNG only), enforces 5 MB size limit, processes to thumb and display sizes, atomically replaces any existing avatar (delete old media item, insert new, link to member)
- own-profile only; Busboy streaming in controller, business logic in service

**Key Rules:**
- own-profile routes are owner-only
- public non-owner profile viewing is limited to the explicit HoF/BAP exception
- no contact-field leakage on public profile views
- route handlers stay thin; page shaping belongs here

---

## 4. Clubs & Events (and sport-result read services)

---

### 4.0 `HomeService`

**Purpose/Boundary:** Owns the service-shaped landing-page composition read for `GET /`. Home is the one intentional composition-page exception in the current public architecture. This service owns the Home page contract, including hero composition, editorial/media modules, primary section links, and any featured event teasers shown on Home. It may compose read models from other public read services. It does not own generic Events browsing, club-domain lifecycle logic, layout chrome, or controller concerns.

**Consumers:** Public home controller

**Key Methods:**
- `getPublicHomePage(nowIso) -> { seo, page, hero, primaryLinks, featuredUpcomingEvents?, featurePanels?, comingSoonSections? }`

**Key Rules:**
- Home remains within the thin-controller / service-owned-shaping architecture.
- Home may be richer than ordinary list/detail pages, but the page-composition contract belongs here, not in templates.
- Do not introduce or preserve a `publicController` abstraction as target design.
- Do not introduce a separate Home-specific front-end stack.

---

### 4.1 `ClubService`

**Purpose/Boundary:** Owns club lifecycle (create, edit, activate/deactivate, archive), leader/co-leader management, roster management, and club operability enforcement. Does NOT own media or payments.

**Consumers:** Member controllers, AdminGovernanceService, MemberProfileLifecycleService (deceased handling)

**Key Methods:**
- `createClub(leaderId, input) -> {clubId}` — validates Tier 1+; rejects if member already holds `role='leader'` for any active club `[APP]`; generates unique `#club_{location_slug}` hashtag via HashtagDiscoveryService; creates `clubs` row and `club_leaders` row; audit-logs; emits `club_created` news item via NewsService
- `editClub(actorId, clubId, input) -> {ok}` — co-leaders may edit all fields; if contact email blanked → upserts "Club Needs Contact" work-queue item → admin-alerts notification; audit-logs changed fields with old/new values
- `setClubStatus(actorId, clubId, status) -> {ok}` — leader/co-leader: `active ↔ inactive`; admin: can archive (see `archiveClub`); audit-logs
- `archiveClub(actorId, clubId, reason) -> {ok}` — leader: requires zero active members; admin: no member prerequisite; sets `status = 'archived'` (SA — no `deleted_at`); sets `is_current = 0` on all affected `member_club_affiliations` rows; enqueues email to all affected members via CommunicationService; audit-logs; `clubs_open` excludes archived; `clubs_all` includes
- `addCoLeader(actorId, clubId, targetMemberId) -> {ok}` — max 5 total leaders (APP-010); enqueues email to new co-leader; audit-logs
- `removeCoLeader(actorId, clubId, targetMemberId) -> {ok}` — anti-self-removal: rejects if actor is sole leader; audit-logs
- `joinClub(memberId, clubId) -> {ok}` — removes from previous club if any (auto-leave, noted in email); enqueues notification to member + all leaders; audit-logs
- `leaveClub(memberId, clubId) -> {ok}` — sets `is_current = 0` on the member's `member_club_affiliations` row; re-evaluates operability; enqueues notification to member + leaders; audit-logs
- `reassignLeader(adminId, clubId, newLeaderId, reason) -> {ok}` — admin only; resolves "Needs Leader" work-queue item; audit-logs

**Authz:** Create club: Tier 1+. Edit/manage: club leader or co-leader. Archive (admin path): admin. Reassign leader: admin only.

**Persistence Touchpoints:** `clubs`, `clubs_open`, `clubs_all`, `club_leaders`, `members`, `tags`, `news_items`, `audit_entries`, `outbox_emails`, `work_queue_items`

**Key Rules:**
- `[DB]` SA only — no `deleted_at` on `clubs`; use `clubs_all` for archived-club queries
- `[DB]` `ux_one_leader_per_club` — one `role='leader'` per club
- `[DB]` `ux_one_club_leader_per_member` — member can be leader of at most one club
- `[APP]` Max 5 leaders per club (APP-010)
- `[APP]` Anti-self-removal: sole leader cannot remove themselves
- `[APP]` Club with zero leaders → "Needs Leader" work-queue item → admin-alerts
- `[APP]` Club with no contact email → "Needs Contact" work-queue item → admin-alerts
- `[APP]` Standard hashtag reserved via `HashtagDiscoveryService.reserveStandardTag()` at creation; permanent and must not be HD (APP-024)
- `[APP]` Club display names not required to be globally unique; hashtag is the canonical identifier
- `[APP]` News items emitted via `NewsService.emitNewsItem()` — ClubService does not write to `news_items` directly

**Async / Side Effects:** outbox enqueue (join/leave/co-leader/archive emails) · news emission (`club_created`, `club_archived`) · audit append · work queue insert (operability flags) → admin-alerts notification

---

### 4.2 `EventService`

**Purpose/Boundary:** Owns event lifecycle (create through completion/cancellation), discipline management, co-organizer management, sanction requests, results upload, and the service-layer read use cases that power the public event browse/detail pages. 

**Consumers:** Public event page controllers, member and organizer controllers, AdminGovernanceService, CompetitionParticipationService

#### Public-route boundary rules

For the current public routes, `EventService` is responsible for:
- validating `year` as a four-digit archive-year input;
- validating `eventKey` against `event_{year}_{event_slug}`;
- validating the exact underscore-based public key pattern `event_{year}_{event_slug}` and mapping that exact key to stored standard-tag form `#event_{year}_{event_slug}` before DB lookup; no hyphen/underscore rewrite, aliasing, or fuzzy-match behavior is authorized;
- treating invalid keys, unknown public keys, and non-public event lookups as not-found at the public-route boundary;
- translating SQLite busy/locked read failures into temporary-unavailable service failures for controller-level safe failure handling.

**Key Methods:**
- `createEvent(organizerId, input) -> {eventId}` — Tier 1+; free events → `published` immediately; sanctioned/paid events → `pending_approval`; generates standard hashtag `#event_{year}_{slug}` via HashtagDiscoveryService; if paid/sanctioned: inserts work-queue item + enqueues admin notification; emits `event_published` news item via NewsService on publish; audit-logs
- `editEvent(actorId, eventId, input) -> {ok}` — organizer or co-organizer; all fields editable except free/sanctioned status; audit-logs old/new values
- `deleteEvent(actorId, eventId, reason) -> {ok}` — HD; `[APP]` guard: draft and canceled → HD immediately; events with public result rows → **must never be deleted**; cannot delete if confirmed registrations exist; notifies all participants; audit-logs
- `closeRegistration(actorId, eventId) -> {ok}` — organizer; transition `published/registration_full → closed`; audit-logs
- `cancelEvent(actorId, eventId, reason) -> {ok}` — organizer or admin; terminal state; notifies all registrants; audit-logs
- `completeEvent(actorId, eventId) -> {ok}` — transition `closed → completed`; terminal state
- `addCoOrganizer(actorId, eventId, targetMemberId) -> {ok}` — max 5 total (APP-011); enqueues email to new organizer; audit-logs
- `removeCoOrganizer(actorId, eventId, targetMemberId) -> {ok}` — anti-self-removal; audit-logs
- `requestSanction(actorId, eventId, justification) -> {ok}` — Tier 2 active required; inserts work-queue item → admin-alerts notification; enqueues confirmation to organizer; audit-logs
- `approveSanctionRequest(adminId, eventId, decision, reason) -> {ok}` — admin only; approve: event → `published`, payment enabled, enqueues organizer email, emits `event_published` news item via NewsService, audit-logs; reject: event stays `draft`, outbox notification to organizer; admin cannot approve if organizer lacks active Tier 2
- `uploadResults(actorId, eventId, csvData) -> {attendanceConfirmationData}` — organizer; parses CSV; writes `event_results_uploads` + `event_result_entries` + `event_result_entry_participants`; calls `CompetitionParticipationService.grantRosterAccess()` to reset window to `vouch_window_days` from now; for sanctioned events: auto-marks result-appearing members as attended via `MembershipTieringService.applyAttendanceTier()`; emits `event_results` news item via NewsService; audit-logs
- `confirmAttendance(actorId, eventId, memberIds[]) -> {ok}` — sanctioned events; bulk or individual; delegates tier logic to `MembershipTieringService.applyAttendanceTier()`; audit-logs
- `correctResults(adminId, eventId, corrections, reason) -> {ok}` — admin only; mandatory reason; audit-logs before/after values
- `reassignOrganizer(adminId, eventId, newOrganizerId, reason) -> {ok}` — admin only; resolves "Needs Organizer" work-queue item; audit-logs

- `getPublicEventsLandingPage(nowIso) -> { page, seo, content: { featuredPromo?, upcomingEvents, archiveYears } }` — page-oriented read method for `GET /events`; `featuredPromo` field shape is owned by `docs/VIEW_CATALOG.md` §6.8; may internally reuse lower-level list methods
- `getPublicEventsYearPage(year) -> { page, seo, navigation: { siblings }, content: { year, events } }` — page-oriented read method for `GET /events/year/:year`; validates year input; returns the full non-paginated year-page view model; year page shows event summaries only — results are on the canonical event detail page; `navigation.siblings` carries typed previous/next year links when adjacent archive years exist
- `getPublicEventPage(eventKey) -> { page, seo, navigation: { contextLinks }, content: { event, disciplines, hasResults, primarySection, resultSections } }` — page-oriented read method for `GET /events/:eventKey`; validates and normalizes the public key, enforces public-visible status rules, and returns a grouped page model for the canonical event page; `navigation.contextLinks` carries the typed "more events from {year}" link
- Lower-level helper reads such as `listPublicUpcomingEvents`, `listPublicArchiveYears`, `listPublicCompletedEventsByYear`, `getPublicEventDetail`, and result-row readers may exist internally, but controllers consume the page-oriented read methods

**Historical imported people read boundary:**
- `event_result_entry_participants.display_name` is the always-renderable participant label.
- `historical_person_id` supports read-only historical detail linking when present and when a historical detail target is actually exposed.
- For entity-level distinction between historical imported people and current Members, see DD §2.4.

**Authz:** Create: Tier 1+. Edit/manage: event organizer or co-organizer scope. Sanction approval, result correction, reassign: admin only.

**Persistence Touchpoints:** `events`, `event_disciplines`, `event_organizers`, `roster_access_grants`, `event_results_uploads`, `event_result_entries`, `event_result_entry_participants`, `tags`, `news_items`, `audit_entries`, `outbox_emails`, `work_queue_items`

**Key Rules:**
- `[APP]` Hard-delete guard: events with public result rows are preserved permanently; draft/canceled → HD immediately
- `[APP]` Cannot delete event with confirmed registrations
- `[APP]` Status transitions: `draft → pending_approval → published → registration_full | closed → completed | canceled`; `completed` and `canceled` are terminal
- `[APP]` Sanction approval requires organizer active Tier 2 at approval time
- `[APP]` Anti-self-removal for sole organizer
- `[APP]` Max 5 organizers per event (APP-011)
- `[DB]` `ux_one_organizer_per_event` — one `role='organizer'` per event
- `[APP]` Standard hashtag reserved via `HashtagDiscoveryService.reserveStandardTag()` at creation; permanent (APP-024)
- `[APP]` Roster access window reset via `CompetitionParticipationService.grantRosterAccess()` on every results upload; window length from `vouch_window_days` (read from `system_config_current`)
- `[APP]` News items emitted via `NewsService.emitNewsItem()` — EventService does not write to `news_items` directly

- `[APP]` Public event detail visibility is limited to statuses `published`, `registration_full`, `closed`, and `completed`
- `[APP]` Events with status `draft`, `pending_approval`, or `canceled` do not have public detail visibility
- `[APP]` Public archive year is derived from `events.start_date`
- `[APP]` Public `eventKey` parsing and validation belongs in `EventService`; normalize `event_{year}_{event_slug}` to stored standard-tag form `#event_{year}_{event_slug}` before calling `db.ts`
- `[APP]` Public event browse/detail reads use prepared statements exported by `db.ts` directly; no repository layer and no ORM
- `[APP]` `db.ts` may return flat ordered result rows; grouping and page/view shaping belong above `db.ts`
- `[APP]` `hostClub` is route-facing display data sourced from `events.host_club_id -> clubs.name` when present and must not be inferred from `event_organizers`
- `[APP]` when shaping public result rows, set `participantHref` via `personHref(participant_member_slug, participant_historical_person_id)` per DD §2.4 rule 2 (dispatches to `/members/{slug}` for claimed members, `/history/{personId}` otherwise, null if neither). Templates render a plain name when `participantHref` is null; no URL construction in templates.
- `[APP]` Public year archives include the full completed public event list for the selected year and are not paginated
- `[APP]` A year-page event has `hasResults = true` only when the event is publicly visible and at least one result row exists for that event; this flag may be used for visual treatment on the year page (e.g. a results indicator) but results are not rendered inline on the year page
- `[APP]` If a historical event has no result rows yet, the canonical event page renders the event and includes an explicit no-results state; the year page shows the event summary regardless of result availability
- `[APP]` The canonical public event page is one route and one template; render emphasis is expressed through page-model fields such as `primarySection`, not through alternate public URLs

**Transaction + Idempotency:** Results upload is idempotent per upload; re-upload resets roster access window.

**Async / Side Effects:** outbox enqueue (organizer confirmations, participant cancellation notices, sanction decisions, roster-access grants) · news emission (`event_published`, `event_results`) · audit append · work queue insert (sanction request, no-organizer guard) → admin-alerts notification

---

### 4.3 `CompetitionParticipationService`

**Purpose/Boundary:** Owns event registration, discipline selections, participant list management, and roster-access vouch grants used by Pathway A vouching. Does NOT own event creation, payment processing, or official IFPA roster reporting/export — that belongs to `AdminGovernanceService`.

**Consumers:** Member controllers, EventService (roster access grants, attendance confirmation), AdminGovernanceService

**Key Methods:**
- `registerForEvent(memberId, eventId, input) -> {registrationId}` — validates capacity; free events: writes `confirmed` immediately; paid events: writes `pending` and delegates to PaymentService; enforces discipline-selection completeness for competitors (APP-013); enqueues confirmation email; if capacity reached: updates event status to `registration_full`; audit-logs
- `confirmRegistration(registrationId) -> {ok}` — called by PaymentService webhook handler post-payment-success; atomically with `payments.status = 'succeeded'` write; validates discipline completeness for competitors (APP-013)
- `getParticipants(actorId, eventId) -> {participants}` — organizer: full list with tier, registration type, categories, partner, payment status; member: limited view
- `exportParticipants(actorId, eventId) -> {csv}` — organizer; confirmed participants only; CSV with name, email (opt-in), city, country, date, tier, payment status, type, categories, partner
- `emailParticipants(actorId, eventId, subject, body) -> {ok}` — organizer; rate-limited (1 email/event/day); enqueues via CommunicationService outbox; archives in `email_archives`; audit-logs recipient count
- `grantRosterAccess(actorId, eventId) -> {grantId}` — called by EventService after results upload for sanctioned events; writes `roster_access_grants` row; expiry = `vouch_window_days` from now
- `vouchMemberDirect(actorId, eventId, targetMemberId) -> {ok}` — Pathway A; validates active roster grant; delegates tier logic to `MembershipTieringService.applyVouchGrant()`; audit-logs
- `submitVouchRequest(requesterId, targetMemberId, reason, notes) -> {requestId}` — Pathway B; writes `tier1_vouch_requests`; inserts work-queue item → admin-alerts notification; self-vouch rejected `[DB+APP]`
- `processVouchRequest(adminId, requestId, decision, reason) -> {ok}` — admin; approve: delegates to `MembershipTieringService.applyVouchGrant()`; deny: enqueues denial email to requester (not target); audit-logs

**Authz:** Register: Tier 0+. View participants: organizer scope. Vouch direct (Pathway A): Tier 2+ with active roster grant. Submit vouch request (Pathway B): Tier 2+. `processVouchRequest`: admin only.

**Persistence Touchpoints:** `registrations`, `registration_discipline_selections`, `roster_access_grants`, `tier1_vouch_requests`, `events`, `member_tier_current`, `members`, `email_archives`, `audit_entries`, `outbox_emails`, `work_queue_items`

**Key Rules:**
- `[APP]` Official IFPA roster reporting/export is owned by `AdminGovernanceService` — this service does not expose roster report or export methods
- `[APP]` Competitor registration requires ≥1 discipline selection before `status = 'confirmed'` (APP-013)
- `[APP]` Pathway A: `related_event_id` non-null, `related_vouch_request_id` null in tier grant ledger row
- `[APP]` Pathway B: `related_vouch_request_id` non-null, `related_event_id` null in tier grant ledger row
- `[APP]` Self-vouch rejected at application layer; `[DB]` CHECK as defense-in-depth
- `[DB]` `ux_tier_grants_vouch_once` — one ledger row per vouch request
- `[DB]` `ux_tier_grants_event_once` — one grant per (member, event)
- `[APP]` Capacity enforcement: event status → `registration_full` when reached
- `[APP]` Participant email: rate-limited 1/event/day

**Async / Side Effects:** outbox enqueue (registration confirmation, reminder, vouch notifications, participant emails) · audit append · work queue insert (vouch request Pathway B) → admin-alerts notification

---

### 4.4 `FreestyleService`

**Purpose/Boundary:** Owns all public freestyle section page reads for `GET /freestyle*`. Shapes page view-models for the landing page, world records (grouped by record type), leaders list, about page, moves reference, and individual trick detail pages. All reads are against pre-loaded canonical data. Does not own event lifecycle, result ingestion, or any other sport domain.

**Consumers:** Public freestyle controller

**Key Methods:**
- `getLandingPage() -> PageViewModel` — freestyle section entry
- `getRecordsPage() -> PageViewModel` — world records grouped by record type
- `getLeadersPage() -> PageViewModel` — leaders list
- `getTrickDetailPage(slug) -> PageViewModel` — single trick detail; throws `NotFoundError` for unknown slugs
- `getAboutPage() -> PageViewModel` — about freestyle
- `getMovesPage() -> PageViewModel` — moves reference

**Persistence Touchpoints:** `freestyle_records` (read-only)

**Key Rules:**
- `[APP]` All reads are read-only against canonical tables; no writes
- `[APP]` `NotFoundError` on unknown trick slug → controller renders 404

---

### 4.5 `ConsecutiveService`

**Purpose/Boundary:** Owns the public consecutive kicks records page read for `GET /consecutive`. Shapes the single-page view-model from canonical consecutive records data. Does not own event lifecycle or any other sport domain.

**Consumers:** Public consecutive controller

**Key Methods:**
- `getRecordsPage() -> ConsecutiveRecordsViewModel` — full records page, grouped by division

**Persistence Touchpoints:** `consecutive_kicks_records` (read-only)

**Key Rules:**
- `[APP]` All reads are read-only against canonical tables; no writes

---

### 4.6 `NetService`

**Purpose/Boundary:** Owns public Footbag Net page reads including the `GET /net` portal landing (hero, narrative, Singles/Doubles competition-format cards, notable teams, notable players, recent events) and the `GET /net/teams` / `GET /net/teams/:teamId` team list and detail pages. Enforces the statistics firewall: only `evidence_class = 'canonical_only'` data is exposed. Handles conflict-flag-aware discipline label resolution: when `conflict_flag = 1` on a `net_discipline_group` row, the raw canonical discipline name is used instead of the canonical group label. Team-data pages always render the disclaimer: "Team identities are algorithmically constructed from placement data and may not reflect official partnerships." (not conditioned on a flag). Does not expose win/loss records, head-to-head stats, or rankings.

**Consumers:** Public net controller

**Key Methods:**
- `getNetHomePage() -> NetHomePageViewModel` — portal landing; shapes hero/mascot, intro narrative, competition formats, Explore-card data-driven grey-out, notable teams and notable players buckets, recent events
- `getTeamsPage() -> NetTeamsPageViewModel` — team list ordered by appearance count descending
- `getTeamDetailPage(teamId) -> NetTeamDetailViewModel` — team detail with appearances grouped by year, descending; throws `NotFoundError` for unknown team IDs

**Persistence Touchpoints:** `net_team`, `net_team_member`, `net_team_appearance_canonical` (view — enforces `canonical_only` at DB layer), `net_discipline_group`, `historical_persons` (read for display names and country)

**Key Rules:**
- `[APP]` Statistics firewall: all appearance reads use `net_team_appearance_canonical` view; `inferred_partial` data is never exposed in public routes
- `[APP]` `conflict_flag = 1` → render raw `discipline_name`, never the `canonical_group` label
- `[APP]` Disclaimer "Team identities are algorithmically constructed from placement data and may not reflect official partnerships." is always rendered unconditionally on both pages
- `[APP]` No win/loss, head-to-head, or ranking data of any kind
- `[APP]` `NotFoundError` on unknown team ID → controller renders 404

---

## 5. Payments & Membership

---

### 5.1 `PaymentService`

**Purpose/Boundary:** Owns all Stripe interactions: one-time payments (dues, registration fees, one-time donations), recurring donation subscriptions, webhook processing, reconciliation. Does NOT own tier grant logic (MembershipTieringService) or registration confirmation (CompetitionParticipationService).

**Consumers:** MembershipTieringService, CompetitionParticipationService, AdminGovernanceService, webhook controller

**Key Methods:**
- `createCheckoutSession(memberId, paymentType, amount, metadata) -> {stripeSessionUrl}` — creates Stripe Checkout Session; writes `payments` with `status = 'pending'`; returns redirect URL
- `createRecurringDonationSubscription(memberId, amount, currency, comment) -> {subscriptionId}` — creates/reuses Stripe Customer (canonical `stripe_customer_id` on `members`); creates Stripe Subscription; writes `recurring_donation_subscriptions` with `status = 'active'`; stores comment in Stripe metadata and local record; dual-write `recurring_donation_subscription_transitions` with `lifecycle_event_code = 'activated'`; audit-logs
- `cancelRecurringDonation(memberId, subscriptionId) -> {ok}` — member-initiated; sets Stripe Subscription `is_cancel_at_period_end = true`; writes `lifecycle_event_code = 'cancel_requested'` transition; enqueues confirmation email; does not update local `status` until `customer.subscription.deleted` webhook received; audit-logs
- `handleStripeWebhook(stripePayload, signature) -> {ok}` — called by `OperationsPlatformService.runPaymentWebhookProcessor()`; validates signature; deduplicates via `stripe_events` keyed on `event_id`; idempotent — duplicate events return 200 without reprocessing
- `processPaymentIntentSucceeded(eventData) -> {ok}` — dual-write: `payments.status = 'succeeded'` + `payment_status_transitions` INSERT atomically; calls `MembershipTieringService.applyPurchaseGrant()` or `CompetitionParticipationService.confirmRegistration()` as appropriate; enqueues receipt email
- `processPaymentIntentFailed(eventData) -> {ok}` — dual-write: `payments.status = 'failed'` + transition; enqueues failure email
- `processChargeRefunded(eventData) -> {ok}` — dual-write: `payments.status = 'refunded'` + transition; no automatic tier changes — admin handles via `AdminGovernanceService`
- `processSubscriptionInvoiceSucceeded(eventData) -> {ok}` — creates new `payments` row linked via `stripe_subscription_id`; dual-write subscription transition `charge_succeeded`; enqueues receipt email; audit-logs
- `processSubscriptionInvoiceFailed(eventData) -> {ok}` — updates subscription `status = 'past_due'`; dual-write transition `charge_failed`; enqueues failure email; Stripe owns retry schedule
- `processSubscriptionDeleted(eventData) -> {ok}` — subscription `status = 'canceled'`; dual-write transition `canceled`; enqueues notification email + admin alert; audit-logs
- `processSubscriptionUpdated(eventData) -> {ok}` — syncs local subscription record; dual-write transition `updated`; audit-logs
- `getPaymentHistory(memberId) -> {payments}` — member's own history; includes type, date, amount, currency, status, reference, donation comment (read-only)
- `getAllPayments(adminId, filters) -> {payments}` — admin only; filterable by type/date/status/member/event/reference; includes donation comment as read-only field
- `runReconciliation(adminId) -> {report}` — called nightly by `OperationsPlatformService.runNightlyReconciliation()` and also admin-triggerable; two-pass: one-time vs subscriptions; flags mismatches; writes `reconciliation_issues`; `expires_at` set per APP-018
- `resolveReconciliationIssue(adminId, issueId, note) -> {ok}` — admin; sets `status = 'resolved'`; records resolver + timestamp; audit-logs

**Authz:** `getPaymentHistory`: owner. `createCheckoutSession`, `cancelRecurringDonation`: Tier 0+. All admin views and reconciliation: admin only. Webhook: system role (via OperationsPlatformService).

**Persistence Touchpoints:** `payments`, `payment_status_transitions`, `recurring_donation_subscriptions`, `recurring_donation_subscriptions_active`, `recurring_donation_subscription_transitions`, `stripe_events`, `reconciliation_issues`, `members`, `audit_entries`, `outbox_emails`

**Key Rules:**
- `[APP]` Stripe success gating: tier grants and confirmed registrations written only after `status = 'succeeded'` (APP-006)
- `[APP+DB]` Every `payments.status` change → paired `payment_status_transitions` INSERT in same transaction (APP-003)
- `[DB]` Payment status state machine trigger: `pending → succeeded | failed | canceled; succeeded → refunded` — no backward transitions
- `[APP]` Every subscription status change → paired `recurring_donation_subscription_transitions` INSERT in same transaction (APP-005)
- `[APP]` All webhook processing idempotent via `stripe_events.event_id` deduplication
- `[APP]` `stripe_customer_id` on `members` = canonical member-level customer ID; `payments.stripe_customer_id` = per-payment snapshot — these are distinct fields, not redundant
- `[APP]` Amount discrepancy check must compare both `amount` AND `currency` fields (APP-018)
- `[APP]` Reconciliation issues: `expires_at = created_at + reconciliation_expiry_days` at INSERT (APP-018)
- `[APP]` HoF/BAP donation comment defaults: HoF → "HoF Fund"; BAP → "BAP Fund"; both → "HoF Fund"
- `[APP]` `is_cancel_at_period_end` reflects Stripe's subscription flag; set to `1` on cancel_requested, confirmed via `customer.subscription.deleted` webhook

**Transaction + Idempotency:** All webhook handlers idempotent. Dual-write pairs in single atomic transactions.

**Async / Side Effects:** outbox enqueue (receipts, failure notices, cancellation emails) · audit append · (nightly reconciliation digest via CommunicationService, orchestrated by OperationsPlatformService)

---

### 5.2 `MembershipTieringService`

**Purpose/Boundary:** Owns all tier grant writes to `member_tier_grants`, tier expiry processing, HoF/BAP/board flag management, and admin role grants. `calculateTierStatus(memberId)` is the sole authoritative tier-read path; it derives from the ledger via `member_tier_current` — no tier cache columns exist on `members`. Does NOT own payment processing or registration.

**Consumers:** PaymentService, CompetitionParticipationService, EventService, AdminGovernanceService, OperationsPlatformService (expiry job)

**Key Methods:**
- `applyTierGrant(actor, memberId, grantParams) -> {ok}` — writes ledger row; `member_tier_current` is the authoritative read source; call `calculateTierStatus(memberId)` for current tier after any grant write
- `applyAttendanceTier(actorId, memberId, eventId, eventDate) -> {ok}` — called by EventService on attendance mark; Tier 0 → `tier1_annual` expiry = eventDate + 365d; existing Tier 1 Annual < eventDate + 365d → extend; existing ≥ eventDate + 365d → no-op; Tier 1 Lifetime+ → no-op; `reason_code = 'attendance.event'`, `related_event_id` set; `[DB]` `ux_tier_grants_event_once` prevents duplicate; audit-logs
- `applyVouchGrant(actorId, memberId, pathway, sourceRef) -> {ok}` — called by CompetitionParticipationService; same no-op/extend logic as attendance; Pathway A: `related_event_id`, `reason_code = 'vouch.direct'`; Pathway B: `related_vouch_request_id`, `reason_code = 'vouch.admin'`; enqueues email to vouched member
- `applyPurchaseGrant(memberId, paymentId, tierProduct) -> {ok}` — called by PaymentService on payment success; `reason_code = 'purchase.dues'`; `related_payment_id` set; Tier 2 purchase permanently sets `fallback_tier_status = 'tier1_lifetime'` on the ledger row; Tier 2 Annual expiry = max(today, current expiry) + 365d; audit-logs
- `processExpiry(memberId) -> {ok}` — called only by `OperationsPlatformService.runTierExpiryCheck()`; Tier 1 Annual expired → `expire` row, `new_tier_status = 'tier0'`, `reason_code = 'system.tier_expired'`; Tier 2 Annual expired → `expire` row, `new_tier_status = 'tier1_lifetime'`, `reason_code = 'system.tier2_fallback'`; enqueues notification
- `adminOverrideTier(adminId, memberId, newTier, expiryDate, reason) -> {ok}` — `reason_code = 'admin.override'`, `change_type = 'grant'`; cannot reduce dues-paying member below Tier 1 Lifetime (`member_tier_current` purchase overlay would ignore it anyway, but reject early with a clear error); audit-logs; enqueues member notification
- `grantHoFBAPStatus(adminId, memberId, badge, reason) -> {ok}` — sets `is_hof` or `is_bap`; unless already Tier 3: writes tier grant to Tier 2 Lifetime (`reason_code = 'admin.hof_bap_grant'`), updates `fallback_tier_status`; emits `member_honor` news item via NewsService; enqueues congratulatory email; audit-logs
- `setBoardFlag(adminId, memberId, action, reason) -> {ok}` — `flag_set`: snapshot current paid tier in `new_fallback_tier_status` of the `board.flag_set` ledger row → write grant to Tier 3; `flag_removed`: **read `new_fallback_tier_status` from most recent `board.flag_set` ledger row** → write `board.flag_removed` grant reverting to that captured tier; emits `member_honor` news item via NewsService; audit-logs
- `calculateTierStatus(memberId) -> {tierData}` — sole authoritative tier-read path; derives from `member_tier_current` (ledger-backed); never reads tier fields directly from `members`.
- `adminManageRole(adminId, targetMemberId, action, reason) -> {ok}` — grant: target must be `tier2_lifetime` or `tier3` (APP-015); anti-lockout: last admin cannot be revoked (APP-015); updates `is_admin`; atomically updates admin-alerts mailing list subscription via CommunicationService (APP-015); audit-logs; enqueues email

**Authz:** `applyAttendanceTier`, `applyVouchGrant` (Pathway A): Tier 2+ with active roster grant. `applyVouchGrant` (Pathway B approval), `adminOverrideTier`, `grantHoFBAPStatus`, `setBoardFlag`, `adminManageRole`: admin only. `calculateTierStatus`: any authenticated.

**Persistence Touchpoints:** `member_tier_grants`, `member_tier_current`, `members`, `system_config_current`, `mailing_list_subscriptions`, `news_items`, `audit_entries`, `outbox_emails`

**Key Rules:**
- `[DB]` Append-only: `member_tier_grants` UPDATE/DELETE blocked by triggers
- `[APP]` `calculateTierStatus(memberId)` is the sole authoritative tier-read path; derives from `member_tier_current` via the ledger; no tier cache columns exist on `members`
- `[APP]` Source linkage discipline: at most one of `related_payment_id`, `related_vouch_request_id`, `related_event_id` non-NULL; `revoke`/`expire` rows have all source FKs NULL (APP-016)
- `[DB]` `ux_tier_grants_event_once` — one grant per (member, event)
- `[APP]` Board flag revert: reads `new_fallback_tier_status` from most recent `board.flag_set` ledger row in `member_tier_grants` — not from current `members` cache (which may have been updated by subsequent grants)
- `[APP]` HoF/BAP grant auto-promotes to Tier 2 Lifetime unless member is Tier 3 (board); fallback tier also updated
- `[APP]` Admin role prerequisites (APP-015): Tier 2 Lifetime or Tier 3 required; anti-lockout enforced
- `[APP]` Admin-alerts mailing list subscription updated atomically with `is_admin` change (APP-015)
- `[APP]` Membership pricing is read from `system_config_current` using integer-cents keys (`tier1_lifetime_price_cents`, `tier2_annual_price_cents`, `tier2_lifetime_price_cents`); convert cents to display currency in UI layer
- `[APP]` News items emitted via `NewsService.emitNewsItem()` — MembershipTieringService does not write to `news_items` directly

**Transaction + Idempotency:** Every ledger write in one transaction. `applyAttendanceTier` and `applyVouchGrant` are idempotent via DB unique indexes as safety net; app is primary controller.

**Async / Side Effects:** outbox enqueue (tier change notifications, vouching emails, congratulatory HoF/BAP) · news emission (`member_honor`) · audit append

---

## 6. Voting & Recognition

---

### 6.1 `VotingElectionService`

**Purpose/Boundary:** Owns vote lifecycle, ballot submission and encryption, eligibility snapshots, tally/publish, HoF nomination and affidavit flows. Does NOT own admin role management or HoF inductee display (HallOfFameService).

**Consumers:** Admin controllers, member controllers, OperationsPlatformService (open/close jobs)

**Key Methods:**
- `createVote(adminId, input) -> {voteId}` — validates date ordering `vote_open_at < vote_close_at`; `nomination_close_at <= vote_open_at` if nomination phase used `[DB]`; `[APP]` validates `options_visible_at <= vote_open_at` (APP-014); audit-logs
- `openVote(actorId, voteId) -> {ok}` — called by admin or `OperationsPlatformService.openPendingVotes()`; writes eligibility snapshot rows to `vote_eligibility_snapshot` (write-once; UPDATE/DELETE blocked by DB triggers); if a single snapshot timestamp is needed, derive it consistently from `vote_eligibility_snapshot.created_at` values for that vote; notifies eligible members; audit-logs
- `submitBallot(memberId, voteId, selections) -> {receiptToken}` — validates eligibility from snapshot (not live tier); checks member has not already voted; generates cryptographically random receipt token; encrypts ballot (AES-256-GCM, per-ballot KMS data key); writes `ballots` with `voter_member_id`, `encrypted_ballot_b64`, `ballot_nonce_b64`, `ballot_auth_tag_b64`, `encrypted_data_key_b64`, `kms_key_id`, `receipt_token_hash = SHA-256(token)`; **`voter_member_id` stored in plaintext by design** — participation fact is intentionally non-anonymous; enqueues receipt email containing plaintext token (scrubbed from outbox after delivery per APP-019)
- `closeVote(actorId, voteId) -> {ok}` — called by admin or `OperationsPlatformService.closePendingVotes()`; `open → closed`; audit-logs
- `tallyAndPublish(adminId, voteId, summary) -> {ok}` — requires explicit `can_tally_votes` permission (APP-023); valid only when `status = 'closed'` AND `now > vote_close_at` (both conditions enforced); decrypts ballots via KMS during tally; aggregates totals in memory; discards individual ballot contents immediately after counting; writes `vote_results` + `vote_result_option_totals`; `[APP]` if `result_json` also populated, application must keep both representations consistent; status → `published`; emits `vote_results` news item via NewsService; audit-logs TALLY_VOTE_START and TALLY_VOTE_COMPLETE (totals only, never individual ballot contents); after HoF election publish: clears `HoF_Nominated` flag (sets `hof_last_nominated_year` logic) from all candidates of that cycle
- `cancelVote(adminId, voteId, reason) -> {ok}` — valid in `draft`, `open`, `closed`; `published` cannot be canceled; enqueues cancellation notifications to eligible non-voters; ballots retained encrypted for audit; audit-logs
- `verifyReceipt(voteId, rawToken) -> {matched}` — computes `SHA-256(rawToken)` and checks against `ballots.receipt_token_hash`; returns generic not-found on any mismatch (does not distinguish wrong-token from never-issued)
- `nominateHoFCandidate(nominatorId, nomineeId, input) -> {nominationId}` — any member; creates `hof_nominations` row with snapshot fields; inserts work-queue item for admin approval → admin-alerts notification
- `approveHoFNomination(adminId, nominationId) -> {ok}` — sets `HoF_Nominated` derived state (updates `hof_last_nominated_year`); sends email to nominee and `director@footbaghalloffame.net`; audit-logs
- `submitHoFAffidavit(nomineeId, nominationId, affidavitText) -> {ok}` — within nomination window; writes `hof_affidavits` (one-per-nomination UNIQUE); makes candidate ballot-eligible
- `getVoteOptions(memberId, voteId) -> {options}` — eligibility-gated; options visible from `options_visible_at` if set; after publish: visible to all eligible members regardless of whether they voted

**Authz:** `createVote`, `cancelVote`, `closeVote`, `approveHoFNomination`: admin. `tallyAndPublish`: admin with `can_tally_votes` equivalent (APP-023). `submitBallot`, `verifyReceipt`, `getVoteOptions`: eligibility-gated per vote config. `nominateHoFCandidate`: any authenticated member. `submitHoFAffidavit`: nominated + approved member within window.

**Persistence Touchpoints:** `votes`, `vote_options`, `vote_eligibility_snapshot`, `ballots`, `vote_results`, `vote_result_option_totals`, `hof_nominations`, `hof_affidavits`, `members`, `news_items`, `audit_entries`, `outbox_emails`, `work_queue_items`

**Key Rules:**
- `[DB]` Ballot append-only: UPDATE/DELETE blocked
- `[DB]` Eligibility snapshot write-once: UPDATE/DELETE blocked
- `[APP]` Any single snapshot timestamp exposed by the service must be derived from `vote_eligibility_snapshot.created_at` values for that vote using one consistent derivation rule
- `[DB]` Vote options locked once vote is `open` or later (triggers)
- `[DB]` Date ordering: `vote_open_at < vote_close_at`; nomination ordering enforced
- `[APP]` `options_visible_at <= vote_open_at` (APP-014)
- `[APP]` Tally requires `can_tally_votes` permission, not just `is_admin` (APP-023)
- `[APP]` Tally allowed only when `status = 'closed'` AND `now > vote_close_at`
- `[APP]` `result_json` and `vote_result_option_totals` dual-representation: application owns consistency if both populated
- `[APP]` Receipt token: plaintext never persisted; `SHA-256(token)` stored; outbox `body_text` scrubbed after delivery (APP-019)
- `[APP]` Ballot non-anonymity by design: `voter_member_id` stored in plaintext
- `[APP]` News items emitted via `NewsService.emitNewsItem()` — VotingElectionService does not write to `news_items` directly

**Transaction + Idempotency:** `openVote` must write eligibility snapshot atomically. `submitBallot` must be idempotent (reject duplicate if ballot already exists for this member+vote).

**Async / Side Effects:** outbox enqueue (vote-open notifications, receipt email, cancellation notifications) · news emission (`vote_results`) · audit append · work queue insert (HoF nomination approval) → admin-alerts notification

---

### 6.2 `HallOfFameService`

**Purpose/Boundary:** Owns the current-slice HoF landing page read for `GET /hof` — service-shaped, no DB queries required. Does NOT own HoF tier promotion or `is_hof` flag writes (MembershipTieringService), or nomination/affidavit/election lifecycle (VotingElectionService). Future in-site HoF inductee display pages, roster reads, and historical-record surfaces are deferred out of scope.

**Consumers:** Public HoF controller

**Key Methods:**
- `getHofLandingPage() -> { seo, page, content }` — shapes the current-slice editorial landing page model; no DB reads

**Authz:** public (no login required)

**Persistence Touchpoints:** none

**Key Rules:**
- `[APP]` This service is read-only and does not issue DB queries
- `[APP]` Templates must not construct the standalone HoF URL; service provides the `content.externalLink` object

**Async / Side Effects:** none

---

## 7. Content & Discovery

---

### 7.1 `MediaGalleryService`

**Purpose/Boundary:** Owns photo upload and processing, video link submission, gallery management, media tagging, and media flag/moderation workflows. Does NOT own tag stats recomputation (HashtagDiscoveryService) or S3 lifecycle management (OperationsPlatformService).

**Consumers:** Member controllers, AdminGovernanceService

**Key Methods:**
- `uploadPhoto(memberId, file, galleryId, caption, tags) -> {mediaItem}` — Tier 1+; re-encodes as JPEG 85%; strips EXIF/ICC; generates 300×300 thumbnail and 800px display variant; discards original; stores to S3; writes `media_items`; rate-limited (`photo_upload_rate_limit_per_hour`); synchronous — member sees photo immediately; audit-logs
- `submitVideo(memberId, url, galleryId, caption, tags) -> {mediaItem}` — Tier 1+; validates YouTube/Vimeo URL; extracts video ID; fetches thumbnail; writes `media_items`; max 5 video embeds per gallery (APP-009); rate-limited (`video_submission_rate_limit_per_hour`)
- `editMediaTags(memberId, mediaId, tags) -> {ok}` — owner; validates tag format via `HashtagDiscoveryService.validateAndResolveTag()`; writes `media_tags` delta; cascades tag association changes to gallery linking
- `deleteMedia(memberId, mediaId) -> {ok}` — HD immediately (owner); cascades: `media_flags` + `media_tags` cascade-delete `[DB]`; S3 deletion; if `is_avatar`, detaches from `members` (`ON DELETE SET NULL [DB]`); no soft-delete
- `deleteGallery(memberId, galleryId) -> {ok}` — HD gallery; cascades all media in gallery (HD) + `gallery_external_links` `[DB]`; S3 deletions for all photos; no soft-delete; single confirmation action per US
- `flagMedia(reporterId, mediaId, reason) -> {ok}` — Tier 1+; rate-limited (10 flags/member/hour); UNIQUE per reporter+media (no duplicate flags `[DB]`); item remains visible; inserts work-queue item → admin-alerts notification
- `adminDeleteMedia(adminId, mediaId, reason) -> {ok}` — HD; logs decision with reason; enqueues email to uploader; audit-logs
- `getGallery(galleryId, viewerContext) -> {items}` — public; uploader identity (email) visible to members only
- `getTagGallery(tagNormalized) -> {items}` — public; all media items with matching tag
- `getEventGallery(eventId) -> {items}` — public; scans `media_tags` for event standard hashtag match; result may be cached (gallery auto-linking with ~minutes latency)
- `getClubGallery(clubId) -> {items}` — public; same scan pattern as event gallery

**Authz:** Upload/submit: Tier 1+. Edit tags/delete own: owner. Flag: Tier 1+. Admin delete: admin. Gallery viewing: public.

**Persistence Touchpoints:** `media_items`, `member_galleries`, `gallery_external_links`, `media_tags`, `media_flags`, `tags`, `members`, `work_queue_items`, `audit_entries`, `outbox_emails`

**Key Rules:**
- `[HD]` Media and galleries: no soft-delete
- `[DB]` `ON DELETE CASCADE` — flags and tags cascade-delete with media; gallery contents cascade with gallery delete
- `[DB]` `ON DELETE SET NULL` — avatar and club logo detach on media delete
- `[APP]` Max 5 video embeds per gallery (APP-009)
- `[DB]` One avatar per member (partial UNIQUE index `ux_media_avatar_per_member`)
- `[APP]` Standard tags not HD (APP-024)
- `[APP]` Photo security processing: re-encode + EXIF strip + resize is not optional — eliminates malicious embedded content
- `[APP]` Tag validation delegated to `HashtagDiscoveryService.validateAndResolveTag()` — MediaGalleryService does not normalize or create tags directly
- `[APP]` Tag stats recomputation is NOT triggered here — `HashtagDiscoveryService.rebuildTagStats()` runs independently via `OperationsPlatformService`

**Transaction + Idempotency:** `deleteGallery` — all child media HD + S3 deletions must be coordinated.

**Async / Side Effects:** audit append · work queue insert (media flag) → admin-alerts notification · outbox enqueue (admin takedown notification to uploader)

---

### 7.2 `HashtagDiscoveryService`

**Purpose/Boundary:** Owns tag creation and validation, tag browse/search pages, tag stats cache, and teaching moments data. Does NOT own media tagging operations — those are owned by MediaGalleryService.

**Consumers:** MediaGalleryService (tag validation), EventService (standard tag reservation), ClubService (standard tag reservation), member controllers (browse), OperationsPlatformService (stats rebuild job)

**Key Methods:**
- `validateAndResolveTag(tagString) -> {tagId, isStandard}` — normalizes (lowercase, strip invalid chars, prefix `#`); looks up or creates `tags` row; standard tag uniqueness enforced by `UNIQUE INDEX ux_tags_normalized [DB]`
- `reserveStandardTag(entityType, entityId, tagString) -> {tagId}` — called at event/club creation by EventService and ClubService; validates format pattern; case-insensitive uniqueness check; creates `tags` row with `is_standard = 1`; permanent — must not be HD (APP-024)
- `browseAllTags(sortBy) -> {tags}` — public; reads `tag_stats`; returns community tags (distinct_member_count >= 2) only; sortable by popularity or alphabetically
- `getTagGalleryMeta(tagNormalized) -> {tag, mediaCount}` — public; tag gallery page metadata
- `rebuildTagStats() -> {ok}` — called only by `OperationsPlatformService.runTagStatsRebuild()`; reads from **both** `media_tags` (for `usage_count`) AND `members` (for `distinct_member_count`; per APP-020); upserts `tag_stats`; updates `computed_at`; job failure leaves existing stats in place
- `getPopularTags(limit) -> {tags}` — public; teaching moments and upload UI suggestions; reads `tag_stats`

**Authz:** Browse/view: public. `rebuildTagStats`: system job only (via OperationsPlatformService). `reserveStandardTag`: called internally by EventService/ClubService.

**Persistence Touchpoints:** `tags`, `tag_stats`, `media_tags` (read for stats rebuild), `members` (read for distinct member count)

**Key Rules:**
- `[DB]` `ux_tags_normalized` — global tag uniqueness (unique index on normalized tag form)
- `[APP]` Standard tags (`is_standard = 1`) must not be HD (APP-024); reject any delete request
- `[APP]` Community tag threshold: `distinct_member_count >= 2` for public browse page
- `[APP]` `rebuildTagStats` reads both `media_tags` (usage count) and `members` (distinct member count) — omitting either produces incorrect community-tag threshold results
- `[APP]` `rebuildTagStats` is not callable directly — it is only invoked by `OperationsPlatformService.runTagStatsRebuild()`

**Async / Side Effects:** audit append (tag creation for standard tags)

---

### 7.3 `NewsService`

**Purpose/Boundary:** Owns news item creation (auto-generated and admin-authored), moderation, and public feed. Does NOT generate its own news — calling services (EventService, ClubService, MembershipTieringService, VotingElectionService) invoke `emitNewsItem()` as a side effect of their own domain actions.

**Consumers:** EventService, ClubService, MembershipTieringService, VotingElectionService, AdminGovernanceService

**Key Methods:**
- `emitNewsItem(sourceService, newsType, entityId, title, body) -> {newsItemId}` — internal; creates `news_items` row; `news_type` from controlled vocabulary (`event_published`, `event_results`, `club_created`, `club_archived`, `member_honor`, `vote_results`, `announcement`, `system`)
- `createManualNewsItem(adminId, input) -> {newsItemId}` — admin only; title max 200 chars; optional entity reference; publish date defaults to now or future-dated; audit-logs
- `editNewsItem(adminId, newsItemId, input) -> {ok}` — admin only; audit-logs
- `deleteNewsItem(adminId, newsItemId, reason) -> {ok}` — HD immediately; mandatory reason (max 500 chars); audit-logs with news item ID, reason, timestamp
- `getNewsFeed(viewerContext, pagination) -> {items}` — public (logged-in members and visitors); future-dated items not shown until publish date
- `getNewsItem(newsItemId) -> {item}` — public

**Authz:** `emitNewsItem`: internal (service-to-service only). `createManualNewsItem`, `editNewsItem`, `deleteNewsItem`: admin only. Feed/item: public.

**Persistence Touchpoints:** `news_items`, `audit_entries`

**Key Rules:**
- `[HD]` News items: immediate permanent removal on delete; no soft-delete
- `[APP]` `emitNewsItem` is the only write path for auto-generated news — domain services must not write to `news_items` directly
- `[APP]` News moderation queries use `news_items` directly (hard-delete domain; no `_all` alias)
- `[APP]` Deletion requires mandatory reason

**Async / Side Effects:** audit append (manual create/edit/delete)

---

### 7.4 `LegalService`

**Purpose/Boundary:** Owns the static page view-model for the public `/legal` route, which composes Privacy, Terms of Use, and Copyright & Trademarks as three anchored sections on a single page. Does NOT own policy decisions themselves — the content strings are authored and approved out-of-band and updated by editing the service source.

**Consumers:** Web controllers (`legalController.index` renders `GET /legal`)

**Key Methods:**
- `getLegalPage() -> {PageViewModel<LegalContent>}` — public; returns a page view-model conforming to VIEW_CATALOG §6.19; includes `content.lastUpdated` (ISO date) and `content.sections` (ordered array of three `LegalSection` entries with ids `privacy`, `terms`, `copyright`)

**Authz:** Public.

**Persistence Touchpoints:** none (static content).

**Key Rules:**
- `[APP]` Content is static; no database reads or writes
- `[APP]` Section order is fixed: Privacy, Terms of Use, Copyright & Trademarks
- `[APP]` Anchor IDs are stable (`privacy`, `terms`, `copyright`) so external deep links and footer links remain valid
- `[APP]` Substantive content changes must be reflected by updating `content.lastUpdated`
- `[APP]` Operator identity, governing law, and copyright year range are authoritative and require deliberate review when changed

**Async / Side Effects:** none.

---

## 8. Communication

---

### 8.1 `CommunicationService`

**Purpose/Boundary:** Owns outbox polling/sending via SES, mailing list management, subscription management, email archival, SES bounce/complaint handling, and email template management. Does NOT trigger sends directly — all other services enqueue to outbox; this service owns the worker, which is invoked by `OperationsPlatformService.runEmailWorker()`.

**Consumers:** All services (enqueue to outbox), AdminGovernanceService (mailing list management), OperationsPlatformService (worker invocation, SES webhook routing)

**Key Methods:**
- `processSendQueue() -> {ok}` — called by `OperationsPlatformService.runEmailWorker()`; polls `outbox_emails`; skips if `email_outbox_paused = 1` (read from `system_config_current`); sends via SES; retries up to `outbox_max_retry_attempts`; dead-letters after max retries; updates `status`; scrubs plaintext receipt tokens from `body_text` after successful delivery (APP-019); logs to CloudWatch (template ID, member ID, outbox ID, timestamp, result — not raw email addresses)
- `enqueueEmail(recipient, templateId, context, idempotencyKey) -> {outboxId}` — internal; writes `outbox_emails`; stable idempotency key prevents duplicate sends

Target service contract for mailing lists, admin sends, bounce/complaint handling, and template management:
- `sendAnnounceEmail(memberId, subject, body) -> {ok}` — **Tier 2+ members only** (distinct from admin-only list sends); rate-limited; sends to configured `announce@footbag.org` address; archives in `email_archives` with `archive_type='announce'`, `sender_member_id`, `subject`, `body_text`, `sent_at`, `recipient_count=1`; audit-logs (actor ID, subject, timestamp)
- `sendMailingListEmail(actorId, listSlug, subject, body) -> {ok}` — admin only (except announce list, handled by `sendAnnounceEmail`); enumerates `mailing_list_subscriptions`; applies subscription status filter; archives in `email_archives`; audit-logs; includes unsubscribe links
- `createMailingList(adminId, input) -> {listId}` — admin; mailing list backed by `mailing_lists`
- `archiveMailingList(adminId, listSlug) -> {ok}` — admin; preserves subscriptions and history; removes from member controls and send flows; audit-logs
- `updateMemberSubscription(memberId, listSlug, status) -> {ok}` — member self-service for `is_member_manageable = 1` lists; persistent; audit-logs
- `adminAdjustSubscription(adminId, memberId, listSlug, status, reason) -> {ok}` — admin only; exceptional cases (bounced/complained states); audit-logs with reason
- `updateEmailTemplate(adminId, templateKey, content) -> {ok}` — admin only; updates `email_templates` (keyed by `template_key`); changes take effect immediately without code deployment; audit-logs old/new content; `email_templates_enabled` view reflects active templates
- `handleSESBounce(payload) -> {ok}` — called by `OperationsPlatformService.runSESWebhookProcessor()`; updates `mailing_list_subscriptions.status` to `bounced`; applies global suppression; idempotent
- `handleSESComplaint(payload) -> {ok}` — called by `OperationsPlatformService.runSESWebhookProcessor()`; updates status to `complained`; idempotent
- `getMailingListStats(adminId, listSlug) -> {stats}` — admin; subscriber counts by status
- `getEmailArchive(actorId, filters) -> {archive}` — admin (global) or organizer (their events only)

**Authz:** `processSendQueue`: system job (via OperationsPlatformService). `enqueueEmail`: internal. `sendAnnounceEmail`: Tier 2+. All list management and template updates: admin only. Member subscription self-service: `is_member_manageable = 1` lists, owner only.

**Persistence Touchpoints:** `outbox_emails`, `mailing_lists`, `mailing_list_subscriptions`, `email_archives`, `email_templates`, `email_templates_enabled`, `audit_entries`, `system_config_current`

**Key Rules:**
- `[APP]` Outbox pattern: no service calls SES directly; all sends go via `enqueueEmail()` + worker
- `[APP]` Receipt token scrub: `body_text` in voting confirmation emails must be scrubbed after successful delivery (APP-019)
- `[APP]` Email templates are DB-stored and admin-editable without code deployment; template changes audit-logged
- `[APP]` `email_templates_enabled` view exposes only `is_enabled = 1` templates; use this view for active template lookups
- `[APP]` `admin-alerts` list is system-managed (`is_member_manageable = 0`); subscription driven by `is_admin` changes in `MembershipTieringService.adminManageRole()` (APP-015)
- `[APP]` Bounce/complaint rates tracked; alarm raised via `OperationsPlatformService.raiseAlarm()` on threshold breach
- `[APP]` `sendAnnounceEmail` authz is Tier 2+ — distinct from `sendMailingListEmail` which is admin-only for all other lists
- `[APP]` Idempotency key on enqueue prevents duplicate sends on retry

**Transaction + Idempotency:** SES bounce/complaint handlers idempotent. Outbox worker retry is idempotent via idempotency key.

**Async / Side Effects:** audit append (list management, template updates, bulk sends) · alarm raise (bounce/complaint rate thresholds, via OperationsPlatformService)

---

## 9. Governance & Operations

---

### 9.1 `AdminGovernanceService`

**Purpose/Boundary:** Owns admin dashboard, work queue management, audit log viewing, system health view, alarm management, official IFPA roster report/export, reconciliation digest data assembly, and system config writes. Orchestrates cross-service admin actions that don't fit a single domain service. Does NOT own the business logic of domain services it coordinates, and does NOT serve as the runtime config read path — application code and all jobs read `system_config_current` directly.

**Consumers:** Admin controllers

**Key Methods:**
- `getDashboard(adminId) -> {workQueue, alarmSummary}` — summarized work queue (pending event approvals, flagged media, payment discrepancies, recurring donation failures, no-leader clubs, no-organizer events, email dead-letters, active unacknowledged alarms, vote management items)
- `getWorkQueue(adminId, filters) -> {items}` — filterable by category; each item links to detail view
- `resolveWorkQueueItem(adminId, itemId, decision, reason) -> {ok}` — records resolution; timestamp; resolving admin
- `getAuditLogs(adminId, filters) -> {entries}` — filterable by date range, category, actor type; read-only; sorted newest first
- `getSystemHealth(adminId) -> {metrics}` — email delivery rates, outbox status (pending/sent/failed/dead-letter counts), backup job status, storage usage, monthly cost vs budget; reads `system_job_runs` surfaced by `OperationsPlatformService.recordJobRun()`; no direct AWS console links
- `viewStripeHealth(adminId) -> {dashboard}` — test/live mode, last successful webhook + failure counts (24h), API key age, recent payment volume by category (configurable window); links to All Payments and Reconciliation views
- `acknowledgeAlarm(adminId, alarmId, note) -> {ok}` — writes `acknowledged_at`, `acknowledgment_note`; acknowledges alarms raised by `OperationsPlatformService.raiseAlarm()`; audit-logs
- `getSystemConfig(adminId) -> {params}` — admin UI read path only; returns all `system_config_current` values grouped by section; do not route runtime config reads through this method
- `setConfigValue(adminId, key, value, reason) -> {ok}` — inserts a new `system_config` row with `value_json`, `effective_start_at = now`, and `changed_by_member_id = adminId`; validates range/type before write; `system_config_current` picks up new value immediately; audit-logs old/new; **never UPDATEs existing rows** — `system_config` is append-only
- `updateMembershipPricing(adminId, key, centsAmount, reason, effectiveStartAt = now) -> {ok}` — inserts a new `system_config` row for one approved pricing key (`tier1_lifetime_price_cents`, `tier2_annual_price_cents`, `tier2_lifetime_price_cents`); maps `effectiveStartAt` directly to `system_config.effective_start_at` (optional; defaults to current timestamp when omitted); validates integer cents amount > 0; duplicate `(config_key, effective_start_at)` entries fail via the DB UNIQUE path; audit-logs old/new plus effective date; values are integer cents (e.g., 1000 = $10.00)
- `getOfficialRosterReport(adminId, filters) -> {report}` — admin only; reads authoritative membership roster projection from `member_tier_current` plus member profile/flag fields; Tier 1+ members only; returns counts by tier and special flags plus total registered accounts comparator; audit-logs report access
- `exportOfficialRoster(adminId, format, filters) -> {export}` — admin only; v1.5 supports `format = 'csv'` only; Tier 1+ members only; uses canonical DB literal values in any machine-readable fields; audit-logs with export count and format
- `getReconciliationIssues(adminId, statusFilter) -> {issues}` — Outstanding/Resolved/All; resolved items show resolver, timestamp, note
- `buildReconciliationDigestData(actorContext) -> {digest}` — admin or system role; read-only digest payload assembly (summary counts + issue highlights); does NOT send email — enqueue is handled by `OperationsPlatformService.runNightlyReconciliation()`

**Authz:** All methods admin-only **except** `buildReconciliationDigestData`, which may be called by admin or system role (scheduled orchestration via `OperationsPlatformService`).

**Persistence Touchpoints:** `work_queue_items`, `audit_entries`, `system_config`, `system_config_current`, `system_alarm_events`, `reconciliation_issues`, `member_tier_current`, `members`, `members_all`

**Key Rules:**
- `[DB]` Audit log append-only: UPDATE/DELETE blocked
- `[DB]` `system_config` is append-only: UPDATE/DELETE blocked by triggers
- `[APP]` `setConfigValue` and `updateMembershipPricing` INSERT new rows; they never UPDATE or DELETE existing rows
- `[APP]` `getSystemConfig` is the admin UI read path only — runtime config reads by jobs and services go directly to `system_config_current`, not through this service
- `[APP]` Pricing keys are integer cents (`tier1_lifetime_price_cents`, `tier2_annual_price_cents`, `tier2_lifetime_price_cents`); UI layer converts to display currency
- `[APP]` Work queue items: visible post-resolution with status, resolver, timestamp, decision, reason
- `[APP]` Official roster report/export ownership belongs here, not in `CompetitionParticipationService`; roster rows derived from `member_tier_current` + member profile/flag fields; Tier 0 excluded from official export

**Async / Side Effects:** audit append

---

### 9.2 `OperationsPlatformService`

**Purpose/Boundary:** Owns background job orchestration, system job run logging, alarm raise/ack, backup jobs, static asset cleanup, and application-level readiness composition for operational health checks. Does NOT own domain business logic, delegates all of it to named domain service methods. Does NOT own row-level PII purge logic (MemberProfileLifecycleService).

**Consumers:** Job scheduler, system role processes

**Key Methods:**
- `runTierExpiryCheck() -> {ok}` — SYS_Check_Tier_Expiry; daily; evaluates all Tier 1/2 Annual memberships; sends reminders at `tier_expiry_reminder_days_1` and `tier_expiry_reminder_days_2` offsets (never more than once per day per member per offset); delegates all tier writes to `MembershipTieringService.processExpiry()`; logs counts and failure metrics to CloudWatch
- `runEmailWorker() -> {ok}` — SYS_Send_Email; polls outbox every `outbox_poll_interval_seconds`; delegates to `CommunicationService.processSendQueue()`
- `openPendingVotes() -> {ok}` — SYS_Open_Vote; at minimum hourly; delegates to `VotingElectionService.openVote()`; sends admin-alerts email per opened vote; audit-logs
- `closePendingVotes() -> {ok}` — SYS_Close_Vote; at minimum hourly; delegates to `VotingElectionService.closeVote()`; sends admin-alerts email per closed vote; audit-logs
- `runPaymentWebhookProcessor(payload, sig) -> {ok}` — SYS_Process_One_Time_Payments / SYS_Process_Recurring_Donations; validates Stripe signature; delegates to `PaymentService.handleStripeWebhook()`; idempotent
- `runSESWebhookProcessor(payload) -> {ok}` — SYS_Handle_SES_Bounce_And_Complaint_Webhooks; delegates to `CommunicationService.handleSESBounce()` / `handleSESComplaint()`; idempotent
- `runNightlyReconciliation() -> {ok}` — SYS_Reconcile_Payments_Nightly; 2 AM UTC; delegates to `PaymentService.runReconciliation()`; after passes complete, deletes resolved `reconciliation_issues` rows where `expires_at <= now`; if digest cadence is due (`reconciliation_summary_interval_days`), calls `AdminGovernanceService.buildReconciliationDigestData()` and enqueues delivery via `CommunicationService.enqueueEmail()` under system-role context; idempotent and operationally logged
- `runPIIPurgeJob() -> {ok}` — SYS_Cleanup_Soft_Deleted_Records; daily; executes **separate** member PII cleanup branches: (1) soft-deleted accounts after `member_cleanup_grace_days`; (2) deceased-member records after `deceased_cleanup_grace_days`; deceased and deleted are distinct lifecycle states — do not collapse into one grace rule; also applies payment record cleanup after `payment_retention_days` and ballot retention cleanup after `ballot_retention_days`; events with published results and clubs never deleted; delegates member-row PII work to `MemberProfileLifecycleService.purgeAccountPII()`; writes comprehensive audit log entry with counts per entity type/branch
- `runTokenCleanup() -> {ok}` — SYS_Cleanup_Expired_Tokens; daily; deletes expired or consumed tokens older than `token_cleanup_threshold_days`; idempotent; logs counts by token type
- `runTagStatsRebuild() -> {ok}` — SYS_Rebuild_Hashtag_Stats; daily; delegates to `HashtagDiscoveryService.rebuildTagStats()`; failure leaves existing stats; logs metrics
- `runNightlyBackupSync() -> {ok}` — SYS_Nightly_Backup_Sync; incremental S3 → cross-region DR bucket sync; integrity verification; S3 Object Lock (WORM) on DR bucket; logs run metadata; calls `raiseAlarm()` on failure
- `cleanupStaticAssets() -> {ok}` — SYS_Cleanup_Static_Asset_Versions; daily off-peak; deletes content-hash asset versions older than configured retention window (default 90 days); logs deletions; calls `raiseAlarm()` on failure
- `recordJobRun(jobName, status, metadata) -> {ok}` — writes `system_job_runs`; surfaced in `AdminGovernanceService.getSystemHealth()`
- `raiseAlarm(type, details) -> {ok}` — writes `system_alarm_events`; acknowledged via `AdminGovernanceService.acknowledgeAlarm()`
- `getJobHistory(adminId, jobName, filters) -> {runs}` — admin; reads `system_job_runs`
- `runContinuousBackup() -> {ok}` — SYS_Continuous_Database_Backup; every `continuous_backup_interval_minutes` minutes (default: 5); WAL checkpoint; SQLite backup API; upload to primary S3 with retry (3 attempts, exponential backoff); record operational success/failure metadata; raise alarms after repeated failure. Backup health is an operational concern, not a current readiness gate.
- `checkReadiness() -> {isReady, checks}` — read-only; composes the readiness signal for `/health/ready`; currently the minimal SQLite readiness probe only

**Authz:** All job methods: system role only. `getJobHistory`: admin.

**Persistence Touchpoints:** `system_job_runs`, `system_alarm_events`, `system_config_current`, `audit_entries`, `reconciliation_issues`

**Key Rules:**
- `[APP]` All background jobs read configuration from `system_config_current` at runtime — no hardcoded thresholds
- `[APP]` All webhook handlers idempotent
- `[APP]` Continuous backup success/failure is surfaced through logs, job-run history, and alarms, not through `/health/ready`
- `[APP]` All SYS jobs write `system_job_runs` via `recordJobRun()` on every run for admin visibility
- `[APP]` Tier expiry: Tier 2 Annual fallback to Tier 1 Lifetime must be atomic (no gap between tier states); atomicity enforced inside `MembershipTieringService.processExpiry()`
- `[APP]` PII purge job has distinct member branches: soft-deleted accounts use `member_cleanup_grace_days`; deceased members use `deceased_cleanup_grace_days`; these are separate grace rules and must not be collapsed
- `[APP]` PII purge: events with published results preserved permanently; clubs preserved permanently; payment records: `payment_retention_days`; ballots: `ballot_retention_days`
- `[APP]` Resolved reconciliation issue rows deleted by `runNightlyReconciliation()` after `expires_at` (set at INSERT per APP-018)
- `[APP]` This service owns job orchestration only — it contains no domain logic; all substantive work is delegated to named domain service methods

**Transaction + Idempotency:** All job handlers idempotent. Webhook processors idempotent. Token cleanup idempotent.

**Async / Side Effects:** audit append (tier expiry, PII purge, tally operations, reconciliation job runs) · alarm raise (backup failures, bounce rates, consecutive webhook failures) · outbox enqueue (tier reminders, expiry notifications, scheduled reconciliation digest; all delegated to domain services)

---

## 10. Legacy Migration

---

### 10.1 `LegacyMigrationService`

**Purpose/Boundary:** Owns all self-serve and admin legacy account claim flows (including direct historical-person claims for competitors who had no old-site user account), merge transaction execution, and bootstrap club leadership resolution. Does NOT own club lifecycle, tier grant writes (delegates to MembershipTieringService), or club-leader promotion beyond bootstrap confirmation.

**Consumers:** Member profile controllers (claim flow), historical detail controllers (direct HP claim CTA), admin controllers (manual recovery, bootstrap leadership resolution)

**Key Methods:**
- `initiateAccountClaim(activeMemberId, identifier) -> {ok}` — classifies identifier type (legacy email, legacy username, or legacy member ID); looks up the matching `legacy_members` row; if exactly one eligible (unclaimed) row is found, creates an `account_claim` token bound to `activeMemberId` and the target `legacy_member_id`; applies rate limiting per requesting account, per target row, and per session/IP; queues claim email to `legacy_email`; writes audit event `legacy_claim_email_sent`; returns a generic non-revealing response regardless of outcome (does not distinguish zero matches, multiple matches, ineligible rows, or blocked rows).
- `consumeAccountClaim(token, activeMemberId) -> {claimData}` — validates token (exists, unconsumed, unexpired, `token_type = 'account_claim'`, `member_id` matches `activeMemberId`); validates target `legacy_members` row still exists and is unclaimed; returns confirmation data including the active account identity and any club-affiliation or bootstrap-leader suggestions for review; on member confirmation, runs merge transaction: sets `members.legacy_member_id` to the target legacy_member_id, copies editable fields from `legacy_members` to the member row per MIGRATION_PLAN §8 merge rules (COALESCE / OR-merge / fill-if-empty), if the target `legacy_members.legacy_member_id` matches a `historical_persons.legacy_member_id` also sets `members.historical_person_id` to that HP's `person_id` and runs the HP-sourced field merge (country fill-if-empty; is_hof/is_bap OR; hof_inducted_year/first_competition_year fill-if-empty), sets `legacy_members.claimed_by_member_id` + `claimed_at` (the row is NOT deleted), writes tier reconciliation grant via MembershipTieringService if imported tier exceeds current, writes confirmed club affiliations to `member_club_affiliations`, processes bootstrap-leader confirmations, and marks all outstanding `account_claim` tokens targeting this `legacy_members` row as consumed; writes audit event `legacy_claim_completed` with full merge summary.
- `lookupHistoricalPersonForClaim(activeMemberId, personId) -> {claimPreview} | null` — read-only eligibility preview for the direct historical-person claim flow (scenarios D and E per MIGRATION_PLAN §7). Validates that the viewer has not already claimed an HP, the target HP exists and is unclaimed, surname of `real_name` matches surname of `historical_persons.person_name`, and no conflicting legacy-account state exists. Returns the HP identity (name, country, HoF/BAP flags) plus a `firstNameWarning` flag when the first names differ (variant like Dave/David). Throws a ValidationError with a user-safe message on ineligibility. Controllers render the claim confirmation page from this result.
- `claimHistoricalPerson(activeMemberId, personId) -> {ok}` — executes the direct-HP claim atomically. Revalidates eligibility inside a transaction, then: if the HP carries an unclaimed `legacy_member_id` back-link, marks that `legacy_members` row claimed and runs the legacy-field merge (same as `consumeAccountClaim`); sets `members.historical_person_id` (the partial UNIQUE index enforces one live member per HP); runs the HP-sourced field merge. Writes audit event `hp_claim_completed`.
- `manualLegacyClaimRecovery(adminId, targetLegacyMemberId, activeMemberId, reason, verificationNote) -> {ok}` — admin-initiated merge for cases where self-serve claim is unavailable; runs the same merge transaction as `consumeAccountClaim` against the `legacy_members` row identified by `targetLegacyMemberId`; requires non-empty `reason` and `verificationNote`; writes audit event `legacy_claim_manual_recovery` with actor, target, reason, and verification note; never auto-promotes `legacy_is_admin` to live admin role
- `confirmBootstrapLeadership(activeMemberId, bootstrapLeaderId) -> {ok}` — called during claim flow; validates bootstrap row is `provisional` and active member's `legacy_member_id` matches the row's `legacy_member_id`; if no conflicting live leader exists for the club, creates a `club_leaders` row on the active account and marks bootstrap row `claimed`; if a conflict exists, leaves row provisional and flags for admin review; writes audit event `legacy_club_bootstrap_promoted` or notes the conflict
- `resolveBootstrapLeadership(adminId, bootstrapLeaderId, action, reason) -> {ok}` — admin resolution of provisional bootstrap leadership; actions: `promote` (link to a specific claimed member's `club_leaders` row), `supersede` (mark row superseded; appoint live leader through standard workflow), `reject` (discard provisional assignment); all actions audit-logged

**Authz:** `initiateAccountClaim`, `consumeAccountClaim`, `confirmBootstrapLeadership`: authenticated member (own account only). `manualLegacyClaimRecovery`, `resolveBootstrapLeadership`: admin only.

**Persistence Touchpoints:** `members`, `legacy_members`, `historical_persons` (read-only, for HP-match during claim), `account_tokens`, `member_tier_grants` (via MembershipTieringService), `member_club_affiliations`, `club_bootstrap_leaders`, `club_leaders`, `audit_entries`, `outbox_emails`

**Key Rules:**
- `[APP]` Non-revealing messaging: claim initiation response never distinguishes zero matches, multiple matches, ineligible rows, or blocked rows. Recommended: "If an eligible legacy record was found, a claim email will be sent."
- `[APP]` Merge transaction is atomic. The target `legacy_members` row is MARKED CLAIMED (`claimed_by_member_id` + `claimed_at` set); the row is NOT deleted and persists as the permanent archival record. Member-editable fields copy to the claiming `members` row per MIGRATION_PLAN §8. If the target's `legacy_member_id` matches a `historical_persons.legacy_member_id`, `members.historical_person_id` is set to that HP's `person_id` in the same transaction. All outstanding `account_claim` tokens targeting the claimed `legacy_members` row are marked consumed in the same transaction.
- `[APP]` Rate limiting applies to claim initiation and resend per requesting account, per target row, and per session/IP
- `[APP]` A token may only be consumed by the same `member_id` that initiated the request; consuming while authenticated as a different account is rejected
- `[APP]` Tier reconciliation grant is written only if the imported effective tier exceeds the current effective tier; uses `reason_code = 'migration.legacy_claim_reconcile'`
- `[APP]` `legacy_is_admin` metadata is never auto-promoted to live admin role in any flow
- `[APP]` One-current-club invariant: when writing a confirmed current affiliation to `member_club_affiliations`, any existing current row for that member is converted to `is_current = 0` in the same transaction
- `[APP]` Bootstrap leadership promotion is only attempted when no conflicting live `club_leaders` row exists for the club; conflicts leave the bootstrap row provisional and create an admin work queue item

**Transaction + Idempotency:** Merge transaction is atomic. Token validation and consumption are single-transaction.

**Async / Side Effects:** outbox enqueue (claim email, resend) · audit append (all claim and bootstrap events)

---

**END OF SERVICE CATALOG DOCUMENT**
