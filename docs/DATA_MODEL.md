# Footbag Website Modernization Project — Data Model
**Last updated:** March 16, 2026
**Prepared by:** David Leberknight / [DavidLeberknight@gmail.com](mailto:DavidLeberknight@gmail.com)
**Schema file:** `database/schema_v0_1.sql`  
**Schema counts:** 49 tables · 9 views · 108 named indexes · 18 triggers

**Quick routing:**
- Use this document for: persisted entities, relationships, schema conventions, retained triggers, and DB-vs-app enforcement boundaries.
- Next docs: `database/schema_v0_1.sql` for exact SQL definitions, `docs/SERVICE_CATALOG.md` for service-layer usage, `docs/DESIGN_DECISIONS.md` for rationale, `src/db/db.ts` for sql queries.

---

## Table of Contents

1. Design Philosophy
2. Schema Conventions
3. DB-Enforced vs App-Enforced Rules
4. Domain Overview
  4.1 Tags
  4.2 Clubs
  4.3 Events
  4.4 Tier 1 Vouch Requests
  4.5 Votes & Elections
  4.6 Hall of Fame
  4.7 News
  4.8 Mailing Lists & Email
  4.9 Admin Operations
  4.10 Payments
  4.11 System Configuration & Pricing
  4.12 Member Tier Grants
  4.13 Member Tier Current View
  4.14 Members & Authentication
  4.15 Member Links
  4.16 Registrations & Event Results
  4.17 Media & Galleries
  4.18 Club Leaders & Event Organizers
  4.19 Account Tokens
  4.20 Mailing List Subscriptions
  4.21 Media Flags & Tags
  4.22 Tag Stats Cache
  4.23 Seed Data
5. View Reference
6. Application-Enforced Integrity & Workflow Rules
7. Retained DB Triggers
8. SQLite Runtime Requirements
9. Clarifications

---

## 1. Design Philosophy

This schema is intentionally minimal for a volunteer-maintained SQLite project.

**Core principle:** the database enforces structural integrity; the application enforces workflow, business rules, and limits.

- **Declarative first.** Use `PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `NOT NULL`, and `CHECK` constraints before reaching for triggers. Partial `UNIQUE` indexes encode important structural invariants (one leader per club, one avatar per member, etc.) declaratively.

- **Triggers only for genuine integrity guards.** Triggers remain for append-only/immutability invariants on tables where a missed write or an accidental UPDATE/DELETE would corrupt auditable history that cannot be reconstructed (ballots, audit log, tier grants, transition ledgers, system config). The payment status state machine trigger is retained because multiple independent code paths mutate `payments.status`; a DB guard is the last line of defence regardless of which path runs.

- **Application owns policy.** Count caps (max 3 member links, max 5 gallery videos, max 5 leaders/organizers), workflow state machines (subscription lifecycle), transaction ordering (dual-write, payment gating), and side effects (cache sync, email, mailing list) all live in the application layer and are documented in §6.

- **Minimal view surface.** Views are defined only when they provide a semantic filter, a multi-condition search surface, or a computed projection from effective-dated or history data. Identity aliases over physical tables are not used; the table name itself serves as the direct query surface for unrestricted access.

- **Soft-delete pattern.** Tables with `deleted_at` provide a `_active` view that filters deleted rows and an `_all` view for admin queries. Tables without soft-delete use the bare table name as the query surface; semantic filter views are named with explicit suffixes (e.g., `clubs_open`, `recurring_donation_subscriptions_active`). **`clubs` is an explicit exception:** it uses status-based archival (`status = 'archived'`) instead of `deleted_at`; see §4.2.

- **Timestamps.** All timestamps are `TEXT` in ISO-8601 UTC format: `YYYY-MM-DDTHH:MM:SS.sssZ`. This format sorts lexically and chronologically identically, enabling correct `MAX()` and `WHERE … <= now` comparisons in views and triggers. Writers **must** use `strftime('%Y-%m-%dT%H:%M:%fZ','now')` (not `datetime('now')`, which produces a space-separated format that breaks sort ordering).

---

## 2. Schema Conventions

### Standard columns

Every mutable table (tables that support UPDATE, except append-only tables) carries:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `TEXT PRIMARY KEY` | Application-generated UUID |
| `created_at` | `TEXT NOT NULL` | ISO-8601 UTC insertion timestamp |
| `created_by` | `TEXT NOT NULL` | Actor ID (member ID or system identifier) |
| `updated_at` | `TEXT NOT NULL` | ISO-8601 UTC last-update timestamp |
| `updated_by` | `TEXT NOT NULL` | Actor ID of last updater |
| `version` | `INTEGER NOT NULL DEFAULT 1` | Optimistic concurrency counter; increment on every UPDATE |

Append-only tables (audit log, ballots, transition ledgers, tier grants, system_config) omit `updated_at`, `updated_by`, and `version` because they are never updated.

### Soft-delete columns

Tables with soft-delete carry `deleted_at TEXT` and `deleted_by TEXT`. The `_active` view filters `WHERE deleted_at IS NULL`. Soft-deleted rows are never physically removed; use the `_all` view for admin queries.

> **Exception — Clubs:** `clubs` does **not** carry `deleted_at` or `deleted_by`. Club archival sets `status = 'archived'`. The `clubs_open` view filters `WHERE status IN ('active', 'inactive')`; `clubs_all` includes archived rows. See §4.2.

### Enum values

All enumerated string columns use `CHECK (col IN (…))` constraints. This catches invalid values at insert/update time with a clear error.

### Boolean columns

SQLite has no native boolean type. All boolean columns use `is_*` prefix: `INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0,1))`.

Exception: columns that directly mirror an external system's field name (e.g., Stripe) retain the external naming semantics but apply the `is_` prefix (e.g., `is_cancel_at_period_end`).

### Foreign keys

Foreign keys reference the physical table directly by its bare name. `_base` suffixes have been removed from all tables in v1.5. Nullable FKs use `ON DELETE SET NULL` where the referencing column being NULL is a valid "detached" state (e.g., `members.avatar_media_id`). Hard-reference FKs use `ON DELETE CASCADE` where appropriate (e.g., `media_flags.media_id ON DELETE CASCADE`).

### Actor column convention

Two actor column patterns are used and are intentionally distinct:

- **Free-form actor** (`created_by`, `updated_by`): `TEXT NOT NULL`. Accepts member UUIDs or system process identifiers (e.g., `'system'`, `'job:tier_expiry'`). No FK because system actors are not rows in `members`. Used on all standard metadata columns.
- **Typed member FK** (`*_member_id` role columns): `TEXT REFERENCES members(id)`. Used when the actor must be a specific, queryable platform member. Nullable where system-initiated actions are possible.

### Index naming

| Type | Prefix | Example |
|------|--------|---------|
| Non-unique index | `idx_` | `idx_members_tier` |
| Unique index | `ux_` | `ux_members_email`, `ux_clubs_hashtag` |
| Trigger | `trg_` | `trg_ballots_no_update` |

---

## 3. DB-Enforced vs App-Enforced Rules

### DB-enforced (schema layer)

| Mechanism | Examples |
|-----------|---------|
| `PRIMARY KEY` | Row identity uniqueness |
| `NOT NULL` | Required fields |
| `UNIQUE` / partial `UNIQUE` index | One leader per club, one avatar per member, email uniqueness for un-purged members |
| `CHECK` | Enum values, boolean shape, conditional NOT NULL (PII purge invariant) |
| `FOREIGN KEY` + `ON DELETE SET NULL` | Avatar/logo/gallery detachment on media delete |
| `FOREIGN KEY` + `ON DELETE CASCADE` | Media flags/tags cascade-delete with media |
| Immutability triggers | Append-only tables: audit log, ballots, eligibility snapshot, tier grants, payment/subscription transitions, system_config |
| State machine trigger | `payments.status` forward-only transitions |

### App-enforced (application layer)

All rules in §6. Key items:

- Count caps: 3 member links, 5 gallery videos, 5 club leaders, 5 event organizers
- Config writes: INSERT a new `system_config` row; never UPDATE existing rows
- Payment dual-write: update `payments.status` and insert `payment_status_transitions` in the same transaction
- Subscription dual-write: same pattern for `recurring_donation_subscriptions` + transitions
- Stripe success gating: only write tier grants / confirmed registrations after payment succeeds
- Subscription lifecycle state machine
- Admin role prerequisites and anti-lockout
- Competitor registration discipline min-cardinality
- ISO-8601 T-format timestamp enforcement for all writers
- `PRAGMA foreign_keys = ON` on every connection

---

## 4. Domain Overview

### 4.1 Tags

**Table:** `tags`

Tags are globally unique normalized strings prefixed with `#`. The `UNIQUE INDEX ux_tags_normalized` enforces uniqueness for all currently-existing rows with no `WHERE` clause.

Standard tags (`is_standard = 1`) follow platform patterns:
- Events: `#event_{year}_{event_slug}`
- Clubs: `#club_{location_slug}`

Freeform tags are unrestricted beyond security input validation (HTML stripping, Unicode normalization, max 100 characters).

The event tag/key pattern is exact and underscore-based. Documentation and route contracts must not assume hyphen/underscore rewrites, aliasing, or fuzzy matching.

The `tag_normalized` column stores the lowercased form; `tag_display` stores the original capitalization for rendering.

