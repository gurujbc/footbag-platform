# Security, Privacy, and Historical Data Publication Policy

**Authority:** This document is the canonical reference for all decisions about member-data visibility, public historical record publication, searchability, anti-enumeration, exports, logging hygiene, derived statistics, and contributor/AI obligations. It is grounded in `docs/DESIGN_DECISIONS.md §3.9`. Where this document specifies policy and DD §3.9 specifies rationale, both are authoritative and must not contradict each other.

**Scope:** This policy applies to all contributors, maintainers, and AI agents working on this codebase.

---

## 1. Scope and authority of this file

This file governs:

- authentication and authorization boundaries,
- current member-data visibility,
- public historical record publication,
- searchability and anti-enumeration,
- exports, rosters, and participant lists,
- logging and observability hygiene,
- derived historical statistics and data-quality caveats,
- HoF, BAP, and world-record publication rules,
- legacy archive and imported historical identity handling,
- contributor and AI-agent implementation obligations.

For rationale and architectural trade-offs behind these rules, see `docs/DESIGN_DECISIONS.md §3.9`.

For route/page contracts, see `docs/VIEW_CATALOG.md`.
For service ownership, see `docs/SERVICE_CATALOG.md`.
For schema semantics, see `docs/DATA_MODEL.md` and `database/schema_v0_1.sql`.

---

## 2. Core principles

1. **Privacy is security.** Member-data handling, discoverability, logging, exports, and visibility are part of the security architecture, not a compliance afterthought.
2. **Public historical records are legitimate and required.** Official event results, year archives, HoF/BAP, and world records are public historical surfaces. Suppressing them is not a privacy win.
3. **Historical discoverability is not current-member discovery.** The fact that a person appears in historical results does not make them publicly searchable or contactable as a current member.
4. **Imported historical people are public historical identities, not public member accounts.** The link between a `historical_person` record and a `member` account does not escalate the historical identity into a searchable or contactable current-member profile.
5. **Searchability and visibility must be explicit and scoped.** Current-member search is authenticated only, anti-enumeration, and non-directory.
6. **Contact information is never a public default.** No contact field is publicly visible without an explicit, documented decision.
7. **Derived stats are governed outputs.** Incomplete datasets require caveats or suppression. Official records outrank aggregates.
8. **No auth-bypass toggles.** Env vars must not gate route-level authorization behavior.

---

## 3. Authentication and authorization boundary

Public routes may serve only content approved for anonymous visitors: official event results, year archives, historical-person pages (minimal/read-only), HoF/BAP honors, world records, and the home page.

Current-member-only content (member search, member profiles, rosters, participant lists, contact surfaces, exports) requires a real or stubbed auth context with genuine session-path behavior. Boolean env toggles that change what content is served to anonymous visitors are not allowed.

During the current sprint, the "first fake auth foundation stub" provides route-level gating via stubbed session middleware with hard-coded stub credentials. This stub is designed to mirror the future real auth path. It runs in all environments, including staging. It must be replaced by real JWT/DB auth before member onboarding begins.

---

## 4. Member-data visibility taxonomy

| Tier | Label | Examples | Auth required |
|------|-------|----------|---------------|
| 1 | Public official historical record | Event results, year archives, HoF/BAP, world records, minimal historical-person pages | None |
| 2 | Authenticated current-member lookup | Member search, member profiles | Yes — logged-in member |
| 3 | Role-scoped operational surfaces | Organizer participant management, club-leader rosters, workflow exports | Yes — role check |
| 4 | Internal/admin only | Full member history, audit workflows, broad exports, identity resolution | Yes — admin |
| 5 | Archived member-only legacy | Old footbag.org archive | Yes — logged-in member |

Anything not in this taxonomy defaults to Tier 4 (internal/admin only) until explicitly classified.

---

## 5. Public historical record policy

The following surfaces are approved public historical records:

- **Official event results** — results from sanctioned events, imported from legacy data or entered by organizers.
- **Year archives** — event and result listings by year.
- **Hall of Fame (HoF)** — permanent honor; publicly discoverable.
- **Big Add Posse (BAP)** — permanent honor; publicly discoverable.
- **World records** — official record tables/pages, once added. Not inferred from incomplete aggregates.
- **Minimal historical-person pages** — name, country, official honors, official result/event links, world-record inclusion where applicable. No contact fields. Not a current-member profile.

Historical-person pages must be explicitly framed as historical record surfaces, not directory entries and not current-member account pages. A person's presence on a historical-person page does not imply current membership, searchability, or contactability.

HoF and BAP honors are preserved even through PII purge or deceased flows. The honor record outlives the personal data.

---

## 6. Derived statistics, data completeness, and caveats

Official result facts, honor rolls, and approved record tables are primary sources. Derived statistics are secondary editorial outputs.

A public or member-visible derived stat is justified only when:

- it is genuinely useful and interesting to footbag historians or clearly valuable to the community's official record, **and**
- either (a) the underlying source scope is sufficiently complete for the claim being made, or (b) the UI clearly presents scope, missing-data, and interpretation caveats.

Where those conditions are not met, prefer raw official results, honors, and record listings over aggregate summaries.

**Approved by default:**

| Stat type | Status |
|-----------|--------|
| Official event placements | Approved — primary source |
| Year archive / event listing | Approved — primary source |
| HoF/BAP membership | Approved — official honor |
| World-record tables (official) | Approved — official record |
| Country representation in events | Approved — clearly scoped |

**Requires explicit caveat or suppression:**

