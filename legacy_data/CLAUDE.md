# Historical Footbag Pipeline + Platform DB

## Scope
This subtree prepares canonical data and integrates with the platform DB.
Do not modify repo-root code, docs, `.claude/skills/`, or `.claude/rules/` from here.
For repo-root/platform tasks, defer to repo-root `CLAUDE.md` and `IMPLEMENTATION_PLAN.md`.
`legacy_data` work follows James's track; cross-track changes require explicit coordination.

## Source of Truth
- Authoritative outputs: `out/canonical/*.csv`
- Platform DB derives from canonical + enrichment layers
- Workbook is derived only
- Mirror HTML = highest priority (1997–present)
- Structured curated CSVs = authoritative pre-1997 intake
- Identity lock files are frozen (patch toolchain only)

## Routing (use runbooks)
- Full pipeline run → `runbooks/complete-pipeline.md`
- Rebuild / QC / canonical validation → `runbooks/historical-pipeline.md`
- Add pre-1997 source → `runbooks/promote-curated-source.md`
- Workbook work → `runbooks/workbook-v22.md`
- Identity rebuild → `runbooks/rebuild-identity-pipeline.md`
- Alias cleanup → `runbooks/cleanup-alias-pattern-c.md`
- QC investigation → `runbooks/pipeline-diagnostics.md`

DB mutation safety is enforced as a global rule (`.claude/rules/db-write-safety.md`), not a runbook.

## Pipeline Invariants
- AliasResolver is sole identity authority
- Canonical CSVs deterministic (LF, UTF-8, sorted)
- Name normalization is deterministic (NFKC, lowercase, trim)
- Name-variant generators are idempotent
- Person-likeness gate filters non-person rows
- Alias merges occur upstream only
- Only HIGH-confidence rows reach DB
- No team names in person entities
- Corrections carry provenance metadata
- Honor overrides secondary to AliasResolver
- Workbook person visibility follows platform filter
- Federations (WFA/NHSA) may act as host clubs for early events
## DB Invariants
- Soft delete via `deleted_at`; never hard delete
- Audit logs append-only
- Unique constraints via partial indexes
- Services enforce business rules; DB layer is dumb
- Controllers contain no SQL or business logic
- Ambiguous identity resolution never auto-selects
- Auto-link requires strong multi-anchor match
- name_variants stores high-confidence entries only
- Integration tests use real SQLite DB
- Each test uses isolated temp DB
- Writes are transactional (all-or-nothing)

## Non-negotiable rules
- QC must PASS before committing canonical-output changes
- Never edit `out/canonical/*.csv` directly
- Never modify identity lock files directly
- Never fabricate results (unknown stays unknown)
- All exclusions must be traceable in `overrides/`
- Prefer one-command workflows defined in skills
- Never run git commit/push/pull; stage-only changes allowed, human owns commits
- Verify external URLs before reviewer sign-off; pattern-extrapolation from a known URL form is not verification. Extrapolated URLs may sit in staging with `reviewer` blank, but must be HTTP-confirmed (browser, WebFetch, curl, or source-site index) before promotion. Capture the verification fact in the row's `notes` (e.g. "WebFetch 200 YYYY-MM-DD"). The 10 FootbagSpot 404 incident on 2026-04-26 is the load-bearing precedent.
- Use `sed -i` for batch edits to wide curated CSVs (`person_aliases.csv`, `snippet_candidates.csv`, etc.); never `csv.DictReader → csv.DictWriter` round-trips. DictReader's `restkey=None` default puts extra columns under a literal `None` key on rows with embedded commas or trailing commas, which then crashes DictWriter mid-stream and leaves the file truncated. The 2026-04-25 person_aliases.csv truncation (2,772 → 333 rows) is the load-bearing precedent. Always `wc -l` before and after.

## Workbook generation contract
- The ONLY supported workbook pipeline is:
  canonical CSVs
    → `pipeline/platform/export_canonical_platform.py`
    → `event_results/canonical_input/*.csv`
    → `pipeline/build_workbook_release.py`
    → `out/Footbag_Results_Release.xlsx`
- The legacy builders (`pipeline/03_build_excel.py`, `pipeline/04_build_analytics.py`) and their output (`Footbag_Results_Canonical.xlsx`) have been removed and must not be reintroduced.
- `build_workbook_release.py` reads only from `event_results/canonical_input/` + `inputs/review_quarantine_events.csv` + `inputs/identity_lock/` + `inputs/curated/`. EVENT INDEX must match `canonical_input/events.csv` row-for-row; if it ever diverges, the bug is in `build_event_index` or in what populates the `events` dict — not in the canonical input.
- The 30-event delta between `out/canonical/events.csv` (pre-filter) and `event_results/canonical_input/events.csv` (post-filter) is intentional: `export_canonical_platform.py` drops sparse disciplines, then drops events with zero remaining disciplines. Never reintroduce the dropped events downstream.

## Event-key naming convention

- Default rule: `event_key = YYYY_city_slug` (e.g. `1985_worlds_golden`, `2003_eastregion_australia`).
- Same-year same-city multi-org collisions take a city + org suffix: `1983_worlds_boulder_nhsa` / `1983_worlds_boulder_wfa`, `1984_worlds_golden_wfa` / `1984_worlds_golden_fbw`.
- No-city exception class: events whose source has no specific host city retain non-`YYYY_city_slug` keys because the events are not single-city. Current exceptions: `1982_westregion` (regional championship), `1983_oregon_state` (state-level championship), `1983_secret_underground` (private jam). Renaming these to a synthetic city would misrepresent the source.