**Standard-tag permanence:** Standard tags are permanent identities and must not be hard-deleted. The global unique index enforces extant-row uniqueness, but permanent reservation of standard-tag normalized forms across time is workflow/application-enforced (see APP-024). The schema carries no soft-delete mechanism for tags; permanent reservation depends entirely on delete discipline.

### 4.2 Clubs

**Table:** `clubs`  
**Views:** `clubs_open` (active and inactive), `clubs_all` (including archived)

Clubs do **not** use soft-delete. `deleted_at` and `deleted_by` are **not** present on `clubs`. Club archival sets `status = 'archived'`. `clubs_open` filters `WHERE status IN ('active', 'inactive')`; `clubs_all` includes archived rows.

`logo_media_id REFERENCES media_items(id) ON DELETE SET NULL`: deleting a media item automatically detaches it as the club logo. The application stamps `updated_at`/`updated_by` when explicitly removing a logo; the FK action covers deletion via other paths.

Each club has a unique `hashtag_tag_id` (enforced by `UNIQUE INDEX ux_clubs_hashtag`). This hashtag is the canonical club identifier for gallery auto-linking.

### 4.3 Events

**Tables:** `events`, `event_disciplines`

Events use hard-delete (US `EO_Delete_Event`; DD §2.3). Events with result rows are preserved permanently by workflow constraints; all other events are removed immediately and permanently on deletion. `event_disciplines` uses hard-delete (disciplines removed from draft events are gone immediately).

`events.host_club_id REFERENCES clubs(id)` is the canonical optional relationship for the MVFP `hostClub` display field. It represents the club publicly associated with hosting the event. It is nullable because some imported historical events may not have a confidently known host club. Public MVFP pages must derive `hostClub` from this relationship only when present. They must not infer a host club from organizer membership, tags, or other heuristics.

`discipline_category` is an application-enforced taxonomy field (the DB requires only `TEXT NOT NULL`). Canonical top-level families are `net`, `freestyle`, `golf`, and `sideline` (legacy `other` values should be normalized to `sideline`). Variant/sub-discipline structure is managed in application logic, e.g., sideline-family formats such as 2-square, 4-square, consecutives, and one-pass, plus multiple freestyle and net variants.

`team_type` encodes the participation format for each discipline: `'singles'` (default), `'doubles'`, or `'mixed_doubles'`. Used at registration time to enforce partner requirements: doubles requires partner info; mixed doubles additionally requires that both partners have `members.sex` populated with opposite values.

#### Event status lifecycle (application-managed)
```
draft → published → registration_full | closed → completed | canceled
```

#### Sanction status (application-managed)
```
none → pending → approved | rejected
```

#### Payment state
`payment_enabled` is set by an admin; `competitor_fee_cents` and `attendee_fee_cents` are nullable (free events).

The US uses the term "completed" for a succeeded one-time payment. The schema uses `'succeeded'` to align with Stripe's `payment_intent` vocabulary. See §4.10.

### 4.4 Tier 1 Vouch Requests

**Table:** `tier1_vouch_requests`

Vouching is available via two pathways (US §1.2):

- **Pathway A (Direct Roster Access):** automatically granted to Tier 2+ event organizers for a configurable window (default 14 days) after uploading results for a sanctioned event.
- **Pathway B (Request to Administrators):** available at any time via web form.

`notes_text` is optional additional context for Pathway B only; `reason_text` is the required brief rationale on all requests.

#### DB-enforced structural constraint
`CHECK (requested_by_member_id <> target_member_id)` prevents a structurally malformed self-vouch row at the database level. The application also validates this at request submission time.

#### Application responsibilities (app-enforced values/workflow)
- Prevent self-vouching (`requested_by_member_id` must differ from `target_member_id`). Also enforced by DB CHECK as defense-in-depth.
- Enforce text limits and content rules (`reason_text` max 200 chars; `decision_reason` max 500 chars; non-empty where required by the API contract).
- Enforce status transitions and decision-field consistency:
  - `pending` has no decision metadata
  - `approved` / `denied` require admin actor + decision timestamp
  - `denied` requires a denial reason
- Enforce authorization (who may submit / approve / deny) and offline Membership Director consent requirements.
- Audit-log all submit/approve/deny actions.

The DB stores request structure and references; the application owns vouch-request value semantics and workflow validation.

### 4.5 Votes & Elections

**Tables:** `votes`, `vote_options`, `vote_eligibility_snapshot`, `ballots`, `vote_results`, `vote_result_option_totals`

#### Eligibility snapshot
`vote_eligibility_snapshot` is written once at vote-open time. UPDATE and DELETE are blocked by DB triggers. Tier expiry during an open vote does not revoke eligibility.

#### Ballots
`ballots` stores encrypted ballots. UPDATE and DELETE are blocked by triggers.

**Ballot encryption (per-ballot AES-256-GCM envelope encryption):** For each ballot submission, the server requests a fresh data key from AWS KMS (`GenerateDataKey`). The ballot payload is encrypted using AES-256-GCM with that key. The following fields are persisted together:
- `encrypted_ballot_b64` — AES-256-GCM ciphertext (base64)
- `ballot_nonce_b64` — AES-GCM nonce/IV (base64); required for decryption
- `ballot_auth_tag_b64` — AES-GCM authentication tag (base64); required for integrity verification
- `encrypted_data_key_b64` — KMS-encrypted data key (base64); decryptable only with the privileged tally role
- `kms_key_id` — KMS CMK identifier

The plaintext data key is never persisted. Decryption is available only during controlled tally operations using a separate IAM role with `kms:Decrypt` permission.

**Participation metadata (intentional, non-anonymous design):** `voter_member_id` is stored as plaintext alongside the encrypted ballot. `ballots` is **not** anonymous-ballot storage. Voter identity (participation fact) is co-located with the encrypted ballot by design. Ballot **content** confidentiality is provided by AES-256-GCM encryption; the participation fact (who voted) is not hidden.

**Receipt tokens:** stored as hashes (`receipt_token_hash`); plaintext tokens are transient and must be scrubbed from `outbox_emails.body_text` after delivery (see APP-019).

**Tally authorization (app-enforced):** Ballot decryption and tally operations must require an authorization check equivalent to a `can_tally_votes` permission. This is enforced in the application auth layer; no schema column models this permission (see APP-023). All decryption operations must be audit-logged.

#### Vote results
`vote_results` holds the tally outcome per vote. `vote_result_option_totals` provides normalized per-option counts. In addition, `result_json` (TEXT, nullable) allows the application to store the full tally result as a single JSON blob per vote. Both representations may coexist; the application is responsible for keeping them consistent if both are populated.

#### Vote window ordering (DB-enforced)
`votes` carries three table-level `CHECK` constraints that protect election integrity:
- `vote_open_at < vote_close_at` — always required.
- `nomination_open_at < nomination_close_at` — when both are non-NULL.
- `nomination_close_at <= vote_open_at` — when nomination phase is used.

These are DB-enforced because multiple admin paths can write `votes` and the invariants are critical for correct ballot acceptance windows.

#### Vote options lock (DB-enforced)
Once a vote reaches status `open`, `closed`, `published`, or `canceled`, the triggers `trg_vote_options_lock_insert`, `trg_vote_options_lock_update`, and `trg_vote_options_lock_delete` block all mutations to `vote_options` for that vote. This prevents retroactive option changes from corrupting already-cast ballots.

#### Vote options visibility
`options_visible_at` in `votes`: when set, vote options are visible from this timestamp. The application enforces `options_visible_at <= vote_open_at` (US §3.7 requirement for admin-configurable early option visibility).

### 4.6 Hall of Fame

**Tables:** `hof_nominations`, `hof_affidavits`

`hof_nominations.vote_id` links a nomination window to the HoF election vote. NULL for legacy/pre-platform nominations. `UNIQUE(nomination_year, nominee_member_id)` prevents duplicate nominations per year.

#### Nominee snapshot fields
`nominee_snapshot_name` (TEXT NOT NULL) and `nominee_snapshot_contact` (TEXT, nullable) capture the nominee's name and contact information **at submission time**. The nominee is identified by `nominee_member_id` FK, but platform member data can change or be GDPR-purged after a nomination is submitted. Snapshot fields ensure HoF records remain complete and human-readable regardless of later member data changes.

- **New nominations:** populate both fields from the member's current `real_name` and contact info at the time of form submission.
- **Legacy/migration rows:** populate `nominee_snapshot_name` from the member record at import time; `nominee_snapshot_contact` may be NULL if no contact data is available.

`idx_hof_nominations_nominee ON hof_nominations(nominee_member_id)` supports "has this member been nominated" lookups (a documented service pattern).

Affidavits are one-per-nomination (`UNIQUE` on `nomination_id`).

### 4.7 News

**Table:** `news_items`

News items are hard-deleted immediately on admin action (US `A_Moderate_News_Item`; DD §2.3). No soft-delete grace period applies.

News items are auto-generated as side effects of primary entity flows (event published, results posted, club created, HoF/BAP status granted, vote results published). Admins can also create manual announcements.

`news_type` values map to triggering events:

