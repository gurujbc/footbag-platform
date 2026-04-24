# Footbag Website Modernization Project -- Migration Plan

**Document Purpose:**

This document is the source of truth for go-live readiness: legacy data migration design (streams, claim flow, auto-link, merge rules, club bootstrap, name model, competition history), operational readiness gates (backup, observability, edge security, IAM, email ops, maintenance jobs, secrets rotation, pre-cutover reverts), and the phasing, operational states, and validation gates that govern both. For functional requirements, see `USER_STORIES.md`. For privacy and visibility policy, see `GOVERNANCE.md`.

---

## Table of contents

### Part A -- Design

1. [Executive summary](#1-executive-summary)
2. [Migration sources](#2-migration-sources)
3. [Name model](#3-name-model)
4. [Competition history fields](#4-competition-history-fields)
5. [Identity and person links](#5-identity-and-person-links)
6. [Auto-link: matching legacy_members, historical_persons, and members](#6-auto-link-matching-legacy_members-historical_persons-and-members)
7. [Self-serve legacy claim flow](#7-self-serve-legacy-claim-flow)
8. [Merge rules](#8-merge-rules)
9. [Club bootstrap and onboarding](#9-club-bootstrap-and-onboarding)
10. [Registration as the data-cleanup funnel](#10-registration-as-the-data-cleanup-funnel)
11. [Security model summary](#11-security-model-summary)
12. [Admin flows](#12-admin-flows)
13. [User stories summary](#13-user-stories-summary)

### Part B -- Contracts

14. [Required schema changes](#14-required-schema-changes)
15. [Data pipeline inventory](#15-data-pipeline-inventory)
16. [Migration vs operational table classification](#16-migration-vs-operational-table-classification)
17. [Audit requirements](#17-audit-requirements)
18. [What we need from Steve Goldberg](#18-what-we-need-from-steve-goldberg)
19. [What we need from the historical-pipeline maintainer](#19-what-we-need-from-the-historical-pipeline-maintainer)
20. [Design decisions affected](#20-design-decisions-affected)

### Part C -- Go-live

21. [Go-live blocker index](#21-go-live-blocker-index)
22. [Phasing](#22-phasing)
23. [Operational states](#23-operational-states)
24. [Validation gates](#24-validation-gates)
25. [Data quality from persons.csv analysis](#25-data-quality-from-personcsv-analysis)
26. [Rollback posture](#26-rollback-posture)
27. [Open issues deferred to test load](#27-open-issues-deferred-to-test-load)
28. [Operational readiness for go-live](#28-operational-readiness-for-go-live)
29. [QC subsystem retirement (go-live gate)](#29-qc-subsystem-retirement-go-live-gate)

---

## Part A -- Design

## 1. Executive summary

This plan covers everything required to reach production go-live for the new footbag.org platform. Three workstreams run in parallel:

1. **Historical pipeline**: persons, events, results, honors (Hall of Fame, BAP), clubs, club affiliations, and club leadership. Person truth comes from human-curated CSV. Club data comes from mirror extraction scripts that are part of the same pipeline. The pipeline also creates historical person records for ~1,600 club-only members who never competed in events.
2. **Legacy member accounts**: login-bearing accounts from the current live legacy site. Require a one-time legacy-account export from Steve Goldberg and a secure voluntary claim flow.
3. **Operational readiness** (primary maintainer + AWS + GitHub): backup/restore, observability, edge security, IAM scope-down, email deliverability operations, scheduled maintenance jobs, secrets rotation, and the pre-cutover revert checklist. See §28.

The two data sources share the same identity key (`legacy_member_id`) and converge at cutover when historical persons are auto-linked to imported members by email. Go-live completes when all data is reconciled, operational readiness gates are green, and the DNS switch has occurred.

Additionally, the platform introduces a name model, competition history fields, and an auto-link system that connects historical persons to modern member accounts. These are described in detail in sections 3 through 6.

---

## 2. Migration sources

### Historical pipeline

**What it covers:** Historical events, results, persons, honors, clubs, club affiliations, and club leadership. Person truth comes from human-curated CSV. Club data comes from mirror extraction scripts.

**Key invariant:** A historical person may exist without a claimed modern account. Historical data is published regardless of whether the underlying person has ever claimed a legacy account. The `legacy_member_id` on a `historical_persons` row becomes the bridge to a modern account only after a successful claim.

**Remaining work:**
- Integrate club extraction scripts into the pipeline
- Extract ~1,600 club-only members from mirror into `historical_persons`
- Club identity normalization, affiliation inference, leadership inference
- Bootstrap eligibility decisions for go-live club population

The live system needs clubs on day one. The mirror is the best available source of club identity and prior leadership information.

#### Pipeline outputs (required before the legacy-account export)

The historical-data pipeline must produce:

- Normalized legacy club candidates (one row per distinct club identity)
- Inferred person-to-club affiliation rows with confidence scores
- Inferred role classifications: `member`, `contact`, `leader`, `co-leader`
- Linkage from inferred persons to `historical_persons.person_id` where possible
- Preserved `legacy_member_id` when known from the mirror
- Club classification per section 9.1 rules (pre-populate, onboarding-visible, dormant, or junk)
- Bootstrap eligibility decision for pre-populated clubs, based on leader candidate availability (section 2 bootstrap rule)
- Review report including:
  - Per-club classification with which rule(s) matched
  - Clubs with no credible leader candidate
  - Clubs with multiple competing leader candidates
  - People with multiple apparent current-club indications (store all affiliations with `resolution_status = 'pending'`; the member resolves at claim time by choosing one current club and marking others as former)
  - Unmapped club aliases or duplicate club identities
  - Recommended split per classification rules (section 9.1): pre-populate / onboarding-visible / dormant / junk

#### Bootstrap rule

A pre-populated club (per section 9.1 rules R1-R4) receives bootstrap leader rows when all of the following hold:

- At least one leader candidate with `club_bootstrap_leaders.confidence_score >= 0.70`
- That candidate maps to a `legacy_member_id` that will exist in the imported member rows (verified provisionally from `legacy_member_id` presence; confirmed at test load when the legacy-account export arrives)

Leader candidate confidence is distinct from club classification. It measures how certain we are that a specific person is the right leader for this club. The historical-data pipeline assigns this score based on:

- Listed as contact on club page with matching `historical_persons` row and `legacy_member_id`: high (>= 0.70)
- Listed as contact but no `historical_persons` match: medium (0.40 to 0.69)
- Inferred from member roster (most active or most events) but not listed as contact: lower (< 0.40)

The 0.70 threshold is tunable at test load via validation gate G8.

Pre-populated clubs that do not meet the leader requirement are pre-populated without a provisional leader (first member with membership Tier 1+ to confirm affiliation is offered co-leadership; see leadership activation path 2 below).

Clubs that fail the pre-populate rules (R1-R4) are classified as onboarding-visible, dormant, or junk per section 9.1.

#### Leadership model

Bootstrap-eligible clubs are created with:

- A live `clubs` row
- One or more `club_bootstrap_leaders` rows representing leaders

`club_bootstrap_leaders` rows are leaders (and co-leaders). They can manage the club once they register.

**Leadership activation paths:**

1. **Bootstrap leader registers and claims**: the claim flow presents the leadership for confirmation. On confirmation, the system promotes the bootstrap row to a live `club_leaders` row, and the leader can manage the club.
2. **First affiliated member accepts leadership**: if no bootstrap leader has yet registered, the first member who registers and confirms affiliation with that club is offered leadership during onboarding (if membership Tier 1+). On acceptance, the member is added as a co-leader. Any existing bootstrap leader assignments remain provisional until those candidates register and claim. Clubs may have multiple leaders.
3. **Admin resolution**: admin can supersede bootstrap assignments and appoint any registered member as leader through the standard `club_leaders` workflow.

---

### Legacy member import

**What it covers:** All legacy registered member accounts from the live legacy site.

**Source:** One-time export from Steve Goldberg, used twice: first as a test load, then as the final production import after write freeze.

#### Imported-row model

Each imported legacy member is a **row in `legacy_members`** (see DATA_MODEL §4.14b and DD §2.4). `legacy_members` is a distinct entity from `members`: it does not grant authentication, does not appear on any current-member surface, and is never deleted. It persists as the permanent archival record of a legacy account even after a current member claims it (claim sets `claimed_by_member_id` + `claimed_at`; the row itself is not mutated further).

Fields present on imported rows:

| Field | Notes |
|---|---|
| `legacy_member_id` | Primary key; the old-site user-account id |
| `legacy_user_id` | Legacy username; migration metadata only |
| `legacy_email` | Migration metadata only; used to deliver the one-time claim link. Never a login credential |
| `real_name` | Best available name from export; required (use display_name as fallback). See section 3 for name model notes on imports |
| `display_name` | From export |
| `display_name_normalized` | Derived |
| `city`, `region`, `country` | From export; nullable |
| `bio` | From export if available |
| `birth_date` | From export if available |
| `street_address`, `postal_code` | From export if available |
| `ifpa_join_date` | From export if available |
| `first_competition_year` | Pre-populated from `historical_persons.first_year` via COALESCE at import if a match exists |
| `is_hof` | From export; carries to the claiming member at claim time per §8 OR-merge |
| `is_bap` | From export; carries to the claiming member at claim time per §8 OR-merge |
| `legacy_is_admin` | Old-site admin flag; retained for audit only, never grants live admin |
| `import_source` | `'mirror'` or `'legacy_site_data'` -- indicates origin batch |
| `imported_at` | Timestamp of import |
| `legacy_banned` | Conditional on test-load evidence (column not yet in schema) |

Fields explicitly absent from `legacy_members`:

- Login credentials of any kind (no login_email / password_hash / email_verified_at)
- Any live authentication state
- Any mailing list subscriptions
- Any club-governance permissions
- Any current-platform flags (is_admin, is_board, is_deceased, searchable, tier state, Stripe identity, avatar)

The three-table design (DD §2.4) means imported rows never occupy the `members` table; there is no pre-credential placeholder state on `members`. All the above "current-platform" fields belong to the claiming `members` row that is created at registration time and linked to `legacy_members` at claim time via `members.legacy_member_id`.

**Name model note for imports:** The surname constraint (display name must share surname with real_name) applies only to new registrations and profile edits. `legacy_members` rows are exempt because legacy data may contain names that do not conform to the new model. Use "legacy member" (or "imported legacy account") terminology consistently when referring to these rows; the older "imported placeholder" / "pre-credential placeholder" phrasing refers to the superseded two-table design and should not be used in new writing.

#### Tier handling at claim

Under the three-table design, `member_tier_grants` is a ledger keyed by `member_id` — so no ledger row exists for an unclaimed legacy account (there is no member yet). The mapping below is applied at **claim time**: when M_Claim_Legacy_Account completes for a given `legacy_members` row, the claim transaction writes one `member_tier_grants` row with `reason_code = 'migration.legacy_import'` using the legacy tier state captured on `legacy_members`. Legacy tier state fields (`legacy_tier_state`, `legacy_tier_expires_at`, `legacy_tier_ever_paid_tier2`) are a deferred schema extension gated on test-load validation of the dump — if the extension does not land, tier mapping falls back to the honors-only rules (HoF/BAP give `tier2_lifetime`; absence of legacy tier info gives `tier0`).

Tier mapping rules:

| Legacy state | New effective tier |
|---|---|
| No valid legacy tier | `tier0` |
| Tier 1 annual, active | `tier1_annual` with expiry |
| Tier 1 annual, expired | `tier0` |
| Tier 1 lifetime | `tier1_lifetime` |
| Tier 2 annual, active | `tier2_annual` with expiry + `tier1_lifetime` fallback |
| Tier 2 annual, expired (ever held Tier 2 paid status) | `tier1_lifetime` |
| Tier 2 lifetime | `tier2_lifetime` |
| HoF member | minimum `tier2_lifetime` |
| BAP member | minimum `tier2_lifetime` |

The Tier 2 annual expired mapping requires the export to include enough membership history to determine "ever held Tier 2 paid status." This is a test-load validation gate.

---

## 3. Name model

Two registration fields:

- **Full legal name** (`real_name`): required. Validation: two words minimum, no digits, no capitalization policing (caps normalized on save).
- **Display name** (`display_name`): optional, defaults to `real_name` if not provided.

**Surname constraint:** Display name must share a surname with real_name. Surname extraction uses suffix stripping (Jr, Sr, II, III, IV). This constraint applies to new registrations and profile edits only. Imported placeholders are exempt.

**Semantic asymmetry:** For new registrations, `real_name` is the legal name supplied by the member. For imported placeholders, `real_name` is the best-available name from the legacy export, which may be a display name, a username, or something else entirely. The field name is the same but the quality and provenance differ.

**Slug lifecycle:** `display_name` and the derived slug are permanent post-registration.

---

## 4. Competition history fields

Two fields on `members`:

- `first_competition_year` (INTEGER, nullable): editable on profile edit. Pre-populated from `historical_persons.first_year` during claim (COALESCE; member value wins if already set). Shown as "Competing since {year}" on profile. Leave blank to hide (opt-out by clearing).
- `show_competitive_results` (INTEGER, default 1): toggle controlling whether results show on public profile. Own profile always shows results to the owner regardless of toggle state.

**Caveat text on results section:** "Published event results only. Historical records may be incomplete."

**Onboarding prompt:** During registration/onboarding, ask the member to confirm their first competition year. (Deferred to onboarding flow implementation.)

---

## 5. Identity and person links

- A single `personHref()` helper generates all person links. If the person has a linked member account (via `members.historical_person_id` FK per DD §2.4 rule 3), the link points to `/members/:slug`. Otherwise, it points to `/history/:personId`. This is implemented at the service contract level; slug resolution uses the FK directly per DD §2.4.
- When a member has a linked historical person whose name differs from the member's display name, the historical name is shown on the member profile.
- **Account deletion reversion:** When a member's PII is purged, `members.historical_person_id` and `members.legacy_member_id` are both cleared, and the corresponding `legacy_members.claimed_by_member_id` is cleared too. Person links that were pointing to `/members/:slug` revert to `/history/:personId`. This is reflected in DD §2.4 rule 5 and the M_Delete_Account user story.

---

## 6. Auto-link: matching legacy_members, historical_persons, and members

Auto-link has two goals under the three-table design (DD §2.4):

1. **Provenance link** — associate each `historical_persons` row with its corresponding `legacy_members` row when the mirror named the legacy account, by setting `historical_persons.legacy_member_id`. This is a data-pipeline step owned by the historical-pipeline track.
2. **Claim link** — at registration or cutover, associate a current `members` row with a `legacy_members` row (setting `members.legacy_member_id` + `legacy_members.claimed_by_member_id`) and, if the claimed legacy account has a provenance link to an HP, additionally set `members.historical_person_id`.

Both uses email as the primary identity anchor. Email lives on `legacy_members.legacy_email` and on the registering member's login email; `historical_persons` does not carry email.

### Tier system

| Tier | Condition | Action |
|---|---|---|
| Tier 1 | Email match + exact name match | Auto-link, no review |
| Tier 2 | Email match + known variant name match | Auto-link, audit-logged |
| Tier 3 | Email match + name mismatch | Admin review (migration-time only) |

**Email match required:** Email is the mandatory identity anchor for all tiers. No auto-link occurs without an email match.

### Known name variants

Known name variants are stored in a **DB table** (not CSV), seeded from mined data (~290 pairs). Variant categories:

- Accent variations (~26 pairs)
- Prefix variations (~88 pairs)
- Typo corrections (~139 pairs)
- Diminutives (~40 pairs)

The Jody/Jolene Welch class (same person, completely different first name) is only catchable by admin review at migration time, or by user confirmation at registration time.

### Batch auto-link at cutover

At cutover, a batch auto-link pass runs across all `legacy_members` rows:
- Tier 1 and Tier 2: auto-linked immediately to matching `historical_persons` (via shared `legacy_member_id`) and to any pre-cutover registered members (via email match), audit-logged.
- Tier 3: flagged for admin review. These are legacy accounts in the import data whose `legacy_email` matches a registered member's login email but whose name does not. Because the underlying real-world person may not have registered yet, admins resolve these cases (see A_Review_Auto_Link_Matches in USER_STORIES).

### Registration-time auto-link

At first registration, when a member's email matches a `legacy_members.legacy_email` (email is the identity anchor; `historical_persons` does not carry email), the system prompts the user inline:
- **All tiers**: the user is always asked to confirm the link ("We found a legacy account matching your email, is this you?").
- **High confidence (Tier 1/2)**: default answer is yes (pre-checked, confirm to proceed).
- **Low confidence (Tier 3)**: default answer is no (user must actively opt in).
- On confirm, the registration flow writes `members.legacy_member_id` to the matched `legacy_members.legacy_member_id` and sets `legacy_members.claimed_by_member_id` + `claimed_at` atomically. If the claimed `legacy_members` row has a matching `historical_persons.legacy_member_id`, `members.historical_person_id` is also set in the same transaction.
- Decision is audit-logged. No admin queue is involved at registration time; the user is the authority on their own identity.

---

## 7. Self-serve legacy claim flow

The claim flow is account-bound and mailbox-verified.

### Prerequisites

- Member must have a live, authenticated modern account
- The `legacy_members` row must exist and be eligible for claim (unclaimed: `claimed_by_member_id IS NULL`)
- The `legacy_members` row must have a usable `legacy_email`

### Flow

1. Member logs into their modern account.
2. Member visits **Link Legacy Account** in profile settings.
3. Member enters one identifier: legacy email address, legacy username, or legacy member ID.
4. System classifies the identifier type and looks up the matching `legacy_members` row.
5. If exactly one eligible row is found, the system creates an `account_claim` token:
   - `member_id` = requesting active modern account
   - target = the matched `legacy_members.legacy_member_id`. Token schema: `account_tokens.target_legacy_member_id` FKs to `legacy_members(legacy_member_id)` ON DELETE NO ACTION.
   - Token is single-use, time-limited (default 24 hours, configurable)
6. System emails the one-time claim link to `legacy_email`.
7. Member opens the link while logged into the same modern account.
8. System validates:
   - Token exists, is unconsumed, is unexpired
   - `token_type = 'account_claim'`
   - Authenticated session matches token `member_id`
   - Target `legacy_members` row still exists and is still unclaimed
9. **Name reconciliation step:**
   - Last-name mismatch between active account and `legacy_members` row: **blocks** (member must update their name or contact admin)
   - First-name mismatch: **warns** but allows proceed
   - Definitions: "last name" is the final whitespace-separated token of `real_name` after NFKC normalization and suffix stripping (Jr, Sr, II, III, IV), unless the legacy-account export provides a structured surname field (in which case that field is authoritative). "First name" is the first token after the same normalization.
10. System presents final confirmation naming the active account that will receive the legacy identity.
11. If club-affiliation suggestions or leadership assignments exist for the claimed identity, member is prompted to review them (see section 9).
12. Member confirms.
13. Merge transaction runs atomically (see section 8).
14. The `legacy_members` row is MARKED CLAIMED — `claimed_by_member_id` set to the requesting member id, `claimed_at` set to now. The row is NOT deleted; it persists as the permanent archival record. Consumed `account_claim` tokens are marked consumed in the same transaction.

### Direct historical-person claim (scenarios D and E)

The legacy-account flow above covers scenarios where the registrant had an old-site user account (`legacy_members`). Two further scenarios exist:

- **Scenario D:** registrant was a competitor but never had an old-site user account. `historical_persons` row exists with no `legacy_member_id` back-link. No email anchor is available.
- **Scenario E:** registrant had both an old-site account and a competitive record, but the historical pipeline did not link them (`historical_persons.legacy_member_id IS NULL` or points at a different row). The legacy-account flow claims only the account; the competitive record stays orphaned.

A parallel direct-HP claim flow handles both cases. Entry point is the historical detail page: `GET /history/:personId`. When an authenticated viewer's `real_name` surname matches the HP's `person_name` surname and the HP is unclaimed, the page surfaces a "Claim this identity" CTA. The confirmation page (`GET /history/:personId/claim`) shows the record's country and honor status plus a first-name warning when the member's first name is a variant (Dave vs David, etc.). On `POST /history/:personId/claim/confirm`:

- Surname reconciliation runs again server-side (mismatch blocks even if the form was bypassed).
- If the HP carries a `legacy_member_id` back-link (scenario E) and that legacy row is unclaimed, the claim transitively marks the `legacy_members` row claimed and runs the legacy-field merge, so the member ends up linked to both records. If the legacy row is already claimed by someone else, the HP claim is rejected rather than leaving inconsistent state.
- `members.historical_person_id` is set. HP identity fields are carried forward per the merge rules in §8 ("historical_persons-sourced fields").

Anti-abuse: the same surname rule as §7 gates direct claims. The partial UNIQUE index on `members.historical_person_id` prevents double-claim. A member can claim at most one HP; attempting to claim a second returns a clean 422.

### Non-revealing messaging

User-visible messages must never reveal whether the submitted identifier:

- Matched no row
- Matched multiple rows
- Matched a blocked row
- Matched a row without self-serve eligibility

Recommended message: "If an eligible legacy record was found, a claim email will be sent."

### Rate limiting

Claim initiation and resend must be rate-limited per requesting account, per target `legacy_members` row, and per source IP/session. This prevents abuse of legacy mailboxes and limits side-channel enumeration.

### Self-serve ineligibility

A `legacy_members` row is ineligible for self-serve claim when:

- No usable `legacy_email` exists
- Duplicate `legacy_members` rows matched the identifier (test-load uniqueness failure on the partial UNIQUE indexes for `legacy_email` / `legacy_user_id`)
- Already claimed (`claimed_by_member_id IS NOT NULL`)
- `legacy_banned = 1` (if the test load validates this field as trustworthy)
- An admin has flagged the row as review-only

Ineligible cases are directed to manual admin recovery.

---

## 8. Merge rules

The active modern account always survives. The `legacy_members` row is MARKED CLAIMED (`claimed_by_member_id` + `claimed_at` set) and persists as the permanent archival record — it is NOT deleted. Merge copies editable fields from `legacy_members` to the claiming `members` row so the member has their own copy to edit; the `legacy_members` row itself is not mutated beyond the two claim-state columns.

| Field / category | Merge rule |
|---|---|
| `legacy_member_id` | Written to `members.legacy_member_id` (FK to `legacy_members.legacy_member_id`) |
| `legacy_user_id` | Copied to `members.legacy_user_id` as migration metadata; `legacy_members` retains its copy |
| `legacy_email` | Copied to `members.legacy_email` as legacy metadata; never a login credential; `legacy_members` retains its copy |
| Login and auth fields | Active account always wins; nothing copied from `legacy_members` (which has no credentials) |
| `display_name`, `real_name` | Active account always wins |
| `phone`, `whatsapp` | Active account always wins |
| `bio` | Import fills `members.bio` only if active `bio` is empty string |
| `birth_date`, `street_address`, `postal_code` | Import fills `members.*` only if active value is NULL |
| `city`, `region`, `country` | Import fills `members.*` only if active value is NULL or empty |
| `ifpa_join_date` | Copied to `members.ifpa_join_date` if present and active value absent |
| `first_competition_year` | COALESCE: member value wins; import value fills `members.first_competition_year` if member is NULL |
| `is_hof`, `is_bap` | OR semantics — `members.is_hof` / `members.is_bap` set to 1 if `legacy_members` has the flag |
| `historical_person_id` | Set to the HP's `person_id` whenever the claim resolves an HP: (a) legacy-account claim where `legacy_members.legacy_member_id` matches a `historical_persons.legacy_member_id` back-link, or (b) direct HP claim (scenarios D/E). Partial UNIQUE index enforces one live member per HP. |
| `historical_persons`-sourced fields | Whenever `members.historical_person_id` is being set, the same transaction also runs the HP merge: `country` fill-if-empty from `historical_persons.country`; `is_hof` / `is_bap` OR semantics from `hof_member` / `bap_member`; `hof_inducted_year` fill-if-empty from `hof_induction_year`; `first_competition_year` COALESCE from `first_year`. This ensures honors and country propagate onto the member row from whichever archival table carries the authoritative value. |
| `announce_opt_in` | Carry forward only if the validated export contains this field and its semantics are confirmed; unclaimed `legacy_members` rows are never treated as active mail recipients |
| Legacy admin metadata (`legacy_is_admin`) | Copied to `members.legacy_is_admin` as audit/history context only; never auto-promotes live admin role |
| Tier | Write new `member_tier_grants` row with `reason_code = 'migration.legacy_claim_reconcile'` only if imported effective tier exceeds current effective tier. Tier mapping uses legacy tier state fields on `legacy_members` (deferred schema extension, gated on test-load validation — see §2 Tier handling at claim). |
| Confirmed club affiliations | Write/update `member_club_affiliations` |
| Confirmed bootstrap leadership | May promote to `club_leaders` if safe; otherwise remains provisional |
| Discarded conflicting imported values | Preserved in audit metadata |

After merge, `legacy_email` may survive on the active account as legacy metadata but is never a login identity.

---

## 9. Club bootstrap and onboarding

### 9.1 Club classification rules

Every club extracted from the mirror is classified into one of four categories based on rules applied to three data sources. The rules are deterministic: no weighted scores or tunable thresholds. Classification determines whether the club exists in the live `clubs` table at go-live, is shown as a suggestion during registration, is searchable but not suggested, or is excluded entirely.

#### Source data

All signals are derived from data that already exists in the mirror or the database. No external API calls or manual lookups are required.

**Source 1: Mirror club HTML** (`mirror_footbag_org/www.footbag.org/clubs/show/{id}/index.html`)

Each club detail page in the mirror contains structured HTML elements that the extraction scripts parse:

- `div#MainModified`: contains two CMS timestamps in the format `Created Sun Jan 15 10:16:52 2012; last update Sun Jan 15 10:16:52 2012.` These are the dates the club page was created and last edited on footbag.org by a club contact or admin. Extracted into `clubs.csv` as the `created` and `last_updated` columns.
- `div#ClubsWelcome`: free-text club description.
- `div.clubsURL > a[href]`: external website URL, if present.
- `div.clubsContacts`: contact person(s), each with a `members/profile/{id}` link identifying the contact's legacy member ID.
- Member count: enumerated on the corresponding roster page (`ClubID_{id}/showmembers/index.html`).

The mirror's `clubs/` directory contains 458 club subdirectories; 311 parse as valid clubs (with name and country), and 147 are defunct or empty pages. The 311 valid clubs become rows in `legacy_data/seed/clubs.csv` with columns `legacy_club_key`, `name`, `city`, `region`, `country`, `contact_email`, `external_url`, `description`, `created`, `last_updated`.

Of the 311 valid clubs, all 311 have `last_updated` timestamps, 309 have contact emails, 247 have descriptions, 97 have external URLs, and the median member count is 3.

**Source 2: Event archive** (`mirror_footbag_org/www.footbag.org/events/show/*/index.html`)

Event detail pages contain a `div.eventsHostClub` element with a link to the hosting club's `clubs/show/{id}` page. This establishes a direct, parseable relationship between events and clubs. Of the 311 clubs, 116 have hosted at least one event (1,215 total host references across the archive). The event date (from `div.eventsDate`) determines when the most recent hosted event occurred.

**Source 3: Historical persons database** (`historical_persons` joined via `legacy_person_club_affiliations`)

The `legacy_person_club_affiliations` table links club candidates to historical persons. Each historical person has a `last_year` field (the most recent year they appeared in event results). The club's listed contact person is identified by matching the contact's `members/profile/{id}` link to `historical_persons.legacy_member_id`. "Contact competed 2020 or later" means the specific person listed as the club's contact on the legacy site has a `historical_persons.last_year >= 2020`. This is distinct from any affiliated member competing recently; the contact is the person responsible for the club.

Of the 311 clubs, 147 have at least one affiliated historical person, and 54 have a listed contact who competed in 2020 or later.

#### Classification rules

Rules are evaluated in order. A club is assigned to the first category whose rules it satisfies.

**Pre-populate** (live `clubs` table at go-live, 63 clubs):

A club is pre-populated if ANY of the following rules is true:

| Rule | Condition | What it proves |
|---|---|---|
| R1 | Hosted an event in 2020 or later | Recent organizational activity |
| R2 | Page updated 2020 or later AND ever hosted an event | Maintained page with proven hosting history |
| R3 | Page updated 2020 or later AND club's listed contact competed 2020 or later | Maintained page with active, reachable leader |
| R4 | Club's listed contact competed 2020 or later AND ever hosted an event | Active leader with proven hosting history |

If the club also has a high-confidence leader candidate (`club_bootstrap_leaders.confidence_score >= 0.70`), it gets bootstrap leader rows. Otherwise it is pre-populated without a provisional leader (first member with membership Tier 1+ to confirm affiliation is offered co-leadership; see leadership activation path 2 in section 2).

**Onboarding-visible** (in `legacy_club_candidates`, shown as suggestions during registration, 121 clubs):

Fails all pre-populate rules but ANY of the following is true:

| Rule | Condition | What it proves |
|---|---|---|
| R5 | Club's listed contact competed 2020 or later | Active leader exists; club resolves when they register |
| R6 | Ever hosted an event | Proven organizational history |
| R7 | Page edited 2016 or later AND after creation date | Someone maintained the club in the last 10 years |
| R8 | Has affiliated member who competed 2020 or later | Recently active person connected to this club |
| R9 | Club created 2022 or later | Too new to judge by historical signals |
| R10 | 10 or more members OR 3 or more known historical players | Significant community investment |

**Dormant** (in `legacy_club_candidates`, searchable by name during onboarding but not suggested proactively, 96 clubs):

Fails all pre-populate and onboarding-visible rules. Has a description (so not junk). These are real clubs that went quiet: someone wrote about them, but they have no hosting history, no recent edits, no active connections.

**Junk** (excluded, not imported, 31 clubs):

ALL of the following are true:

- Never edited after creation (created date equals last_updated date)
- Never hosted an event
- No affiliated members who competed 2020 or later
- Club's listed contact did not compete 2020 or later
- Created before 2022
- No description (empty `div#ClubsWelcome`)

These are clubs where someone clicked "create club" on the legacy site and never invested any effort. They are not imported into `legacy_club_candidates`.

#### Storage

Pre-populated clubs are created as live `clubs` rows at go-live. All other non-junk clubs remain in `legacy_club_candidates`. When a member confirms affiliation with an onboarding-visible or dormant club during registration, a new `clubs` row is created on demand using seed data from `clubs.csv` (name, city, region, country, contact_email, external_url, description). The `legacy_club_candidates` table must not be dropped until all onboarding-visible and dormant clubs are either created or abandoned.

#### Pipeline ordering

The active-players and contact-competed signals both query `historical_persons`. The club-only member extraction (section 9.2) must complete before classification runs, otherwise these signals will be artificially deflated for clubs whose members never competed in events.

Required order within the historical-data pipeline:
1. Extract ~1,600 club-only members into `historical_persons` (section 9.2)
2. Classify clubs per the rules above
3. Set `bootstrap_eligible` and populate `club_bootstrap_leaders` for pre-populated clubs

### 9.2 Expanding historical_persons for club members

The historical_persons table currently contains ~4,861 persons drawn from event results. Approximately 1,600 additional people in the mirror appear only as club members (never competed in events). These must be extracted and added to historical_persons to support club affiliation linking at claim time.

### 9.3 Club onboarding flow during registration

Registration is the primary mechanism for resolving club data. Every registrant goes through a three-stage club flow after identity resolution (sections 6-7).

#### Stage 1: Direct matches

The system checks if the registrant matches any club contact or affiliated member in the mirror data (via club contact member IDs and `legacy_person_club_affiliations`).

**If the person is listed as contact of a club**, show: "We found you listed as the contact for [Club Name] in [City, Country]."

Choices:

1. **"This is my club and it's still active"** -- person affiliates with the club. Follow-up questions: "Is the contact info still correct?", "Would you like to update the description?", "Is the website still active?" For pre-populated clubs with a bootstrap row, the bootstrap row is promoted to a live `club_leaders` row. For pre-populated clubs without a bootstrap row, leadership is offered (membership Tier 1+). For onboarding-visible or dormant clubs, the club is created on demand from seed data and the person becomes leader.
2. **"I was involved but the club is no longer active"** -- mark as former affiliation, flag club as reported-inactive. Follow-up: "When did it become inactive?" (optional), "Do you know if any other clubs are active in [region]?"
3. **"This club still exists but I'm no longer involved"** -- mark as former affiliation, club stays as-is.
4. **"I don't recognize this club"** -- reject affiliation, flag club for admin review. This is a strong junk signal when the listed contact does not recognize the club.

**If the person is an affiliated member (not contact)**, show: "Are you affiliated with [Club Name] in [City, Country]?"

Same four choices. Differences: for choice 1, leadership is offered only if no active leader exists AND person is membership Tier 1+ (added as co-leader, does not supersede existing leaders). For choice 4, the signal is weaker than a contact rejection (members may have forgotten a club they briefly joined).

#### Stage 2: Regional suggestions

After direct matches are resolved, the system checks for clubs near the registrant's location (same country/region).

Show: "There are footbag clubs near you in [Region/Country]:" Pre-populated and onboarding-visible clubs are shown, prioritized by proximity. Dormant clubs are not shown. Junk clubs are never shown.

Choices per club:

1. **"I'm part of this club"** -- same affiliation flow as Stage 1 choice 1
2. **"I know this club but I'm not a member"** -- no affiliation, positive existence signal for the club
3. **"I've never heard of this club"** -- negative signal (especially strong if person is in the same city)
4. **Skip** -- no action

#### Stage 3: No clubs nearby

If no direct matches and no regional suggestions (or person skipped all):

Show: "Would you like to start a club in [City]?" or skip.

#### Signals collected from registration

Every registration interaction produces data that feeds back into club quality:

| Signal | Source | Effect |
|---|---|---|
| Contact confirms club active | Stage 1, choice 1 | Club confirmed active. If not pre-populated, create on demand. |
| Contact reports club inactive | Stage 1, choice 2 | Flag club as reported-inactive. Admin can demote or archive. |
| Contact does not recognize club | Stage 1, choice 4 | Strong junk signal. Flag for admin review. |
| Member confirms affiliation | Stage 1 or 2, choice 1 | Positive signal. Club is real. |
| Member rejects affiliation | Stage 1, choice 4 | Weak negative signal (one data point). |
| Regional: "I know this club" | Stage 2, choice 2 | Positive existence confirmation. |
| Regional: "Never heard of it" | Stage 2, choice 3 | Negative signal, especially if same city. |
| Multiple rejections on same club | Accumulated | Escalate to admin review. |
| Updated contact info, description, or URL | Stage 1 follow-up | Direct data improvement on the club record. |

#### Constraints

- At most one current club affiliation per member. Confirming a new one converts any existing current to former in the same transaction.
- Clubs may have multiple leaders.
- Leadership is only offered to membership Tier 1+.
- Onboarding-visible and dormant clubs are created on demand when a person confirms affiliation. The `clubs` row is populated from `clubs.csv` seed data.
- Junk clubs are never shown in any stage.
- Dormant clubs are not shown in Stage 2 regional suggestions but are findable if the person searches by name.

---

## 10. Registration as the data-cleanup funnel

Registration is the primary mechanism for cleaning up legacy identity data. Every registrant, whether new or returning from the legacy site, goes through:

1. **Legacy-link check:** Does the registrant's email match an imported placeholder? If so, prompt to link (auto-link for Tier 1/2; claim flow for others).
2. **Club onboarding flow:** Three-stage club resolution (direct matches, regional suggestions, start a club). See section 9.3 for the complete flow, choices, and feedback signals collected.

This replaces the narrower `M_Review_Legacy_Club_Data_During_Claim` user story with a broader onboarding flow that applies to both legacy and new members. New members without any legacy match still see regional club suggestions and the option to start a club.

---

## 11. Security model summary

- Legacy passwords are never imported, stored, or accepted
- `legacy_email` is migration metadata, not a login credential
- Mailbox control is the proof step for self-serve claim regardless of which identifier type was submitted
- Imported rows cannot log in, cannot be searched, cannot receive member broadcasts
- Claim tokens are account-bound: consuming a token while authenticated as a different account fails
- Rate limiting applies to claim initiation and resend
- The non-revealing messaging rule applies everywhere in the claim flow
- Bootstrap leadership confers zero live permissions until confirmed on a real modern account
- Auto-link requires email match as identity anchor; no auto-link without email match
- Name validation is loosened for imports (two words + no digits only); surname constraint scoped to new registrations and edits

---

## 12. Admin flows

### Manual claim recovery (A_Manual_Legacy_Claim_Recovery)

When self-serve claim is unavailable, admins can:

- Locate imported rows by legacy identifier
- See why self-serve is unavailable
- Correct `legacy_email` to a reachable mailbox (enabling re-attempt of self-serve)
- Perform a controlled manual merge with a required reason and verification note

Manual recovery does not require second-admin approval. It does require full audit metadata.

Manual recovery never auto-promotes legacy `is_admin` metadata to a live admin role.

### Auto-link Tier 3 review (A_Review_Auto_Link_Matches)

Migration-time admin review of Tier 3 cases from the legacy data import (email match, name mismatch). These are existing IFPA members who have not yet registered, so the system cannot ask them directly.

Admins can:

- Review Tier 3 auto-link cases: each case shows the historical person name, the imported placeholder name, the matched email, and relevant context
- Confirm or reject the proposed link
- All actions are audit-logged

Note: At registration time, Tier 3 cases are handled by inline user prompt (no admin involvement).

---

## 13. User stories summary

| ID | Actor | Summary |
|---|---|---|
| M_Claim_Legacy_Account | Logged-in member | Link a legacy footbag.org member record to current account via identifier lookup and mailbox verification |
| M_Review_Legacy_Club_Data_During_Claim | Member in claim flow | Review mirror-derived club suggestions and leadership assignments before merge confirmation (subsumed by broader onboarding flow) |
| M_Edit_Profile | Member | Edit profile including first_competition_year and show_competitive_results |
| M_View_Profile | Member / public | View profile with competition history, historical name, caveat text |
| M_Delete_Account | Member | Delete account; person links revert from /members/ to /history/ |
| A_Manual_Legacy_Claim_Recovery | Admin | Help a member complete legacy claim when self-serve is unavailable |
| A_Review_Auto_Link_Matches | Admin | Review and resolve Tier 3 auto-link cases (email match, name mismatch) |

---

## Part B -- Contracts

## 14. Required schema changes

### 14.1 Credential-state invariant: two-way
Two-way CHECK on `members`: live account or purged row. Imported legacy accounts live in `legacy_members` (§2 Legacy member import), not as placeholder rows in `members`.

### 14.2 Location field nullability
`city` and `country` are nullable. `region` was already nullable.

### 14.3 Remove tier cache columns from `members`
`tier_status`, `tier_expires_at`, `fallback_tier_status` removed from `members`. All current-tier reads derive from `member_tier_grants` via `member_tier_current`.

### 14.4 New migration fields on `members`
Added: `legacy_user_id`, `legacy_email`, `ifpa_join_date`, `birth_date`, `street_address`, `postal_code`, `legacy_is_admin`.

### 14.5 Conditional: `legacy_banned` (added only if §24 gate G3 is satisfied)

Conditional on test-load evidence. If the legacy-account export contains a trustworthy banned/inactive field:

```sql
legacy_banned INTEGER NOT NULL DEFAULT 0 CHECK (legacy_banned IN (0,1)),
```

### 14.6 `legacy_member_id` uniqueness
Partial unique index `ux_members_legacy_id` on `members(legacy_member_id) WHERE legacy_member_id IS NOT NULL`.

### 14.7 Provisional uniqueness for `legacy_email` and `legacy_user_id`
Partial unique indexes. If the test load disproves either uniqueness assumption, replace with non-unique lookup plus ambiguity handling.

### 14.8 `members_searchable` view
Includes `email_verified_at IS NOT NULL` filter.

### 14.9 `account_tokens`: `account_claim` type and target binding
`token_type` CHECK includes `'account_claim'`. `target_legacy_member_id` with `ON DELETE NO ACTION`.

### 14.10 `member_club_affiliations`
Permanent operational table with one-current-club invariant.

### 14.11 `legacy_club_candidates`
Migration-only staging table.

### 14.12 `legacy_person_club_affiliations`
Migration-only staging table with dual partial unique indexes.

### 14.13 `club_bootstrap_leaders`
Operational table with `imported_member_id ON DELETE SET NULL`.

### 14.14 `first_competition_year` and `show_competitive_results`
On `members` table.

### 14.16 Known name variants table

New table `name_variants` stores name-equivalence pairs that support auto-link matching (§6) and ongoing claim/registration-time prompts. Seeded at State 1 from mirror-mined pairs (~290); remains live post-cutover so admins and members may record further equivalences as new name collisions surface.

Schema authority: `database/schema.sql`. Contract:

- Two normalized columns (`canonical_normalized`, `variant_normalized`), composite primary key.
- `source` TEXT with CHECK in (`mirror_mined`, `admin_added`, `member_submitted`).
- `created_at` TEXT default `datetime('now')`.
- CHECK self-pairs rejected; both values non-empty.
- Secondary index on `variant_normalized` to support bidirectional lookup.

Relation semantics: symmetric. Storing `('robert', 'bob')` is equivalent to storing `('bob', 'robert')`; lookups must check both columns. Do not insert both directions.

Normalization is application-side (NFKC + lowercase + whitespace-collapse + trim) before any insert or lookup; the table stores only normalized forms.

Not prefixed `legacy_*` because the table is a permanent name-matching utility, not a migration-only staging artifact. Compare with `legacy_club_candidates` (migration-scope, resolves into `clubs` at State 2). Name variants have no resolution step; the pairs themselves are the permanent artifact.

---

## 15. Data pipeline inventory

### Curated CSVs (human-curated, source of truth)

Location: `legacy_data/event_results/canonical_input/`

- `persons.csv`: historical persons with IFPA IDs, honors, stats
- `events.csv`, `events_normalized.csv`: historical events
- `event_results.csv`: result entries
- `event_result_participants.csv`: participant-to-result mappings
- `event_disciplines.csv`: discipline breakdowns

`persons.csv` is in git for now. Will be removed from git later.

### Extracted CSVs (from mirror, treated as source of truth)

Location: `legacy_data/seed/`

- `clubs.csv`: club identities extracted from mirror
- `club_members.csv`: club membership associations from mirror (~2,400 associations)

### Generated CSVs (pipeline output, regenerable)

Location: `legacy_data/event_results/seed/mvfp_full/`

- `seed_events.csv`, `seed_event_disciplines.csv`, `seed_event_results.csv`, `seed_event_result_participants.csv`, `seed_persons.csv`

### Pipeline scripts

**Event results pipeline** (`legacy_data/event_results/scripts/`):

- `06_build_mvfp_seed.py`: build MVFP subset seed
- `07_build_mvfp_seed_full.py`: build full seed from canonical inputs
- `08_load_mvfp_seed_full_to_sqlite.py`: load full seed into SQLite
- `09_patch_missing_person_ids.py`: patch missing person IDs in result participants
- `verify_mvfp_seed.py`: seed verification

**Club and member scripts** (`legacy_data/scripts/`):

- `extract_clubs.py`, `load_clubs_seed.py`: club extraction and loading
- `extract_club_members.py`, `load_club_members_seed.py`: club member extraction and loading
- `seed_members.py`: dev seed account creation
- `generate_world_map_svg.py`: SVG map generation

**Note:** Unchecked-in extraction code exists for the mirror member pipeline. Do not touch pipeline scripts this sprint.

---

## 16. Migration vs operational table classification

| Table | Category | May be dropped |
|---|---|---|
| `legacy_club_candidates` | Migration-only staging | Yes, after all onboarding-visible and dormant clubs are either created or abandoned, and all bootstrap decisions are finalized |
| `legacy_person_club_affiliations` | Migration-only staging | Yes, after all affiliation suggestions are resolved |
| `club_bootstrap_leaders` | Operational, migration-origin | Yes, after all provisional rows reach a terminal state (`claimed`, `superseded`, or `rejected`) |
| `member_club_affiliations` | Permanent operational | Never |
| `name_variants` | Permanent operational | Never (name-matching utility; see §14.16) |

---

## 17. Audit requirements

No migration dashboard is required. The existing append-only audit history records all migration events.

Scope note: this section enumerates migration-specific events only. General auth audit events (e.g. `password_changed`, `login_rate_limit_exceeded`, `account_locked`) are out of scope here; they share the same append-only audit history but are defined in the security-model documentation.

Required event types:

- `legacy_claim_requested`
- `legacy_claim_email_sent`
- `legacy_claim_email_resent`
- `legacy_claim_completed`
- `legacy_claim_blocked`
- `legacy_claim_manual_recovery`
- `legacy_club_bootstrap_created`
- `legacy_club_bootstrap_promoted`
- `legacy_club_bootstrap_superseded`
- `auto_link_tier1_applied`
- `auto_link_tier2_applied`
- `auto_link_tier3_queued`

Required metadata per event where applicable:

- Active member ID
- Imported member ID
- `legacy_member_id`
- Masked `legacy_email`
- Submitted identifier type
- Merge field summary
- Tier-change summary
- Club IDs involved
- Provisional bootstrap outcome
- Admin reason / verification note
- Auto-link tier and match details (for auto-link events)

---

## 18. What we need from Steve Goldberg

Steve is the current webmaster of the live legacy site. His contribution is specifically and only:

1. **Test export**: a full export of live legacy member records, in agreed format, for validation purposes only (no production changes)
2. **Field semantics confirmation**: for each export column, especially:
   - Legacy member ID (field name, format, uniqueness guarantee)
   - Legacy username (field name, uniqueness guarantee)
   - Legacy email (field name, uniqueness guarantee)
   - Tier / membership fields (current tier, expiry dates, tier history if available)
   - Banned, inactive, is_admin flags (presence, reliability, semantics)
3. **Namespace agreement for `legacy_member_id`**: confirm that the integer IDs in the export are the same integers used in the legacy site's `members/profile/{id}` URLs (the mirror-derived namespace). If they diverge, resolve before any test import; otherwise every `historical_persons.legacy_member_id` → `legacy_members.legacy_member_id` back-link in the pipeline is invalidated. Coordination notes also tracked in `legacy_data/IMPLEMENTATION_PLAN.md` Still-to-do item 12.
4. **Final production export**: after write freeze, same format as test export
5. **Write-freeze coordination**: legacy site goes into maintenance/read-only mode before the final export
6. **Legacy database retention**: keep the legacy database available for at least 30 days after cutover for manual recovery reference
7. **DNS cutover coordination**: confirm timing and TTL reduction window

We do **not** need Steve to produce club data. That comes from the mirror pipeline.

---

## 19. What we need from the historical-pipeline maintainer

The historical-pipeline work (running as a parallel sprint; see IMPLEMENTATION_PLAN.md for sprint goals):

1. **Club extraction into pipeline**: move mirror club extraction scripts into the historical pipeline; club identity normalization, affiliation inference, leadership inference. Classify clubs per the rules in section 9.1 (requires: `last_updated` and `created` from `clubs.csv`, most recent hosted event year from event HTML cross-reference, club contact member IDs matched to `historical_persons.last_year`, member counts, and description presence). Set `bootstrap_eligible` for pre-populated clubs with high-confidence leader candidates per section 2 bootstrap rule
2. **Mirror member extraction** into `historical_persons`: ~1,600 club-only members from the mirror who never appeared in event results
3. **Known name variants table**: seeded from mined data
4. **World records CSV**: for the records page
5. **Data review confirmation**: confirming legacy data is complete and member-list presentation is reviewed (unblocks members ungating)

---

## 20. Design decisions affected

The following design decisions require updating or creation before or after go-live. Do not update without explicit human approval per project rules.

| Decision | Change required |
|---|---|
| DD 3.8 (account security tokens) | `account_claim` token type with dual binding (`member_id` + `target_legacy_member_id`) and `ON DELETE NO ACTION` |
| DD 3.9 (security / privacy) | Add: legacy passwords never imported; `legacy_email` is migration metadata only; mailbox control is proof step |
| DD 6.5 (legacy data migration) | Full replacement per this document |
| DD (new) name model | Two-field name model, surname constraint, slug lifecycle, import exemption |
| DD (new) auto-link | Tiered auto-link system with email anchor, known variants table, batch vs registration-time split |
| DD (new) competition history | `first_competition_year` and `show_competitive_results` fields, opt-out semantics, caveat text |

---

## Part C -- Go-live

## 21. Go-live blocker index

All pass/fail go-live blockers in one view. Gate definitions and failure handling live in the referenced sections. Each entry shows the blocker ID, a one-line criterion, the section with full detail, and the operational-state transition it blocks.

This list is comprehensive for go-live cutover blockers. Broader product work that does not gate cutover lives in `docs/USER_STORIES.md`, `docs/DESIGN_DECISIONS.md`, and the active-slice trackers in `IMPLEMENTATION_PLAN.md` files.

### Data-quality, pipeline-output, and code-behavior gates

| ID | Criterion | Section | Blocks |
|---|---|---|---|
| G1 | `legacy_email` unique where non-NULL | §24 | State 2 → State 3 |
| G2 | `legacy_user_id` unique where non-NULL | §24 | State 2 → State 3 |
| G3 | Trustworthy `banned` field in export | §24 | State 2 → State 3 |
| G4 | Profile/contact field shape and null quality | §24 | State 2 → State 3 |
| G5 | Legacy member ID quality | §24 | State 2 → State 3 |
| G6 | Tier-state mapping inputs | §24 | State 2 → State 3 |
| G7 | Mirror-derived club normalization quality | §24 | State 2 → State 3 |
| G8 | High-confidence bootstrap leader candidates | §24 | State 2 → State 3 |
| G9 | Bootstrapped clubs produce valid pages | §24 | State 2 → State 3 |
| G10 | Outbox → SES → inbox smoke passes end-to-end | §24 | State 3 → State 4 |
| G11 | `name_variants` seeded (~290 pairs) | §24 | State 1 → State 2 |
| G12 | ~1,600 club-only persons extracted into `historical_persons` | §24 | State 1 → State 2 |
| G13 | `club_bootstrap_leaders` populated | §24 | State 1 → State 2 |
| G14 | `persons.csv` count reconciled | §24 | State 1 → State 2 |
| G15 | World records platform export produced | §24 | State 1 → State 2 |
| G16 | `run_pipeline.sh full` produces full output | §24 | State 1 → State 2 |
| G17 | Claim flow anti-enumeration invariant holds | §24 | State 2 → State 3 |
| G18 | Rate limiting active on claim / registration / password-reset | §24 | State 2 → State 3 |
| G19 | Registration-time auto-link wired and exercised | §24 | State 2 → State 3 |
| G20 | Data review sign-off: legacy data complete, member-list presentation reviewed | §24 | State 1 → State 2 |
| G21 | `legacy_user_id` and `legacy_email` populated on canonical `persons.csv` where mirror provides them | §24 | State 1 → State 2 |

### External dependencies

| ID | Criterion | Section | Blocks |
|---|---|---|---|
| EX1 | `footbag.org` domain owned by IFPA, DNS pointing to new platform | §22 Phase 4 prereqs | State 3 → State 4 |
| EX2 | SES production access granted for AWS account | §22 Phase 4 prereqs | State 3 → State 4 |
| EX3 | `noreply@footbag.org` verified as SES sender identity with DKIM on DNS | §22 Phase 4 prereqs; §28.5 | State 3 → State 4 |

### Legacy-site webmaster coordination

| ID | Criterion | Section | Blocks |
|---|---|---|---|
| WM1 | Test export delivered and validated | §18 item 1 | State 1 → State 2 |
| WM2 | Legacy-export field semantics confirmed (IDs, username, email, tiers, banned, is_admin) | §18 item 2 | State 1 → State 2 |
| WM3 | Final production export delivered post-write-freeze | §18 item 3 | State 3 → State 4 |
| WM4 | Write-freeze / maintenance mode coordinated on legacy site | §18 item 4 | State 3 → State 4 |
| WM5 | Legacy database retention committed (minimum 30 days post-cutover) | §18 item 5 | State 3 → State 4 |
| WM6 | DNS cutover timing and TTL reduction window coordinated | §18 item 6 | State 3 → State 4 |

### Operational readiness gates

| ID | Criterion | Section | Blocks |
|---|---|---|---|
| OR1 | Data backup and disaster recovery | §28.1 | State 3 → State 4 |
| OR2 | Observability and monitoring readiness | §28.2 | State 3 → State 4 |
| OR3 | Edge and origin security | §28.3 | State 3 → State 4 |
| OR4 | IAM least-privilege scope-down | §28.4 | State 3 → State 4 |
| OR5 | Email deliverability operations | §28.5 | State 3 → State 4 |
| OR6 | Scheduled maintenance jobs | §28.6 | State 3 → State 4 |
| OR7 | Secrets rotation | §28.7 | State 3 → State 4 |

### Pre-cutover revert and rotation checklist

| ID | Criterion | Section | Blocks |
|---|---|---|---|
| PC1 | JWT TTL revert to DD §3.4 24h baseline | §28.8 | State 3 → State 4 |
| PC2 | SES sender cutover to `noreply@footbag.org` | §28.8 | State 3 → State 4 |
| PC3 | STUB_PASSWORD rotation | §28.8 | State 3 → State 4 |
| PC4 | Lightsail SSH firewall rule restore | §28.8 | State 3 → State 4 |
| PC5 | SES sandbox-mode flip | §28.8 | State 3 → State 4 |
| PC6 | Production Terraform region fix (us-east-1) | §28.8 | State 3 → State 4 |
| PC7 | Preview fixture scrub | §28.8 | State 3 → State 4 |

### Retirement gate

| ID | Criterion | Section | Blocks |
|---|---|---|---|
| R1 | QC subsystem retired (routes, code, tables, tests) | §29 | State 3 → State 4 |

---

## 22. Phasing

### Phase 1: No external data

Name model, slug lifecycle, person links, historical name display, `first_competition_year`, `show_competitive_results`.

### Phase 2: Historical-data pipeline

- Club extraction integrated into historical pipeline
- Mirror member extraction into `historical_persons` (~1,600 club-only members)
- Known name variants table seeded from mined data
- World records CSV
- Data review confirmation

### Phase 3: Needs the legacy-account export

- Legacy member import script
- Email-verified claim flow
- Auto-link matching (batch at cutover)
- Name reconciliation in claim flow

### Phase 4: Go-live

External prerequisites that must land before Phase 4 starts:

- **`footbag.org` domain owned by IFPA** and pointing DNS to the new platform. Blocks both the DNS switch and cutover of `SES_FROM_IDENTITY` to `noreply@footbag.org`.
- **SES production access granted** for the AWS account. Sandbox caps are 200 sends/day and require per-recipient verification; the post-cutover notification batch is incompatible with sandbox. Production access is an AWS support ticket with a typical 24-48h approval window; start early (see State 3 readiness checklist).
- **`noreply@footbag.org` verified in SES** (sender identity) and runtime-role `ses:SendEmail` IAM policy pinned to that sender identity ARN (post-production-access, the recipient-identity permission check goes away, so the sender-only pin is sufficient and least-privilege).
- **JWT session TTL at the DD §3.5 baseline** (24h). Staging observability-tuned values must be reverted in code before the cutover deploy.
- **Email-delivery smoke passes end-to-end** on the final pre-cutover release: enqueue a test row via the outbox, worker drains, SES accepts, recipient inbox receives. See §24 gate G10.
- **STUB_PASSWORD rotated** for the staging preview-user; vault entry updated before any external tester receives the credential. See §28.8.
- **Lightsail SSH firewall rule restored** via `terraform apply` from `terraform/staging/` (removes Console override of the port-22 rule and returns to `operator_cidrs`-constrained ingress). See §28.8.

Phase 4 activities:

- DNS switch
- Post-cutover notification batch (emails to all imported placeholders with reachable `legacy_email`). Batching respects SES send-rate quotas; each send appends an audit entry per §17; hard-bounce suppression (per §28.5) governs retry eligibility; batch success is a gating signal that the migration loop has closed.
- Admin review of Tier 3 auto-link cases from the legacy data (migration-time only)
- Registration-time auto-link with inline user prompt (all tiers)

---

## 23. Operational states

### State 0: Current state

- Historical pipeline complete (or in progress)
- Legacy site live, accepting writes
- New platform deployed on staging
- Phase 1 code complete

### State 1: Historical-data pipeline complete

- `legacy_club_candidates` populated and classified per section 9.1 rules (pre-populate, onboarding-visible, dormant; junk excluded)
- `legacy_person_club_affiliations` populated
- Bootstrap eligibility decisions made for pre-populated clubs
- Review report reviewed; admin decisions logged for ambiguous cases
- Known name variants table seeded

### State 2: Phase 1 complete (test load)

- Steve provides test export
- Imported member rows inserted into staging `members`
- Tier grants written for all imported rows
- `legacy_email` and `legacy_user_id` uniqueness verified
- Banned field evaluated
- Club bootstrap candidates resolved against imported placeholder rows
- `club_bootstrap_leaders` rows created in staging
- Batch auto-link pass run on staging
- Full claim flow rehearsed end-to-end on staging
- All validation gates (section 24) evaluated

### State 3: Phase 2 complete (go-live preparation)

- DNS TTL reduced (24 to 48 hours before go-live)
- All migration scripts finalized
- Admin review of unresolved high-impact clubs complete
- Final cutover checklist confirmed
- Steve briefed on final export and freeze timing
- SES production-access ticket filed and approved (24-48h lead time; see Phase 4 prerequisites)
- `noreply@footbag.org` sender identity verified in SES; `SES_FROM_IDENTITY` on the production host updated; runtime-role `OutboundEmail` IAM policy resource ARN set to the production sender identity
- Email-delivery smoke passes end-to-end (§24 gate G10)

### State 4: Phase 3 (production cutover)

1. Steve places legacy site in write freeze / maintenance mode
2. Steve produces final production export
3. New platform imports legacy member rows
4. New platform writes tier grants
5. New platform creates bootstrapped `clubs` rows for approved candidates
6. New platform creates `club_bootstrap_leaders` rows
7. New platform runs batch auto-link (Tier 1 and Tier 2)
8. New platform runs validation checks
9. DNS switch to new platform
10. Admin verifies the new platform is operational (smoke checks, critical flows confirmed, including one real end-to-end outbox → SES send to a verified admin inbox)
11. Admin triggers post-cutover notification batch

### State 5: Post-cutover

- New platform live
- Legacy database retained by Steve for reference and targeted recovery
- Members self-serve claim their legacy accounts over time
- Admins handle manual recovery cases and remaining Tier 3 cases from migration
- Leadership activations accumulate as members register and claim

### State 6: Migration complete

- All high-priority legacy accounts claimed or manually recovered
- All bootstrap clubs resolved or admin-reviewed
- All Tier 3 auto-link cases resolved (by admin review or member registration)
- Legacy database retired

---

## 24. Validation gates

The following must be confirmed at the test load before go-live. These are not open design questions; they are data-quality checkpoints.

| Gate | Description | Failure handling |
|---|---|---|
| G1 | `legacy_email` is unique where non-NULL | Replace provisional unique index with non-unique lookup + ambiguity handling |
| G2 | `legacy_user_id` is unique where non-NULL | Same as G1 |
| G3 | Live export contains a trustworthy `banned` field | If absent or unreliable, omit `legacy_banned` column; restrict claim for unverifiable rows via admin review instead |
| G4 | Shape and null quality of profile/contact fields | Adjust import logic and field mapping |
| G5 | Legacy member ID quality (format, completeness, uniqueness) | Resolve before final export |
| G6 | Tier-state mapping inputs (current tier, expiry, history) | Confirm Tier 2 annual expiry handling; may require simplified fallback |
| G7 | Mirror-derived club normalization quality | Increase manual review threshold |
| G8 | Sufficient high-confidence club-leader bootstrap candidates | Adjust bootstrap threshold or expand manual review scope |
| G9 | Bootstrapped clubs produce valid, non-broken club pages | Fix UI before go-live |
| G10 | Outbox → SES → recipient inbox path works end-to-end on the pre-cutover release (enqueue test row, worker drains within one poll interval, SES returns MessageId, message arrives in recipient inbox) | Debug before cutover; common causes are IAM Resource scope, SES sandbox state, worker container env vars, worker event-loop bugs |
| G11 | `name_variants` seeded with ~290 mined pairs (§14.16) | Auto-link Tier 2 coverage drops; Tier 3 admin queue expands; document shortfall in State 1 review |
| G12 | ~1,600 club-only persons extracted into `historical_persons` per §9.2 | Classification signals (active-players, contact-competed) run with reduced coverage; onboarding-visible list may shrink |
| G13 | `club_bootstrap_leaders` populated for pre-populated clubs meeting the §2 bootstrap rule | Leadership activation defers to path 2 (first affiliated member accepts leadership) for affected clubs |
| G14 | Canonical `persons.csv` row count reconciled against `historical_persons` population; any accepted discrepancy documented and signed off | Block at test load until reconciled; unexplained delta risks missing or duplicated historical identities |
| G15 | World records export produced in platform format and loads into the records schema cleanly | Records page launches empty or incomplete; fix export before go-live or hide the records entry point |
| G16 | `run_pipeline.sh full` produces events, results, persons, clubs (classified), bootstrap leaders, club-only persons, variants, and records in one run | Document the multi-step manual sequence required and capture sign-off at State 1; single-command regeneration is the target, not a cutover blocker |
| G17 | Claim flow anti-enumeration invariant holds per §7 "Non-revealing messaging" (identical UX across matched-none, matched-multiple, matched-blocked, matched-ineligible, and matched-eligible) | Collapse divergent response shapes before go-live; side-channel enumeration otherwise possible |
| G18 | Rate limiting active on claim initiation, claim resend, registration, and password-reset per DD §3.8 | Block go-live until limiters engage; legacy mailbox abuse and enumeration otherwise unmitigated |
| G19 | Registration-time auto-link per §6 wired into `verifyEmailByToken`; Tier 1, Tier 2, and Tier 3 paths all exercised at test load | Registration remains a manual cleanup path for legacy-match cases; admin Tier 3 queue grows |
| G20 | Data review sign-off: confirmation that legacy data is complete and member-list presentation is reviewed (unblocks members ungating) | Withhold members ungating until sign-off; historical-pipeline maintainer owns sign-off per §19 item 5 |
| G21 | `legacy_user_id` and `legacy_email` populated on canonical `persons.csv` where mirror provides them | Claim flow lookup falls back to `legacy_member_id` only; auto-link Tier 1/2 coverage drops because the email anchor is missing |

**Tuning authority for G8:** Bootstrap threshold adjustments at test load are a joint decision between the primary maintainer and the historical-pipeline maintainer. Raising the threshold (more conservative) is routine and requires no additional sign-off. Lowering the threshold below a minimum acceptable value (to be set during State 2 review if lowering is needed) requires IFPA board sign-off, because lowering materially expands who gains bootstrap leadership and the live club-management permissions that follow at first claim.

---

## 25. Data quality from persons.csv analysis

Current analysis of `legacy_data/event_results/canonical_input/persons.csv`:

- 4,861 total persons
- 1,743 with IFPA IDs (legacy member IDs)
- 290 mined name variant pairs:
  - ~26 accent variations
  - ~88 prefix variations
  - ~139 typo corrections
  - ~40 diminutives
- 103 garbled parse-artifact entries needing cleanup
- Jody/Jolene Welch class: same person, completely different first name; only catchable by admin review (Tier 3)

---

## 26. Rollback posture

- Before DNS switch: abort, fix issues, retry
- After DNS switch: manual DNS reversion to the legacy site is the rollback lever, available for up to 48 hours post-cutover. Beyond that window, the fix-forward path is authoritative; any return to the legacy site requires explicit joint sign-off from the primary maintainer and Steve Goldberg, because the legacy database will have diverged from the new platform's accepted writes and reverting loses those writes.
- Steve retains the legacy database for 30 days for reference and targeted manual recovery
- No automated rollback is provided after the DNS switch

---

## 27. Open issues deferred to test load

1. **`announce_opt_in`**: Not in the current schema. If the legacy-account export contains a meaningful communication-preference field, add the column to `members` and carry it forward at claim. Gated entirely on the test load.
2. **`legacy_banned`**: Column added only if the legacy-account export contains a trustworthy banned/inactive field. See section 14.5.

**Standing consistency note:** The product-facing term for `legacy_user_id` is "legacy username." This must be applied consistently in all UI copy, error messages, and documentation regardless of the column name.

---

## 28. Operational readiness for go-live

Non-data workstreams that must close before production cutover. Each subsection states the go-live gate (what must be true); operator procedures live in `docs/DEV_ONBOARDING.md` (Path G / Path I) and routine runbooks live in `docs/DEVOPS_GUIDE.md`. This section holds only what is required to green-light §23 State 3 / State 4.

### 28.1 Data backup and disaster recovery

Gate: host-side SQLite backup producer runs on a schedule, ships to S3, and emits `BackupAgeMinutes`; a full restore drill has been rehearsed end-to-end; the backup-age CloudWatch alarm (`enable_backup_alarm = true`) is enabled and has emitted a non-alarm state; the cross-region DR bucket has Object Lock configured per `docs/DEVOPS_GUIDE.md` §3.6 (Object Lock can only be enabled at bucket creation, so retrofitting requires bucket recreation). Recovery targets: 5–10 min RPO, ~5 min RTO per `docs/DEVOPS_GUIDE.md` §10.1. Procedure: `docs/DEV_ONBOARDING.md` §7.4 (setup); `docs/DEVOPS_GUIDE.md` §10 (runbook).

### 28.2 Observability and monitoring readiness

Gate: CloudWatch agent installed on the runtime host; `enable_cwagent_alarms = true` applied and CPU / memory / disk alarms reachable via SNS with operator subscription confirmed; CloudFront 5xx alarm active; minimal operator dashboard documented. Procedure: `docs/DEV_ONBOARDING.md` §7.6 (install + enablement); `docs/DEVOPS_GUIDE.md` §12 (operating rules).

### 28.3 Edge and origin security

Gate: CloudFront enforces `X-Origin-Verify` on origin requests; Nginx rejects direct-to-origin traffic without the header; the S3 maintenance bucket with Origin Access Control is addressable via an ordered cache behavior at `/maintenance.html`. Direct origin bypass is no longer possible. Procedure: `docs/DEV_ONBOARDING.md` §7.2; `docs/DEVOPS_GUIDE.md` §7.2 / §7.3.

### 28.4 IAM least-privilege scope-down

Gate: `footbag-operator` removed from `AdministratorAccess` and moved to a least-privilege policy covering only services the project uses (Lightsail, CloudFront, S3, SSM, KMS, SNS, CloudWatch, self-IAM for rotation); the Lightsail host's `ec2-user` default account retired in favor of named operator accounts; source-profile IAM user's access keys on a documented 90-day rotation cadence; all runtime-role IAM policies (SSM read, S3 snapshots, SES send, KMS sign) declared in Terraform HCL so `terraform apply` is a safe operation that cannot silently drop a Console-added capability. Procedure: `docs/DEV_ONBOARDING.md` §7.3; `docs/DEVOPS_GUIDE.md` §5.7.

### 28.5 Email deliverability operations

Gate: SES is out of sandbox with production access granted; `noreply@footbag.org` verified as a canonical SES identity with DKIM on DNS; an SNS topic subscribes to SES bounce and complaint events and the application processes those into hard-bounce suppression and complaint tracking; email-delivery smoke (validation gate G10) has passed end-to-end on a pre-cutover release. Procedure: `docs/DEV_ONBOARDING.md` Path I (activation).

### 28.6 Scheduled maintenance jobs

Gate: login rate-limit cooldown is wired to the `login_cooldown_minutes` setting (currently unwired; fixed-window only); daily `account_tokens` cleanup job runs on the host and removes expired entries; job execution is observable via standard application logs or CloudWatch. Procedure: in-code + `docs/DEVOPS_GUIDE.md` (runbook to be added).

### 28.7 Secrets rotation

Gate: JWT signing-key rotation procedure with 24h overlap is documented and drilled against staging before production cutover (generate new key, stand it up alongside current key, flip the active signer, retire the old key after the overlap window); session JWT refresh re-issues the cookie when `exp` is within 6h per DD §3.4 so users are not silently logged out at the 24h TTL boundary; `SESSION_SECRET` rotation runbook exists. Source-profile access-key rotation is covered under §28.4. Procedure: `docs/DEVOPS_GUIDE.md` §5.

### 28.8 Pre-cutover revert and rotation checklist

Before Phase 4 cutover, the following staging-observability-only deviations must be reverted and rotations completed:

1. JWT TTL revert: `DEFAULT_TTL_SECONDS` in `src/services/jwtService.ts` and `SESSION_COOKIE_MAX_AGE_MS` in `src/middleware/auth.ts` restored to the DD §3.4 24h baseline. Session JWT refresh (§28.7) must land before this revert to avoid silent mid-session logouts at the 24h boundary.
2. SES sender cutover: re-run `docs/DEV_ONBOARDING.md` §8.8 against the canonical address; switch `SES_FROM_IDENTITY` in `/srv/footbag/env` and the `OutboundEmail` IAM policy `Resource` ARN from the interim staging sender to the canonical `noreply@footbag.org` identity; restart the app. Env + IAM only, no code. Blocked on IFPA domain acquisition.
3. STUB_PASSWORD rotation: staging preview-user credential rotated in local `.env`, redeployed, and the vault entry updated before any external tester receives the credential.
4. Lightsail SSH firewall rule restore: `terraform apply` from `terraform/staging/` to remove the Path H §8.10 browser-SSH override (loosened beyond `operator_cidrs`) and return to the `operator_cidrs`-constrained ingress.
5. SES sandbox-mode flip: `SES_SANDBOX_MODE` in `/srv/footbag/env` cleared (removed or set to `0`) once SES production access has been granted for the account. Clears the staging-warning card rendered on email-gated pages (DD §5.6).
6. Production Terraform region fix: change `terraform/production/variables.tf:14` region default from `us-east-2` to `us-east-1` before any `terraform apply` from `terraform/production/`. Staging is `us-east-1` per §28.2 / `docs/DEVOPS_GUIDE.md` §3.3; applying as-is would create cross-region production resources.
7. Preview fixture scrub: `legacy_data/event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py` inserts a "Footbag Hacky" fixture (fake event, discipline, result, HP record with HoF flag, and result-entry participant) alongside the preview-user account. Acceptable in staging for UX preview; must not reach the production DB. Either condition the fixture block on an env flag (e.g. `FOOTBAG_SEED_PREVIEW_FIXTURE=1`) or delete the block in the production-cutover data pass.

Sign-off on this checklist is a prerequisite for §23 State 3 → State 4 transition.

---

## 29. QC subsystem retirement (go-live gate)

The internal QC subsystem (`/internal/net/*`, `/internal/persons/*`, and supporting code, tables, and tests) is a hard go-live gate: no production deployment may carry QC code, routes, or tables. Deletion is not a post-launch tidy-up. Scope at retirement time: every `/internal/*` route, its controller and service code, its Handlebars views, its schema tables, its `db.ts` prepared-statement groups, and its tests.

Sign-off on QC retirement is a prerequisite for §23 State 3 → State 4 transition.