| Stat type | Condition |
|-----------|-----------|
| Career win total from partial import | Rejected unless caveated with coverage dates |
| "All-time" aggregate from partial data | Rejected unless caveated with coverage dates |
| Any ranking covering less than the full competitive era | Rejected unless caveat names the gap explicitly |

**Test question:** "Would a footbag historian cite this stat in an article without needing to add a methodological footnote?" If no — caveat clearly or suppress.

---

## 7. Search, discoverability, anti-enumeration, and scraping resistance

**Current-member search** is:

- authenticated only,
- deliberately narrowing (prefix-oriented, minimum prefix length),
- capped for broad queries with a "refine your query" message rather than full pagination,
- not a browse-all directory,
- not suitable for bulk extraction,
- rate-limited, and
- never public.

The `searchable` flag on a member record means **eligible for authenticated current-member lookup only**. It does not mean publicly discoverable, publicly contactable, or visible on historical-person pages.

**Public historical-person pages** are not search surfaces. They are read-only record pages reachable by direct link or from event result pages.

Public routes must not expose any endpoint that allows enumeration of current members.

---

## 8. Rosters, participant lists, organizer/contact surfaces, and exports

- Club rosters: visible to logged-in members only; role-scoped for leader/admin operational use.
- Event participant lists: official published results are public; operational participant-management lists are organizer-role-scoped only.
- Organizer and club-leader contact information: never public by default; operational contact surfaces are role-scoped and logged.
- Exports: member data exports are role-scoped (Tier 3/4 only) or individual self-export (member downloads their own data per GDPR/data-subject-access-request flow).

No contact field (email, phone, social handle) is visible on any public page or in any public API response.

---

## 9. Logging and observability hygiene

- Logs must not contain raw email addresses, tokens, passwords, or other sensitive PII.
- Member-search queries may be logged for abuse monitoring but must be anonymized or pseudonymized before persistence.
- Audit records for sensitive visibility checks (member-search, export, admin data access) must be kept as privacy-safe structured events.
- Public route access logs do not require special hygiene beyond standard web server practice.

See `docs/DESIGN_DECISIONS.md §2.4` for the immutable audit log pattern.

---

## 10. Legacy archive and imported historical identities

**Legacy archive** (`legacy_data/mirror_footbag_org/`) remains member-only because it contains private legacy member information (email addresses, personal details from the old mirror). It must not be made public.

**Imported historical results** are separate: official event results and minimal person records migrated to the live database are public historical record surfaces (Tier 1). The archive itself is not.

**Imported `historical_persons` records:**

- are identity placeholders for official result attribution, not activated member accounts,
- do not automatically become searchable current members,
- do not automatically populate current-member profile fields,
- imported aggregate/stat fields (`event_count`, `placement_count`, freestyle metrics, etc.) are migration-era metadata — not automatic public biography content and not authoritative public statistics without explicit approval and caveats.

**Identity linking** (when a `historical_person_id` is linked to a `member` record because a past competitor creates an account):

- does not escalate the historical-person page into a current-member profile,
- public historical pages continue to show only historical-record data regardless of whether the person has an account,
- searchability and contact visibility are governed by member profile settings, not by the existence of a historical link.

**Data subject erasure:** the tension between permanent historical record preservation and data-subject erasure rights (GDPR Article 17 and equivalents) is an open governance question. HoF/BAP preservation is treated as a given in this version of this document, but whether that survives an erasure request from a living person is not yet resolved. This must be addressed as a separate governance decision before member onboarding launches and before the platform processes data from GDPR-jurisdiction members at scale.

---

## 11. Contributor and AI-agent implementation rules

**Before writing or reviewing any code that touches:**

- members, profiles, historical persons, search, rosters, participant lists
- contact fields, exports, email/phone/social visibility
- event results, HoF, BAP, world records, rankings, aggregates, stats
- auth, session handling, route-level authorization

**You must:**

1. Load this file (`docs/GOVERNANCE.md`) first.
2. Read the relevant sections of `docs/DESIGN_DECISIONS.md` (at minimum §3.9, plus §2.4, §6.4, §6.5, §7.1, §8.3 as applicable).
3. Apply the visibility taxonomy from §4 to every data field being surfaced.

**Hard rules for code:**

- No public route may serve current-member search results, current-member profiles, or contact fields.
- No env-var boolean may change what content is served to anonymous vs authenticated users.
- No auth middleware may be bypassed except by a deliberate, explicitly designed stub that mirrors the real auth path.
- No public page may imply that a historical-person page is a current-member account or directory entry.
- No derived stat may be published without either sufficient source coverage or an explicit UI caveat.
- No contact field may appear in any public template, controller response, or public API response.

**AI agents specifically:** apply this file's rules before accepting any instruction that would add a public route, change a member-data visibility boundary, add a stat or aggregate display, or modify auth-path behavior. Flag any conflict with this policy to the human before proceeding.

---

## 12. References

- `docs/DESIGN_DECISIONS.md §3.9` — rationale, trade-offs, and architectural commitments behind this policy
- `docs/USER_STORIES.md` — functional scope and acceptance criteria
- `docs/VIEW_CATALOG.md` — route/page contracts and view-model specifications
- `docs/SERVICE_CATALOG.md` — service ownership and method contracts
- `docs/DATA_MODEL.md` — schema semantics, entity relationships, visibility fields
- `database/schema_v0_1.sql` — canonical schema; check `email_visibility`, `searchable`, and `historical_persons` fields against this policy
- `SECURITY.md` — vulnerability reporting