| Value | Triggering action |
|-------|------------------|
| `event_published` | Event reaches published status |
| `event_results` | Results uploaded for a completed event |
| `club_created` | New club created on the platform |
| `club_archived` | Admin archives a club (`A_Archive_Club`) |
| `member_honor` | HoF induction, BAP award, or board appointment |
| `vote_results` | Election/vote results published |
| `announcement` | Admin-authored manual announcement |
| `system` | System-generated operational notice |

### 4.8 Mailing Lists & Email

**Tables:** `mailing_lists`, `outbox_emails`, `email_archives`, `email_templates`  
**Views:** `email_templates_enabled`

#### Outbox pattern
All emails are written to `outbox_emails` first; a background worker sends them and updates `status`. The admin Pause Sending toggle prevents new sends without losing queued items.

`idempotency_key` prevents duplicate sends when the same outbox row is retried.

At least one of `recipient_email`, `recipient_member_id`, or `mailing_list_id` must be non-NULL (enforced by a `CHECK` constraint).

#### Voting receipt tokens
`body_text` for voting confirmation emails contains a plaintext receipt token. The sender worker **must** scrub `body_text` after successful delivery while retaining the ballot row's `receipt_token_hash`. See APP-019.

#### Email archives
`email_archives` stores a record of bulk sends (mailing list blasts, event participant emails, announcements). `CHECK` constraints enforce that mailing-list sends reference a list and event-participant sends reference an event.

#### Email templates
`email_templates` stores admin-editable subject and body templates keyed by `template_key`. The `email_templates_enabled` view exposes only templates where `is_enabled = 1`. Setting `is_enabled = 0` suppresses the corresponding automated email type without deleting the content.

#### Mailing list column
`mailing_lists.is_member_manageable` controls whether members can self-subscribe/unsubscribe. Six core lists are seeded at initialization; see §4.23.

### 4.9 Admin Operations

**Tables:** `work_queue_items`, `system_config`, `audit_entries`, `system_job_runs`, `system_alarm_events`  
**Views:** `system_config_current`

#### Work queue
Admin task queue with `queue_category` and `task_type`. When any task is added, the application sends a notification to the admin-alerts mailing list containing task type and entity ID only (no sensitive data).

#### System config
`system_config` is an append-only effective-dated key-value store. Each row represents the value of a config key from a given `effective_start_at` forward. The current effective value per key is provided by the `system_config_current` view (latest row with `effective_start_at <= now`). Changing a config value means inserting a new row; old rows are immutable (UPDATE and DELETE blocked by triggers).

`system_config_current` is the authoritative read surface for all runtime config lookups. All background jobs and application code MUST use this view for config reads; never query `system_config` directly unless building admin history UIs or audit reports.

Config values are admin-configurable. All numeric limits and time windows in the system are stored here rather than being hardcoded (US §1 Global Behaviors). Background jobs and application code read their thresholds from `system_config_current` at runtime; missing keys will cause runtime errors. See §4.23 for the full list of seeded defaults.

`changed_by_member_id` is a typed FK to `members` (not free-form text). System-seeded rows at initialization use NULL for this field with a documented `reason_text` explaining the system origin.

#### Audit log
`audit_entries` is an append-only, privacy-safe ledger. IP addresses and user-agent strings are **never** stored. UPDATE and DELETE are blocked by DB triggers; rows are permanent. Actor context uses `actor_type` + `actor_member_id` (NULL for system actors).

#### Alarms
`system_alarm_events` tracks infrastructure and operational alarms. `acknowledgment_note` is set alongside `acknowledged_at` when an admin acknowledges an alarm.

### 4.10 Payments

**Tables:** `stripe_events`, `recurring_donation_subscriptions`, `recurring_donation_subscription_transitions`, `payments`, `payment_status_transitions`, `reconciliation_issues`  
**Views:** `recurring_donation_subscriptions_active`

#### Two payment models (US §1 Global Behaviors)

**One-time payments** (membership dues, event registrations, one-time donations): keyed by Stripe `payment_intent_id`.

```
State machine (DB-enforced by trg_payments_status_monotonicity):
  pending → succeeded | failed | canceled
  succeeded → refunded
```

Same-status no-ops are allowed (idempotent webhook redelivery). No backward transitions.

> **Vocabulary note:** The US uses the term "completed" for a successfully processed one-time payment. This schema uses `'succeeded'` to align with Stripe's `payment_intent` status vocabulary and avoid ambiguity with the event `status` value `'completed'`. This is an intentional deviation from US terminology, documented here.

**Recurring donations** (Stripe Subscriptions): keyed by `stripe_subscription_id` + `stripe_invoice_id`. State management is application-enforced (see APP-005); the DB does not restrict subscription status transitions.