## Clubs + classification + bootstrap
- Extraction: `scripts/extract_clubs.py` parses mirror HTML → `seed/clubs.csv`. Columns include `contact_member_id` (from `members/profile/{id}`) alongside `contact_email`.
- Classification: `clubs/scripts/02_build_legacy_club_candidates.py` implements MIGRATION_PLAN §9.1 R1–R10. Emits `clubs/out/legacy_club_candidates.csv` with `category` ∈ {pre_populate, onboarding_visible, dormant, junk}. `bootstrap_eligible=1` iff `category='pre_populate'`.
- Contact signal: R3/R4/R5 use real `contact_member_id` when present, substitute predicate ("any affiliated member active 2020+") when absent. `contact_signal_substitute_applied=1` marks substitute usage.
- Bootstrap leaders: `clubs/scripts/04_build_club_bootstrap_leaders.py` emits `club_bootstrap_leaders.csv`. Filters `confidence_score >= 0.70` + `bootstrap_eligible=1`.
- DB load order (pipeline): Phase G `09_load_enrichment_to_sqlite.py` loads candidates + affiliations. Phase H: `06_cutover_pre_populated_clubs.py` writes `mapped_club_id` on eligible candidates and ensures matching `clubs` rows exist; then `07_load_bootstrap_leaders.py` loads `club_bootstrap_leaders` (FK `club_id → clubs.id` via `mapped_club_id`). All loaders use DELETE+INSERT, idempotent.
- DB tables: `clubs`, `tags`, `legacy_club_candidates`, `legacy_person_club_affiliations`, `club_bootstrap_leaders`.

## Records (freestyle + consecutive kicks)
- Curated inputs: `inputs/curated/records/records_master.csv` (freestyle trick records) + `inputs/consecutives_records.csv` (consecutive kicks). These are the authoritative source of truth; no pipeline regenerates them.
- Loaders: `event_results/scripts/10_load_freestyle_records_to_sqlite.py` + `11_load_consecutive_records_to_sqlite.py`. Both run from `scripts/reset-local-db.sh`. Pattern: `DELETE FROM` + `INSERT OR REPLACE` (fully idempotent).
- DB tables: `freestyle_records` + `consecutive_kicks_records`. Platform consumer: `/records` route via `recordsService`.
- No `out/records/` CSV export — no downstream consumer; raw curated CSVs and the DB are the two authoritative representations.

## Name variants
- Generator: `pipeline/identity/build_name_variants.py` reads four upstream sources (`inputs/identity_lock/Person_Display_Names_v1.csv`, `inputs/bap_data_updated.csv`, `out/canonical/persons.csv`, `overrides/person_aliases.csv`) and emits `inputs/name_variants.csv`. Deterministic; runs at Phase 2b of `run_v0_backbone`.
- `inputs/name_variants.csv` is **generated, not hand-curated**. Manual edits are clobbered on the next pipeline run. To add a pair, modify the upstream source (typically `overrides/person_aliases.csv`).
- Loader: `scripts/load_name_variants_seed.py`. Scoped `DELETE FROM name_variants WHERE source='mirror_mined'` + INSERT OR IGNORE. Only HIGH-confidence pairs inserted; MEDIUM → `out/name_variants_deferred.csv` (reported, not loaded).
- Honest counter: uses `conn.total_changes` to report actual inserts (not IGNORE'd rows).
- DB table: `name_variants` with PK `(canonical_normalized, variant_normalized)`, source `∈ {mirror_mined, admin_added, member_submitted}`.

## Persons layers in historical_persons
- `source_scope='CANONICAL'`: event-results-derived, owned by `08_load_mvfp_seed_full_to_sqlite.py`. DELETE+INSERT pattern.
- `source_scope='PROVISIONAL'`: club-only + membership-only cohorts (MIGRATION_PLAN §9.2), owned by `09_load_enrichment_to_sqlite.py`. `source` column distinguishes `CLUB` / `MEMBERSHIP` / `RESULTS`. DELETE WHERE source_scope='PROVISIONAL' + INSERT pattern; CANONICAL rows preserved.
- Identity locks are patch-toolchain only (`legacy_data/tools/patch_pt_*.py`, `legacy_data/tools/patch_placements_*.py`). Patches mutate `Persons_Truth_Final.csv` / `Placements_ByPerson.csv` in place; git log is the version trail.

## Loader invariants (applies to all DB-load scripts)
- DELETE+INSERT for pipeline-regenerated tables; never rely on `INSERT OR IGNORE` alone — it silently skips existing rows and does not propagate upstream changes.
- Scope the DELETE where multiple owners share a table (e.g. `DELETE WHERE source='mirror_mined'`, `DELETE WHERE source_scope='PROVISIONAL'`).
- Honest counter: `cur = conn.execute(...); inserted += (1 if cur.rowcount else 0)`. Raw `+= 1` after `INSERT OR IGNORE` double-counts IGNORE'd rows.
- Single transaction spans the DELETE + INSERT loop; commit once at the end.
- Loaders report counter-mismatch explicitly: every skipped row has a named category (dedup, FK miss, PK collision, bad row).

## MIGRATION_PLAN references (load targeted sections only)
- §2 + §8 — `legacy_members` structure, claim merge rules.
- §6 — Auto-link (registration-time tier classifier).
- §9.1 — Club classification R1–R10 rules.
- §9.2 — `historical_persons` expansion for club members (~1,600 cohort).
- §9.3 — Club onboarding flow stages 1–3 (platform Phase 4; not in this subtree).
- §14 — Required schema changes (club tables + `name_variants`).
- §14.16 — `name_variants` schema + contract.
- §18 — Legacy-site data dump requirements.
- §25 — Persons count baseline (historical figure; current state in IP "Already done").