#### Stripe timestamp fields
`stripe_events.stripe_created` and `payments.last_stripe_event_created` are stored as **ISO-8601 UTC TEXT** (consistent with the schema's universal timestamp convention). Stripe delivers these as Unix epoch integers; the application must convert at write time:

```sql
strftime('%Y-%m-%dT%H:%M:%fZ', stripe_event.created, 'unixepoch')
```

#### Stripe event deduplication
`stripe_events` deduplicates all incoming webhook events by `event_id` (Stripe's globally unique event ID), regardless of payment model. On successful processing, `processing_status = 'processed'`; on failure, `processing_status = 'failed'`. The `attempts` column tracks the total number of processing attempts for the event (incremented on each retry, default 1). `last_error` stores the most recent error message for failed attempts. These fields support observability and reconciliation workflows.

#### Recurring subscriptions view
- `recurring_donation_subscriptions_active`: `WHERE status <> 'canceled'`. Use for active-subscription queries.
- Query the bare `recurring_donation_subscriptions` table directly when canceled subscriptions are relevant (e.g., reactivation, reporting).

#### Subscription lifecycle event codes (controlled vocabulary)
`lifecycle_event_code` values in `recurring_donation_subscription_transitions`:

| Code | Meaning |
|------|---------|
| `activated` | Subscription created and active |
| `charge_succeeded` | Billing cycle payment succeeded |
| `charge_failed` | Billing cycle payment failed |
| `cancel_requested` | Member or admin requested cancellation |
| `canceled` | Stripe confirmed cancellation |
| `updated` | Amount or interval changed |

#### Payment dual-write (APP-003, APP-004)
Every `payments.status` change **must** be paired with a `payment_status_transitions` INSERT in the same transaction. The DB does not enforce this pairing; the application must.

#### Reconciliation issues
`expires_at` is set at INSERT using the `reconciliation_expiry_days` config key: `strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || reconciliation_expiry_days || ' days')`. The cleanup job deletes rows WHERE `expires_at <= now AND status = 'resolved'`.

### 4.11 System Configuration & Pricing

**Table:** `system_config`  
**View:** `system_config_current`

Membership pricing is stored as config keys in the same `system_config` table as all operational parameters:
- `tier1_lifetime_price_cents` (integer cents, e.g., `1000` = $10.00)
- `tier2_annual_price_cents` (integer cents, e.g., `2500` = $25.00)
- `tier2_lifetime_price_cents` (integer cents, e.g., `15000` = $150.00)

Values are stored in integer cents for consistency with payment tables. UI layers convert to USD for display.

Like all config values, pricing is changed by inserting a new row with a new `effective_start_at`. Past rows are immutable. The history of all price changes is directly queryable from `system_config` filtered by pricing keys. There are no separate pricing tables.

Price changes are audit-logged via `audit_entries` with `category = 'pricing'` and old/new values in `metadata_json`.

### 4.12 Member Tier Grants

**Table:** `member_tier_grants`

Append-only ledger of all membership tier changes. UPDATE and DELETE are blocked by DB triggers.

#### `change_type` values

| Value | Meaning |
|-------|---------|
| `grant` | New tier awarded |
| `extend` | Annual tier expiry extended |
| `revoke` | Tier removed by admin |
| `expire` | System-detected tier expiry |

> **No `reinstate` change_type:** there is no reinstatement flow in the user stories. Refunds do not alter tier status (US §1.2: "completed payments are not retroactively altered"). Admin error correction and board-flag reversion are written as `grant` rows with `reason_code = 'admin.override'`.

#### `reason_code` vocabulary (extensible, no DB CHECK)

| Code | Meaning |
|------|---------|
| `purchase.dues` | Tier grant from dues payment |
| `vouch.direct` | Roster vouch via direct access |
| `vouch.admin` | Admin-approved vouch request |
| `admin.override` | Admin manual grant or change |
| `admin.hof_bap_grant` | Tier 2 Lifetime auto-grant triggered by HoF or BAP badge assignment |
| `board.flag_set` | Board member flag set (→ Tier 3) |
| `board.flag_removed` | Board member flag removed (→ revert to underlying paid tier; uses `change_type = 'grant'`) |
| `system.tier_expired` | Tier 1 Annual expired: `SYS_Check_Tier_Expiry` writes `expire` row with `new_tier_status = 'tier0'` |
| `system.tier2_fallback` | Tier 2 Annual expired: `SYS_Check_Tier_Expiry` writes `expire` row with `new_tier_status = 'tier1_lifetime'` |

Both `system.tier_expired` and `system.tier2_fallback` use `change_type = 'expire'`. The distinct `reason_code` values allow audit queries to distinguish Tier 1 Annual downgrade events from Tier 2 Annual → Tier 1 Lifetime fallback events without parsing `old_tier_status`.

#### Source linkage (pathway encoding)

All source FK columns are nullable. The combination of non-null FKs encodes the originating pathway:

| Pattern | Pathway |
|---------|---------|
| `related_payment_id IS NOT NULL` | Purchase-origin |
| `related_vouch_request_id IS NOT NULL` | Admin-approved vouch (Pathway B) |
| `related_event_id IS NOT NULL AND related_vouch_request_id IS NULL` | Direct roster vouch (Pathway A) |
| All source FKs NULL | Admin override or system-driven |

#### DB-enforced structural constraints
- `CHECK` on source FKs: at most one of `related_payment_id`, `related_vouch_request_id`, `related_event_id` may be non-NULL (provenance guard).
- `CHECK` on negative rows: `revoke` and `expire` rows must have NULL for `related_vouch_request_id` and `related_event_id`. Source FKs belong only on initial application rows (`grant`/`extend`).
- `ux_tier_grants_vouch_once`: at most one ledger row per `related_vouch_request_id`. The DB treats this as a last-line safety net; the app is the primary idempotency controller.
- `ux_tier_grants_event_once`: at most one ledger row per `(member_id, related_event_id)`. Enforces US §1.2 "a unique member may not be listed on the roster more than once."

#### Application responsibilities (APP-016, APP-017; app-enforced values/workflow)
- Write valid source-linkage FK combinations and `reason_code` values per the pathway rules above.
- Enforce semantic consistency between `reason_code` and source linkage (e.g., purchase rows link to payments, admin-vouch rows link to vouch requests, direct-vouch rows link to events).
- Only populate `related_vouch_request_id` or `related_event_id` on the initial tier-application row for a given source. Subsequent `revoke`/`expire` rows for the same member must leave these FKs NULL. The DB CHECK enforces this structurally; the app must also uphold the convention to prevent misattribution.
- **Board flag snapshot consistency:** when writing a `board.flag_set` grant row (→ Tier 3), `new_fallback_tier_status` must capture the member's pre-board underlying paid tier. A subsequent `board.flag_removed` grant row reads this value to revert correctly. Use `change_type = 'grant'`, `reason_code = 'board.flag_removed'`, `new_tier_status` = member's fallback paid tier.
- **Event-origin error corrections:** if an event-sourced grant must be corrected (e.g., wrong member ID was submitted), use admin override (`change_type = 'grant'` or `'revoke'`, `reason_code = 'admin.override'`, all source FKs NULL). Do not attempt to write a second row carrying the event FK — `ux_tier_grants_event_once` will block it, by design.
- Enforce idempotent write behavior in the service layer; treat DB unique indexes as a safety net, not the primary control.
- Write no-op approvals/denials to request/audit records without inserting ledger rows when no tier state changes.
- Update `members` tier cache fields (`tier_status`, `tier_expires_at`, `fallback_tier_status`) in the same transaction as every tier-changing ledger write.
- **Revoke limitation for dues members:** admin revoke cannot reduce a dues-paying member's tier below Tier 1 Lifetime (the purchase overlay in `member_tier_current` would ignore the revoke anyway, but the application should detect this condition before allowing the action and communicate it clearly to the admin).

### 4.13 Member Tier Current View

**View:** `member_tier_current`

Derives the effective current tier for each member from the **latest ledger snapshot row** in `member_tier_grants` plus the "ever paid dues" purchase-history overlay. This is the **authoritative read model** for tier data. The `members` tier cache columns exist for auth-path performance; `member_tier_current` is the source of truth.

`member_tier_current` includes a row for every member. Members with no tier ledger entries (including brand-new registrations) are returned with `tier_status = 'tier0'`, `tier_expires_at = NULL`, and `fallback_tier_status = NULL`.

Current-tier derivation uses `new_tier_status`, `new_tier_expires_at`, and `new_fallback_tier_status` from the latest ledger row. There is no row-level `expires_at` column on `member_tier_grants`; expiry state is encoded in the `new_*` snapshot columns.

#### Output columns
`member_id`, `tier_status`, `tier_expires_at`, `fallback_tier_status`

#### "Ever paid dues → Tier 1 Lifetime" rule (US §1.2)
Any member with at least one grant row where `reason_code LIKE 'purchase.%'` (and `change_type IN ('grant','extend')`) receives an implicit Tier 1 Lifetime that persists even if their paid tier subsequently lapses. The view applies this as a read-time overlay after resolving the member's latest ledger state, so negative ledger rows (e.g., `revoke`, `expire`) are respected while preserving the "ever paid dues" rule.

> **Refund policy:** If a membership-dues payment is subsequently refunded, the "ever paid dues" Tier 1 Lifetime fallback is not reversed. The historical fact of completed payment is preserved in the ledger via the purchase-origin grant row. The application may write a `revoke` ledger row on refund, but `member_tier_current` still returns `tier1_lifetime` due to the purchase-history overlay. This behavior is consistent with US §1.2 "Ever-paid dues ⇒ Tier 1 for life," which contains no refund exception.

> **Note:** `members` does not have an `ever_paid_dues_at` column. The "ever paid dues" rule is derived exclusively from `member_tier_grants` via `member_tier_current`. Do not add an equivalent cache column.
>
> **Application responsibility:** because the DB does not validate `reason_code` semantics, the tier service must only emit `purchase.%` ledger rows for genuine dues-purchase outcomes. The project's chosen refund policy is: once a `purchase.%` ledger row exists, the "ever paid dues" Tier 1 Lifetime fallback is permanent — a subsequent refund does not remove it (US §1.2 "ever paid dues ⇒ Tier 1 for life" is unconditional). The application may write a `revoke` row on refund but must not attempt to retroactively remove or invalidate the purchase-origin grant row.

#### In-view expiry safety net
If the latest ledger row shows an annual tier (`tier1_annual` or `tier2_annual`) whose `new_tier_expires_at` has already passed, the view falls back to `new_fallback_tier_status` from that same row inline — without waiting for `SYS_Check_Tier_Expiry` to write an `expire` row. This eliminates the up-to-24-hour gap between a tier technically expiring and the daily batch job processing it.

#### Fallback tier
`new_fallback_tier_status` on each ledger row records the member's permanent floor — the highest non-expiring paid tier they hold independent of their current active tier. Tier 3 is never a fallback (it is a board-appointment flag, not a purchasable tier). The fallback is set correctly by the application on every ledger write; the DB does not validate its correctness. When `member_tier_current` returns `NULL` for `fallback_tier_status`, the member has no permanent paid tier floor.

### 4.14 Members & Authentication

**Table:** `members`  
**Views:** `members_active` (non-deleted), `members_all` (all including deleted), `members_searchable`

#### Sex field

`sex` (`TEXT`, nullable): member's biological sex. Required for sex-restricted event categories: mixed doubles requires one `'male'` and one `'female'` partner; Women's net requires `'female'`. Nullable to accommodate legacy and imported accounts. Validation of sex-field completeness for restricted categories is application-enforced at discipline-selection time (see APP-013).

#### Authentication columns
- `password_version`: **session/JWT invalidation counter**. Increment on every password reset or change. All JWTs containing an older value are immediately invalid. Do not use for hash algorithm tracking.
- `password_hash_version`: hash algorithm version only. Increment when the hashing algorithm changes. Do not use for session invalidation.

#### Tier cache columns
`tier_status`, `tier_expires_at`, `fallback_tier_status` are denormalized from `member_tier_current`. They exist for performance on authenticated requests (e.g., authorization checks in middleware). `member_tier_current` is authoritative; the application **must** keep these in sync (APP-017).

`fallback_tier_status` accepts `tier0`, `tier1_annual`, `tier1_lifetime`, `tier2_annual`, `tier2_lifetime` only. **`tier3` is not a valid fallback** — it is a board-appointment flag, not a dues-based tier. The DB CHECK enforces this. The canonical behavior is that `member_tier_current` emits `NULL` for `fallback_tier_status` when no non-expiring tier exists.

#### Hall of Fame nomination / induction tracking

`hof_last_nominated_year` (`INTEGER`, nullable) stores the **most recent** Hall of Fame nomination year for the member. This preserves useful history across annual rollover/carryover cases without storing a full nomination-year list.

`hof_inducted_year` (`INTEGER`, nullable) stores the Hall of Fame induction year for members with the permanent `is_hof` badge.

`is_hof` remains the permanent Hall of Fame honor flag. Any current-cycle authorization/workflow flag equivalent to `HoF_Nominated` is application-derived from `hof_last_nominated_year` and the active nomination cycle year (US §2.1 / US §3.7).

#### Stripe identity
`stripe_customer_id` is the member-level canonical Stripe Customer ID (set when a recurring donation is first created). `payments.stripe_customer_id` is a per-payment snapshot and is **not** the canonical ID.

#### `legacy_member_id`

`legacy_member_id` is a migration-era traceability field. It may help reconcile imported historical records with current members, but it does not by itself imply account ownership, authenticated access, or a unified persons model.

#### PII purge
`login_email`, `login_email_normalized`, `password_hash`, and `password_changed_at` are nullable to support GDPR account purge. A `CHECK` constraint enforces a two-way invariant: they are required for un-purged members (`personal_data_purged_at IS NULL`) and must be `NULL` once `personal_data_purged_at` is set.

**Anonymized-stub requirement (app-enforced):** When setting `personal_data_purged_at`, the application must produce a complete anonymized retained stub in the same transaction: clear all nullable contact fields (`phone`, `whatsapp`) and overwrite required non-null identity/location fields with anonymized placeholder values as needed to satisfy schema constraints. Exception: for members with `is_hof = 1` or `is_bap = 1`, preserve `display_name` and `bio` per User Stories deletion policy; other required retained identity/location fields remain anonymized as needed. Schema nullability does not enforce the full anonymized-stub shape; this is application-enforced (see APP-022).

#### `avatar_media_id`
`ON DELETE SET NULL`: deleting a media item automatically detaches it as the member's avatar without requiring a before-delete trigger.

#### `members_searchable` view
**The member search endpoint MUST query this view.** It applies all four exclusion conditions: soft-deleted, deceased, opted-out (`searchable = 0`), and PII-purged accounts. Do not add extra `WHERE` clauses on top of `members_active` or the bare `members` table for search.

`searchable = 1` means the member is **eligible for authenticated current-member lookup only**. It does not mean publicly discoverable, publicly contactable, or visible on public historical-person pages. Member search is authenticated Tier 0+, anti-enumeration, and never public. See `docs/GOVERNANCE.md §7`.

### 4.15 Member Links

**Table:** `member_links`

External profile URLs (e.g., personal website, social media). Maximum 3 per member (US §3.2 M_Edit_Profile).

**This limit is application-enforced** (see APP-008). The application must reject inserts and `member_id` reassignments that would exceed 3 rows per member.

URLs are validated by the application before insertion (must be `https`, well-formed, not targeting localhost/private addresses).

### 4.16 Registrations & Event Results

**Tables:** `registrations`, `roster_access_grants`, `registration_discipline_selections`, `event_results_uploads`, `event_result_entries`, `historical_persons`, `event_result_entry_participants`

#### Competitor registration completeness (APP-013)
Before a competitor registration reaches `status = 'confirmed'`, the application must ensure at least one `registration_discipline_selections` row exists for that registration.

#### Roster access for vouch (Pathway A)
`roster_access_grants` tracks direct vouching access windows granted to event organizers after uploading results for a sanctioned event. `expires_at` is set to `granted_at + configurable duration (default 14 days)`.

**DB responsibility:** store the window and enforce basic interval sanity (`CHECK (expires_at > granted_at)`).  
**Application responsibility:** determine eligibility, compute duration from config (`vouch_window_days`), issue/revoke grants, and prevent duplicate or invalid grants beyond the schema's structural constraints.

#### Historical imported people

`historical_persons` stores imported read-only historical identities used by legacy result imports.

These rows may or may not correspond to current rows in `members`. They exist so imported historical results can preserve participant identity without requiring that every historical person be a current Member.

`legacy_member_id` on `members` and `historical_persons` is migration-era traceability only for this design. It is not, by itself, a platform-wide unified identity system.

**Governance note:** Imported `historical_persons` rows are public historical record surfaces only. They do not confer member-account status, searchability, or contactability. The imported aggregate fields (`event_count`, `placement_count`, freestyle metrics, etc.) are migration-era metadata — not automatic public statistics. Any aggregate field shown publicly must satisfy the historian-value and completeness/caveat requirements in `docs/GOVERNANCE.md §6`. When a `historical_person_id` is linked to a `member` row (account claim), the historical public pages must continue to show only historical-record data; the link does not escalate the historical identity into a searchable or contactable current-member account.

> **Maintainer note (longer-term design):** Longer-term, the platform may distinguish a broader Person concept from Member account/membership status, so historical imported people and other non-member identities do not need to be forced into the members table. That longer-term direction is not implemented by this slice. This document should describe the accepted current schema as-is and should not be read as requiring a platform-wide unified persons model yet.

#### Results
`event_result_entries.discipline_id` is nullable (NULL = discipline-agnostic / general ranking). `UNIQUE(event_id, discipline_id, placement)` prevents duplicate placements for discipline-specific rows. For general-ranking rows (`discipline_id IS NULL`), the partial unique index `ux_result_entries_general_placement` on `(event_id, placement) WHERE discipline_id IS NULL` prevents duplicates — required because SQLite treats `NULL` values as distinct in `UNIQUE` constraints.

#### Result participants and linkage semantics

`event_result_entry_participants.display_name` is the canonical always-renderable participant label for public results.

`event_result_entry_participants.member_id` remains the optional link to a current member row when known.

`event_result_entry_participants.historical_person_id` is the optional link to `historical_persons(person_id)` for imported historical identity when known.

For public rendering in the current slice:
- always render `display_name`
- only expose a participant link when a supported historical-person-backed detail target exists
- otherwise render plain text

#### MVFP public-results clarification
Version 0.1 of the schema does not define a separate publish/unpublish state for event results. For the MVFP public events/results slice, **public results exist** in application logic only when both of the following are true:
1. the event itself is publicly visible under the public event-status rule, and
2. at least one `event_result_entries` row exists for that event.
If a future version introduces a distinct result-publication workflow, that behavior must be added explicitly to the schema and to the service/view contracts rather than inferred retroactively.

### 4.17 Media & Galleries

**Tables:** `media_items`, `member_galleries`, `gallery_external_links`

#### Hard-delete
Both `media_items` and `member_galleries` use **hard-delete only** (no `deleted_at`). Members own their content and can delete it immediately without leaving orphaned rows.

#### Referential cleanup (declarative FK actions)
When a media item is deleted:
- `members.avatar_media_id` → `SET NULL` (avatar detached, member row intact)
- `clubs.logo_media_id` → `SET NULL` (logo detached, club row intact)
- `media_flags` / `media_tags` → `CASCADE` delete (flags and tags removed with the media)

When a gallery is deleted:
- `media_items.gallery_id` → **`CASCADE`** (all media in the gallery is deleted with it)
- `gallery_external_links` → `CASCADE` delete

The gallery `CASCADE` matches the US requirement in M_Delete_Own_Media: deleting a gallery deletes its contents. Avatar photos are never gallery-assigned (`gallery_id IS NULL` when `is_avatar = 1`), so cascade cannot accidentally remove avatar content.

`media_flags.media_id ON DELETE CASCADE` and `media_tags.media_id ON DELETE CASCADE`: flags and tags are removed when their media is deleted.

`gallery_external_links.gallery_id ON DELETE CASCADE`: external link rows are removed when their gallery is deleted.

#### Video cap (APP-009)
Maximum 5 video embeds per named gallery (US §3.8 M_Organize_Media_Galleries). **Application-enforced.** The application must reject inserts and `gallery_id` reassignments that would exceed 5 `media_type = 'video'` rows per gallery.

#### Partial UNIQUE indexes
- `ux_media_avatar_per_member ON media_items(uploader_member_id) WHERE is_avatar = 1`: at most one avatar photo per member (DB-enforced).
- `ux_galleries_default_per_member ON member_galleries(owner_member_id) WHERE is_default = 1`: at most one default gallery per member (DB-enforced).

#### Avatar integrity CHECKs
- `CHECK (is_avatar = 0 OR media_type = 'photo')`: avatars must be photos (DB-enforced).
- `CHECK (is_avatar = 0 OR gallery_id IS NULL)`: avatars cannot be gallery-assigned (DB-enforced). This ensures gallery `CASCADE` delete cannot accidentally remove avatar content.

### 4.18 Club Leaders & Event Organizers

**Tables:** `club_leaders`, `event_organizers`

#### Club leaders
1 leader + up to 4 co-leaders per club = **max 5 total** (US §5.2 CL_Manage_CoLeaders).

DB-enforced structural invariants:
- `ux_one_leader_per_club`: only one `role = 'leader'` row per club.
- `ux_one_club_leader_per_member`: a member can be `'leader'` of at most one club.
- `ux_club_leaders (club_id, member_id)`: a member appears at most once per club.

**Max-5 cap is application-enforced** (APP-010). The application must reject inserts and `club_id` reassignments that would exceed 5 total rows per club.

#### Event organizers
1 organizer + up to 4 co-organizers per event = **max 5 total** (US §4.1 EO_Manage_CoOrganizers).

DB-enforced structural invariants:
- `ux_one_organizer_per_event`: only one `role = 'organizer'` row per event.
- `ux_event_organizers (event_id, member_id)`: a member appears at most once per event.

**Max-5 cap is application-enforced** (APP-011). The application must reject inserts and `event_id` reassignments that would exceed 5 total rows per event.

#### Anti-self-removal
The application must prevent an organizer/leader from removing themselves if they are the sole organizer/leader (UI hides the button; API validates before delete). DB does not enforce this.

### 4.19 Account Tokens

**Table:** `account_tokens`

Security tokens for email verification, password reset, and data export requests. Tokens are stored as SHA-256 hashes only; plaintext is never persisted.

- **Email verification tokens** expire after the duration configured in `email_verify_expiry_hours` (default: 24 hours).
- **Password reset tokens** expire after the duration configured in `password_reset_expiry_hours` (default: 1 hour).
- Both TTL values are Administrator-configurable via `system_config_current` (see §4.23).
- **Multiple outstanding tokens are allowed** per member per type. The index `idx_account_tokens_active` on `(member_id, token_type)` is non-unique; it supports lookup performance but does not limit the number of active tokens.
- `token_type` represents the token purpose. Values: `email_verify`, `password_reset`, `data_export`.
- `used_at` records when the token was consumed (single-use); `NULL` means not yet consumed.
- A presented token is valid only when `used_at IS NULL AND now < expires_at`.
- `idx_account_tokens_expires` supports the background cleanup job, which deletes expired or consumed tokens older than the configured threshold (`token_cleanup_threshold_days`).

**Index strategy:** `ux_account_tokens_hash` is a `UNIQUE` index on `token_hash` alone (globally unique per hash), which covers the token-validation lookup. A separate non-unique index on `(member_id, token_type)` covers per-member token listing. Multiple outstanding tokens per member per type are allowed; the per-member index is intentionally non-unique.

### 4.20 Mailing List Subscriptions

**Table:** `mailing_list_subscriptions`

One row per member per list. `status` values: `subscribed`, `unsubscribed`, `bounced`, `complained`, `suppressed`.

Admin role changes affect mailing list subscriptions as a side effect (APP-015). The admin-alerts list subscription is managed transactionally with `is_admin` changes.

### 4.21 Media Flags & Tags

**Tables:** `media_flags`, `media_tags`

Both tables use `ON DELETE CASCADE` on `media_id`: when media is hard-deleted, its flags and tags are automatically removed.

`UNIQUE(media_id, reporter_member_id)` prevents duplicate flags from the same reporter on the same item.

`UNIQUE(media_id, tag_id)` prevents duplicate tag applications.

### 4.22 Tag Stats Cache

**Table:** `tag_stats`

Denormalized read cache for the tag browse page (US §1.1). `computed_at` tracks the last recomputation time. Note: `tag_id` is the primary key; `tag_stats` has no `id` or `version` column — it follows a cache/upsert pattern rather than a standard mutable entity pattern.

This is recomputable data; the application owns recomputation cadence and may rebuild from source tables at any time. A background job upserts stats rows. `distinct_member_count` drives the "community tag" threshold: tags used by at least 2 distinct members appear on the public `/tags` browse page.

---

### 4.23 Seed Data

**Tables:** `mailing_lists`, `system_config`

Required default rows are included at the end of `schema_v0_1.sql` (Section 23) and are loaded as part of schema initialization. Seed inserts use `INSERT OR IGNORE`, so **the seed INSERTs are idempotent**, but the full schema file is **not** safe to re-run on an existing database because CREATE statements are unguarded.

**Cross-table seed policy (verification and references):**
- Verify/reference `mailing_lists` seeds by `slug` (the natural primary key).
- Verify/reference `system_config` seeds by `config_key` (the semantic identifier).
- `system_config` seed rows use stable string IDs (e.g., `'seed-vouch-window-days'`) as the UUID primary key, making `INSERT OR IGNORE` re-runs idempotent without UUID generation at initialization time.

#### Mailing lists (required on fresh DB)

`slug` is the primary key. Verify seed presence and references by `slug`.

| slug | name | `is_member_manageable` |
|------|------|------------------------|
| `admin-alerts` | Admin Alerts | `0` (system-managed) |
| `all-members` | All Members | `1` |
| `newsletter` | Newsletter | `1` |
| `board-announcements` | Board Announcements | `1` |
| `event-notifications` | Event Notifications | `1` |
| `technical-updates` | Technical Updates | `1` |

#### System config defaults

All `system_config` seed rows use `effective_start_at = '2000-01-01T00:00:00.000Z'` (platform epoch) and `changed_by_member_id = NULL` (system-seeded). The `system_config_current` view returns these as the current effective values until a new row is inserted for any key.

To change any value: INSERT a new row into `system_config` with the desired `value_json`, a new `effective_start_at`, and the acting admin's `changed_by_member_id`. Do not UPDATE existing rows.

| Key | Default | Notes |
|-----|---------|-------|
| `vouch_window_days` | `14` | Pathway A roster-access window after results upload |
| `ballot_retention_days` | `2555` | Ballot retention window (~7 years) |
| `audit_retention_days` | `2555` | Audit log retention window (~7 years) |
| `reconciliation_expiry_days` | `90` | Resolved reconciliation issue TTL |
| `email_sending_paused` | `0` | `1` = pause all outbound email |
| `tier_expiry_grace_days` | `0` | Grace days after `expires_at` before expiry job fires |
| `event_registration_reminder_days` | `7` | Days before event start to send reminder |
| `member_cleanup_grace_days` | `90` | Grace days after soft-delete before PII purge job runs |
| `payment_retention_days` | `2555` | Payment record compliance retention (~7 years) |
| `password_reset_expiry_hours` | `1` | Password reset token TTL (hours) |
| `email_verify_expiry_hours` | `24` | Email verification token TTL (hours) |
| `tier_expiry_reminder_days_1` | `30` | First tier-expiry reminder offset (days before expiry) |
| `tier_expiry_reminder_days_2` | `7` | Second tier-expiry reminder offset (days before expiry) |
| `outbox_max_retry_attempts` | `5` | Max email retry attempts before moving to dead-letter queue |
| `outbox_poll_interval_minutes` | `5` | Outbox worker polling interval (minutes) |
| `token_cleanup_threshold_days` | `7` | Age threshold (days) for cleanup of expired/consumed account tokens |
| `deceased_cleanup_grace_days` | `30` | Grace period (days) before PII removal after member marked deceased |
| `data_export_link_expiry_hours` | `72` | Hours before a personal data export download link expires |
| `login_rate_limit_max_attempts` | `10` | Max failed login attempts within window before lockout |
| `login_rate_limit_window_minutes` | `15` | Sliding window (minutes) for counting failed login attempts |
| `login_cooldown_minutes` | `30` | Lockout duration (minutes) after rate-limit threshold exceeded |
| `password_reset_rate_limit_max_attempts` | `5` | Max password reset requests per email per window |
| `password_reset_rate_limit_window_minutes` | `60` | Sliding window (minutes) for counting password reset requests |
| `jwt_expiry_hours` | `24` | Session JWT lifetime (hours); governs archive access expiry |
| `photo_upload_rate_limit_per_hour` | `10` | Max photo uploads per member per hour |
| `video_submission_rate_limit_per_hour` | `5` | Max video link submissions per member per hour |
| `reconciliation_summary_interval_days` | `7` | Cadence (days) for reconciliation digest email to admins |
| `primary_snapshot_version_days` | `30` | S3 versioning retention window (days) for primary backup bucket |
| `media_flag_rate_limit_per_hour` | `10` | Max media flags per member per hour |
| `cross_region_backup_retention_days` | `90` | Object Lock retention (days) for cross-region DR S3 bucket |
| `continuous_backup_interval_minutes` | `5` | Interval (minutes) between continuous SQLite backup runs |
| `tier1_lifetime_price_cents` | `1000` | Tier 1 Lifetime dues ($10.00 USD default; stored as integer cents) |
| `tier2_annual_price_cents` | `2500` | Tier 2 Annual dues ($25.00 USD default; stored as integer cents) |
| `tier2_lifetime_price_cents` | `15000` | Tier 2 Lifetime dues ($150.00 USD default; stored as integer cents) |

#### Membership pricing config keys (initial pricing — update before launch)

Pricing keys are seeded at platform-epoch defaults. Insert a new `system_config` row with the correct `effective_start_at` and value before going live. Values are integer cents; UI layers convert to USD for display. `tier1_annual` is not seeded because Tier 1 Annual is a free status attained via event attendance or vouching, not a purchasable product.

---

## 5. View Reference

Physical tables are the direct query surface for unrestricted access. Views provide filtered, computed, or admin surfaces. Application code should use the semantically appropriate surface per operation.

### Computed views

These derive state from history or effective-dated tables.

| View | Backed by | Logic |
|------|-----------|-------|
| `member_tier_current` | `member_tier_grants` | Derives current tier per member: latest ledger snapshot + in-view expiry safety net + purchase overlay. Authoritative tier read model. |
| `system_config_current` | `system_config` | Returns the row with the latest `effective_start_at <= now` per `config_key`. Authoritative read surface for all runtime config lookups. |

### Semantic filter views

These apply a meaningful `WHERE` clause; always understand the filter before using them.

| View | Filter | Use case |
|------|--------|----------|
| `members_active` | `deleted_at IS NULL` | General member lookups (non-deleted accounts) |
| `clubs_open` | `status IN ('active','inactive')` | Render club lists and lookups (excludes archived clubs) |
| `email_templates_enabled` | `is_enabled = 1` | Templates active for automated email flows |
| `recurring_donation_subscriptions_active` | `status <> 'canceled'` | Active subscription queries |

### Multi-condition search view

| View | Filter | Use case |
|------|--------|----------|
| `members_searchable` | `deleted_at IS NULL AND is_deceased = 0 AND searchable = 1 AND personal_data_purged_at IS NULL` | **Member search endpoint only.** Applies all four exclusion conditions. |

### Admin full-rowset views

These expose all rows including archived/deleted.

| View | Use case |
|------|----------|
| `members_all` | Admin queries, PII purge workflows, soft-delete management |
| `clubs_all` | Admin queries, audit, reactivate archived clubs |

---

## 6. Application-Enforced Integrity & Workflow Rules

These rules are normative. They **must** be implemented in application code. The database does not enforce them.

---

### APP-001 — `PRAGMA foreign_keys = ON` per connection

**Every SQLite connection must execute `PRAGMA foreign_keys = ON` before any reads or writes.** SQLite disables FK enforcement by default. Setting it in the schema file is not sufficient for connection pools or new connections opened after initialization. Add a startup assertion and integration test to verify this is active.

---

### APP-002 — ISO-8601 T-format timestamps

**All timestamp writers must use `strftime('%Y-%m-%dT%H:%M:%fZ','now')` format (e.g., `2026-02-26T14:30:00.000Z`).** Do not use `datetime('now')`, which produces a space-separated format that breaks lexical sort ordering in time-based views and triggers (for example `member_tier_current`).

---

### APP-003 — Payment status dual-write

**Every `payments.status` change must be paired with a `payment_status_transitions` INSERT in the same transaction.** The DB enforces state machine validity (no backward transitions); the DB does not enforce that a transition row is always written.

---

### APP-004 — Payment state machine validation

The allowed state machine (also enforced by DB trigger):
```
pending → succeeded | failed | canceled
succeeded → refunded
```
Same-status no-ops are allowed (idempotent Stripe webhook redelivery). The application must also validate that the incoming Stripe event matches the expected transition before writing.

---

### APP-005 — Subscription lifecycle dual-write

**Every `recurring_donation_subscriptions.status` change must be paired with a `recurring_donation_subscription_transitions` INSERT in the same transaction.**

Subscription state machine (application-enforced only):
```
→ active (on customer.subscription.created)
active → past_due (on invoice.payment_failed)
past_due → active (on invoice.payment_succeeded after failure)
active | past_due → canceled (on customer.subscription.deleted)
```

---

### APP-006 — Stripe success gating

**Tier grants and confirmed registrations must not be written before payment success is established.** Write tier grants and `registration.status = 'confirmed'` atomically with the `payments.status = 'succeeded'` update. Never grant access on `'pending'`, `'failed'`, or `'canceled'` payments.

---

### APP-007 — Membership pricing config updates

**Update membership pricing by calling `setConfigValue()` through AdminGovernanceService**, which inserts a new row into `system_config` with the appropriate `effective_start_at` and `changed_by_member_id`. Pricing keys are `tier1_lifetime_price_cents`, `tier2_annual_price_cents`, and `tier2_lifetime_price_cents`. Values are integer cents. `system_config` is append-only; never UPDATE existing rows. Verify seeded rows by `config_key` before making changes.

---

### APP-008 — Max 3 member external links

**Reject inserts and `member_id` reassignments on `member_links` that would result in more than 3 rows per member.** Source: US §3.2 M_Edit_Profile ("External URLs on profiles (maximum 3)").

---

### APP-009 — Max 5 video embeds per gallery

**Reject inserts and `gallery_id` reassignments on `media_items` where `media_type = 'video'` that would result in more than 5 video rows per gallery.** Source: US §3.8 M_Organize_Media_Galleries ("Maximum 5 video embeds per named gallery").

---

### APP-010 — Max 5 club leaders

**Reject inserts and `club_id` reassignments on `club_leaders` that would result in more than 5 total rows per club.** Source: US §5.2 CL_Manage_CoLeaders ("Leader can add up to 4 co-leaders" = 5 total). The DB enforces structural uniqueness (one `role='leader'` per club; one leadership per member per club) but not the total count cap.

---

### APP-011 — Max 5 event organizers

**Reject inserts and `event_id` reassignments on `event_organizers` that would result in more than 5 total rows per event.** Source: US §4.1 EO_Manage_CoOrganizers ("Maximum 5 total organizers per event"). The DB enforces structural uniqueness (one `role='organizer'` per event) but not the total count cap.

---

### APP-012 — Updated_at/updated_by stamping on FK-detached rows (optional)

When the application explicitly deletes a media item or gallery and wants to record the detachment on affected parent rows, it should stamp `updated_at`/`updated_by`/`version` on those rows in the same transaction (before the delete). The FK `ON DELETE SET NULL` action handles the FK nullification automatically but does not stamp metadata. For detachments that occur silently (e.g., uploader self-deletes media while the club still references it as logo), the FK action is sufficient and no stamping is required.

---

### APP-013 — Competitor registration discipline completeness

**Before a `registrations` row reaches `status = 'confirmed'` for `registration_type = 'competitor'`, at least one `registration_discipline_selections` row must exist for that registration.** Enforce this validation at confirmation time (before the status write), not at insert time (multi-step UI).

---

### APP-014 — Vote option visibility timing

**If `votes.options_visible_at` is set, the application must enforce `options_visible_at <= vote_open_at`.** Source: US §3.7 voting stories.

---

### APP-015 — Admin role prerequisites and side effects

Admin grant/revoke is application-only logic:
1. **Target-member prerequisite:** only members with `tier_status IN ('tier2_lifetime', 'tier3')` may receive `is_admin = 1` (US §1.2, §6.6 A_Manage_Admin_Role).
2. **Who may grant/revoke:** only existing admins and IFPA Board actors (`is_board = 1`, Tier 3) may manage admin roles. Bootstrap exception: the initial system administrator may appoint the first admin during first-run setup.
3. **Anti-lockout:** the last admin may not have `is_admin` removed. Validate before the update.
4. **Mailing list side effect:** write `mailing_list_subscriptions` changes for admin-alert lists in the same transaction as `is_admin` changes.
5. All admin role changes must be audit-logged.

---

### APP-016 — Tier grant source linkage discipline

**Write valid source-linkage FK combinations and `reason_code` values per the pathway rules documented in §4.12.** The DB does not CHECK `reason_code` (to allow future extensions without migration).

---

### APP-017 — Member tier cache synchronization

**Update `members.tier_status`, `tier_expires_at`, and `fallback_tier_status` in the same transaction as every `member_tier_grants` INSERT.** `member_tier_current` remains authoritative; cache fields exist for auth-path read performance. If a cache drift is detected, recompute from `member_tier_current`.

`members` has no `ever_paid_dues_at` column. Use `member_tier_current` or query `member_tier_grants WHERE reason_code LIKE 'purchase.%'` to determine whether a member has ever paid dues.

---

### APP-018 — Reconciliation issue expiry

**Set `reconciliation_issues.expires_at` at insert using `strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+90 days')`.** The cleanup job deletes rows WHERE `expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') AND status = 'resolved'`.

---

### APP-019 — Ballot receipt token scrubbing

**After successfully delivering a voting confirmation email that contains a plaintext receipt token in `outbox_emails.body_text`, the sender worker must scrub the plaintext token from `body_text` (e.g., replace with a placeholder).** The `ballots.receipt_token_hash` is the persistent record; the plaintext is transient and must not be retained in the outbox after delivery.

---

### APP-020 — Tag stats recomputation

**The application/background job runner owns `tag_stats` recomputation cadence.** This is recomputable cache data; the job may rebuild from source tables (`media_tags`, `members`) at any time. The `computed_at` column records the last full recomputation timestamp.

---

### APP-021 — Seed data required on fresh DB

**Schema initialization (`schema_v0_1.sql`) includes all required seed rows.** Do not skip Section 23 of the schema file. The following tables must have seed rows before the application can function:

- `mailing_lists`: `admin-alerts`, `all-members`, `newsletter`, `board-announcements`, `event-notifications`, `technical-updates` (verify by `slug`) — admin notification and member subscription workflows depend on these slugs.
- `system_config`: all keys in §4.23 (verify by `config_key`) — application reads these at startup and during operations; missing keys will cause runtime errors.

**To verify seed data is present after initialization:**
```sql
SELECT count(*) FROM mailing_lists;     -- expect 6
SELECT count(*) FROM system_config;     -- expect 34
```

**Prefer semantic-key verification for publishable checks/examples:**
```sql
SELECT slug FROM mailing_lists ORDER BY slug;
SELECT config_key, value_json FROM system_config_current ORDER BY config_key;
```

---

### APP-022 — PII purge anonymized-stub workflow

**When setting `personal_data_purged_at` on a `members` row, the application MUST produce a complete anonymized retained stub in the same transaction.** Specifically:

1. Clear all nullable contact fields: set `phone = NULL`, `whatsapp = NULL`.
2. For non-HoF/BAP members, overwrite retained non-null identity and location fields with anonymized placeholders as needed (`real_name`, `display_name`, `display_name_normalized`, `city`, `country`) so they do not retain identifiable values.
3. For members where `is_hof = 1` or `is_bap = 1`, preserve `display_name` and `bio` per User Stories deletion policy; continue anonymizing other required retained identity/location fields as needed.
4. Set `login_email = NULL`, `login_email_normalized = NULL`, `password_hash = NULL`, `password_changed_at = NULL` (allowed by schema once `personal_data_purged_at` is set).

This ensures the retained stub row meets data retention and anonymization requirements. The DB CHECK enforces that credential fields are NULL when purged, but the stub shape for non-nullable profile fields is entirely application-enforced.

---

### APP-023 — Tally authorization (can_tally_votes equivalent)

**Ballot decryption and tally operations MUST require an authorization check equivalent to a `can_tally_votes` permission.** This permission is not modeled as a column in `members`; enforcement is the responsibility of the application auth layer.

Requirements:
1. The admin endpoint that initiates tally operations must verify the calling admin has explicit tally authorization before proceeding.
2. Every ballot decryption operation during tally must be audit-logged via `audit_entries` with `action_type`, `actor_member_id`, `entity_type = 'vote'`, and `entity_id = vote_id`.
3. Tally initiation itself (start and complete events) must also be audit-logged.

---

### APP-024 — Standard tags must not be hard-deleted

**Tags with `is_standard = 1` are permanent identities and MUST NOT be hard-deleted.** The `UNIQUE INDEX ux_tags_normalized` enforces uniqueness for currently-existing rows but cannot prevent a deleted tag's normalized form from being recreated under a different `id` if the original row is deleted.

The application must reject any delete request targeting a `tags` row where `is_standard = 1`. Permanent reservation of standard-tag normalized forms (and therefore their redirect and identity semantics) depends entirely on this application-layer delete discipline.

---

## 7. Retained DB Triggers

The following 18 triggers are intentionally kept in the database. All enforce integrity invariants that would be materially weakened by application-only enforcement (due to multiple write paths, tamper-resistance requirements, or financial-record immutability).

### Append-only / immutability triggers (14)

These prevent UPDATE and DELETE on tables that must be permanent historical records:

| Trigger pair | Table | Reason |
|-------------|-------|--------|
| `trg_vote_eligibility_no_update` / `_no_delete` | `vote_eligibility_snapshot` | Election fairness: snapshot is frozen at vote-open time |
| `trg_ballots_no_update` / `_no_delete` | `ballots` | Ballot tamper resistance |
| `trg_audit_no_update` / `_no_delete` | `audit_entries` | Audit log integrity |
| `trg_recurring_sub_transitions_no_update` / `_no_delete` | `recurring_donation_subscription_transitions` | Subscription lifecycle history |
| `trg_payment_transitions_no_update` / `_no_delete` | `payment_status_transitions` | Payment history integrity |
| `trg_tier_grants_no_update` / `_no_delete` | `member_tier_grants` | Membership tier ledger integrity |
| `trg_system_config_no_update` / `_no_delete` | `system_config` | Config history integrity; enables effective-dated audit trail |

### Vote options lock triggers (3)

| Trigger | Table | Reason |
|---------|-------|--------|
| `trg_vote_options_lock_insert` | `vote_options` | Blocks INSERT when parent vote is `open`/`closed`/`published`/`canceled` |
| `trg_vote_options_lock_update` | `vote_options` | Blocks UPDATE when parent vote is open or later |
| `trg_vote_options_lock_delete` | `vote_options` | Blocks DELETE when parent vote is open or later |

These are kept in the DB because election integrity requires the invariant regardless of which code path (admin API, background job, or direct SQL) touches `vote_options`.

### State machine trigger (1)

| Trigger | Table | Reason |
|---------|-------|--------|
| `trg_payments_status_monotonicity` | `payments.status` | Multiple independent code paths (webhook handler, admin tools, refund worker) can mutate payment status; DB guard prevents silent backward transitions regardless of which path runs |

---

## 8. SQLite Runtime Requirements

### Foreign key enforcement (CRITICAL)

```sql
PRAGMA foreign_keys = ON;
```

**Execute this on every connection before any reads or writes.** SQLite disables FK enforcement by default. The `PRAGMA foreign_keys = ON` at the top of `schema_v0_1.sql` runs once at schema initialization; it does not persist for future connections.

**Implementation checklist:**
- [ ] DB connection factory/initializer executes `PRAGMA foreign_keys = ON` immediately after opening
- [ ] Connection pool hooks run the PRAGMA on every new connection
- [ ] Integration test asserts FK enforcement is active (e.g., attempt an FK violation and verify it is rejected)

### WAL mode (recommended)

```sql
PRAGMA journal_mode = WAL;
```

WAL mode allows concurrent readers during writes and is recommended for web applications. Does not affect schema correctness.

### Timestamp format

All timestamp strings written to the database must use:
```
YYYY-MM-DDTHH:MM:SS.sssZ
```
Example: `2026-02-26T14:30:00.000Z`

In SQLite expressions: `strftime('%Y-%m-%dT%H:%M:%fZ','now')`

This format is required for lexical ordering to match chronological ordering in the `member_tier_current` view, the `system_config_current` view, and anywhere else time-based comparisons are performed.

---

## 9. Clarifications

This section documents naming conventions, view semantics, lifecycle patterns, and intentional design decisions to make existing patterns easier to understand and maintain.

### 9.1 Schema Naming Conventions

#### Table and view access policy

Physical tables are the direct query surface for unrestricted access. Views provide filtered, computed, or admin surfaces. The table name IS the authoritative reference; foreign keys target the bare table name directly.

#### Common view suffixes

| Suffix | Meaning | Example |
|--------|---------|---------|
| `_all` | All rows including archived/deleted/canceled | `members_all`, `clubs_all` |
| `_active` | Explicit non-deleted/active subset | `members_active`, `recurring_donation_subscriptions_active` |
| `_current` | Computed effective-current projection from a history or effective-dated table. Must never be used as a vanity alias over a flat non-versioned table. | `member_tier_current`, `system_config_current` |
| `_searchable` | Multi-condition search-safe surface | `members_searchable` |
| `_open` | Status-based filter: non-archived subset | `clubs_open` |
| `_enabled` | Boolean-filter subset | `email_templates_enabled` |

#### Object naming conventions

- Tables and views: `snake_case`
- Non-unique indexes: `idx_` prefix
- Unique indexes: `ux_` prefix
- Triggers: `trg_` prefix

#### Column naming conventions (common patterns)

- `*_id` — identifiers / foreign keys
- `*_at` — timestamps
- `*_by` — actor/reference for who created/updated a row
- `*_status` — lifecycle/status value
- `*_type` — type discriminator / category
- `is_*` — boolean columns (`INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0,1))`)

These conventions are intentionally repetitive because they improve discoverability, grep-ability, and consistency across a large schema.

### 9.2 Lifecycle / Deletion Strategy

This schema intentionally uses different lifecycle strategies for different entities. These are not interchangeable and are chosen based on each entity's workflow and data retention needs.

#### Common patterns used

- **Soft-delete** — Rows remain stored but are hidden from default views. Represented by `deleted_at`. The `_active` view applies this filter; `_all` exposes everything. Example: `members`.

- **Status-based archival** — Rows remain stored and are considered archived via a status value (e.g., `status='archived'`). Default views may exclude archived rows. Example: `clubs` (via `clubs_open`).

- **Hard-delete** — Rows may be physically deleted when workflow rules allow it. Workflow restrictions are often enforced in application logic. Example: `events`, `news_items`, `media_items`.

- **Append-only / immutable history** — Rows are never updated or deleted after insert. Triggers enforce immutability. Used for: audit, transition history, snapshots, tier grants, system_config.

#### Database vs application responsibility

The database primarily enforces structural integrity: primary keys, foreign keys, unique constraints, check constraints, and selected triggers for critical invariants.

The application enforces workflow and policy rules: authorization/permission checks, state transition orchestration, caps/limits, business process rules, and side effects (notifications, external API workflows, etc.).

Some triggers are intentionally retained for critical safety/integrity invariants even though broader workflow logic is application-managed.

### 9.3 Timestamp Storage Contract (Prominent Clarification)

Timestamps are stored as UTC text in ISO-8601 format using a lexically sortable representation (with `T` separator and `Z` suffix).

This format is relied upon by parts of the schema (including `member_tier_current` and `system_config_current`) that compare timestamps lexically or use operations such as `MAX(...)` on timestamp text values.

Do not change timestamp storage format or timestamp-generation expressions casually. If a change is ever considered, verify that lexical ordering and all dependent view/trigger logic remain equivalent.

### 9.4 Intentional Exceptions / Not a Bug

The schema contains a few patterns that may look inconsistent at first glance but are intentional.

- **`events` and `news_items`** — These domains use hard-delete; there are no `_all` views. The bare table names are the only read surfaces for these domains.

- **`recurring_donation_subscriptions`** — Only an `_active` semantic filter view is defined; the bare table name serves as the full-rowset surface. This is intentional and reflects the preferred query surfaces for this domain.

- **`tag_stats`** — Follows a cache/recomputed-statistics pattern. `tag_id` is the primary key; no `id`, `version`, or mutable metadata columns. Always upserted by background job.

- **`stripe_events`** — External-event ingestion table. Uses `event_id TEXT PRIMARY KEY` (Stripe's event ID) rather than a surrogate UUID. Follows ingestion-oriented semantics that differ from the most common entity-table pattern.

- **`mailing_lists`** — Uses `slug TEXT PRIMARY KEY` (the natural key), not a UUID. Intentionally has no `id` column; slug is the stable semantic reference used by all foreign keys into this table.

- **Append-only ledger/history tables** — Some tables intentionally omit mutable metadata columns (`updated_at`, `updated_by`, `version`) because they are designed to be immutable after insert. This includes `audit_entries`, `ballots`, `member_tier_grants`, `payment_status_transitions`, `recurring_donation_subscription_transitions`, `vote_eligibility_snapshot`, and `system_config`.

When evaluating schema consistency, these exceptions should be treated as design choices tied to domain semantics, compatibility, or operational needs rather than as accidental inconsistencies.
