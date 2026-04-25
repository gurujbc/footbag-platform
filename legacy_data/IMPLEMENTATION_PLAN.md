# legacy_data/IMPLEMENTATION_PLAN.md

Historical pipeline integration sprint. Source of truth for the historical-pipeline maintainer's track; the root `IMPLEMENTATION_PLAN.md` links here rather than duplicating. Scope: events, results, persons, clubs, classification, bootstrap leaders, records, variants, legacy identity columns.

---

## Already done

- **Pipeline merged**: `legacy_data/pipeline/`, `legacy_data/scripts/`, `legacy_data/event_results/`
- **Events + results + persons soup-to-nuts**: `legacy_data/run_pipeline.sh full` runs mirror + curated → canonical → QC → workbook → seed → DB
- **Club extract/load scripts wired**: `extract_clubs.py`, `load_clubs_seed.py`, `extract_club_members.py`, `load_club_members_seed.py` run from `scripts/reset-local-db.sh`; produces `seed/clubs.csv` (1,035 rows) and `seed/club_members.csv` (2,399 rows); loads `clubs` and `legacy_person_club_affiliations`
- **Club candidate + confidence pipeline wired**: `clubs/scripts/02_build_legacy_club_candidates.py` produces a candidate CSV with §9.1 R1–R10 buckets (59 pre_populate / 106 onboarding_visible / 112 dormant / 34 junk); `event_results/scripts/09_load_enrichment_to_sqlite.py` loads 311 rows into `legacy_club_candidates` with DELETE+INSERT so classifier changes propagate (prior INSERT OR IGNORE pattern silently skipped re-runs). Scripts `03_build_legacy_person_club_affiliations.py` and `04_build_club_bootstrap_leaders.py` produce CSVs.
- **Pre-populated clubs cutover + bootstrap leaders loaded**: Phase H of `run_pipeline.sh full` runs (1) `clubs/scripts/06_cutover_pre_populated_clubs.py` — sets `legacy_club_candidates.mapped_club_id` on all 59 bootstrap-eligible candidates, ensures matching `clubs` rows exist; (2) `clubs/scripts/07_load_bootstrap_leaders.py` — loads `club_bootstrap_leaders` (80 rows, DELETE+INSERT, cur.rowcount-accurate counters) across 54 distinct clubs (54 leaders + 26 co-leaders). Club FK via `legacy_club_candidates.mapped_club_id` → `clubs.id`; person validation against `historical_persons.person_id`. No silent skipping.
- **Records pipeline (freestyle + consecutive kicks)**: curated inputs (`legacy_data/inputs/curated/records/records_master.csv`, 206 rows; `legacy_data/inputs/curated/records/consecutives_records.csv`, 138 rows) already load into `freestyle_records` (204 rows) and `consecutive_kicks_records` (138 rows) via `10_load_freestyle_records_to_sqlite.py` + `11_load_consecutive_records_to_sqlite.py` in `scripts/reset-local-db.sh`. `/records` route is live and reads these tables directly via `recordsService`. No `out/records/` CSV export added because no consumer exists — the raw curated CSVs are authoritative, and the DB is the runtime source of truth.
- **Contact-member-ID extraction**: `legacy_data/scripts/extract_clubs.py` now parses `div.clubsContacts > a[href=".../members/profile/{ID}/..."]` and emits `contact_member_id` alongside `contact_email` in `seed/clubs.csv`. `legacy_data/clubs/scripts/02_build_legacy_club_candidates.py` consumes it via new helper `compute_contact_member_last_year()` (joins contact_member_id → affiliations.mirror_member_id → matched_person_id → person_universe.last_year) and `classify_row()` uses real data when present, substitute (`any_member_active_2020_plus`) only when `contact_member_id` is empty. `contact_signal_substitute_applied=1` now fires only for rows that (a) lack contact_member_id AND (b) relied on the substitute for an R3/R4/R5 hit. Backward-compatible: if `seed/clubs.csv` lacks the column (e.g. un-regenerated), the classifier falls through to substitute for every row and the pre-fix behavior is preserved (59 pre_populate / 106 onboarding_visible / 112 dormant / 34 junk, 57 substitute-applied). Full-mirror re-extraction needed to realize the tighter classification at scale.
- **Club-only and membership-only persons in historical_persons**: Phases D→E→F→G extract + load MIGRATION_PLAN §9.2 cohorts. `clubs/scripts/05_build_club_only_persons.py` produces 1,720 club-only rows; `persons/provisional/scripts/01_build_provisional_persons_master.py` merges with membership-only; `persons/scripts/05_build_persons_master.py` emits 1,987 PROVISIONAL entries into `persons_master.csv`. Phase G's fixed DELETE+INSERT loader lands 1,740 of them (1,464 `source='CLUB'`, 276 `source='MEMBERSHIP'`, all `source_scope='PROVISIONAL'`). 247-row attrition is explicit: 232 name-dedup against canonical + 3 PID-collision + ~12 interim-CSV reconciliation. Current count meets §9.2's "~1,600" target.
- **Persons count reconciliation (closed)**: MIGRATION_PLAN §9.2 / §25 reference ~4,861 canonical persons. Current pipeline produces: 3,591 canonical (event-results, post-VISIBLE_PERSON filter) + 1,740 provisional (club + membership) = 5,361 total `historical_persons`. The 4,861 figure reflects an older pipeline state (pre-identity consolidation and pre-PROVISIONAL split). No data loss is observed; current counts are consistent with design. No code changes required. This is documentation drift.
- **Name variants seed (closed)**: `name_variants.csv` is generated by `build_name_variants.py` from upstream sources: display names, BAP data, canonical persons, alias registry. Current state: 302 HIGH-confidence pairs (meets target ~290) + 77 MEDIUM deferred (intentionally excluded). Loader is implemented, idempotent, and wired into pipeline. Manual curation of `name_variants.csv` is not applicable; updates must occur in upstream sources. No further pipeline work required.
- **`legacy_data/CLAUDE.md` extended**: added sections for Clubs + classification + bootstrap, Records, Name variants, Persons layers, Loader invariants (DELETE+INSERT, honest counters), and MIGRATION_PLAN §2/§6/§8/§9.1/§9.2/§9.3/§14/§14.16/§18/§25 references. Existing Scope / Source of Truth / Pipeline + DB Invariants / Non-negotiable rules sections left unchanged.
- **Net enrichment subsystem**: schema tables (`net_team`, `net_team_member`, `net_team_appearance`, `net_discipline_group`, `net_stat_policy`, `net_review_queue`, `net_team_appearance_canonical` view); scripts 12/13/14 under `legacy_data/event_results/scripts/`; `run_pipeline.sh net_enrichment` mode; TypeScript layer: `netService.ts`, `netController.ts`, `/net/teams` and `/net/teams/:teamId` routes, `src/views/net/` templates, Nav link; DB seeded with 4,176 teams, ~7,300 appearances, 607 QC review items
- **`legacy_data/CLAUDE.md`**: exists; currently scoped to events/results/persons pipeline only
- **`legacy_data/skills/`**: directory exists

---

## Still to do

1. **Legacy identity columns** on persons: add `legacy_user_id` and `legacy_email` to canonical persons CSV where mirror provides them. Claim flow needs all three keys.
2. **Integrate into `run_pipeline.sh full`**: today `full` stops at events/results/persons; extend to produce clubs (classified), bootstrap leaders, club-only persons, variants, records. `scripts/reset-local-db.sh` then collapses to a one-liner.
3. **Data review sign-off**: confirm legacy data is complete and member-list presentation is reviewed.
4. **Freestyle rules pages**: content for the four competition formats (Routine, Circle, Sick 3, Shred 30) — template(s) and route(s) for `/freestyle/rules` (single page with anchors, or per-format paths). Unblocks re-enabling the "Rules" buttons that were dropped from `/freestyle` landing competition-format cards.
5. **Legacy-site data dump (legacy-site webmaster coordination)** — final source for `legacy_members`. Current population is from `legacy_data/scripts/load_legacy_members_seed.py` (mirror-derived, 2,507 rows, columns limited to PK + `display_name` + `import_source='mirror'`). The legacy-site dump supersedes with full profile fields (`real_name`, `legacy_email`, `legacy_user_id`, `country`, `city`, `region`, `bio`, `birth_date`, `ifpa_join_date`, `first_competition_year`, `is_hof`, `is_bap`, `legacy_is_admin`) and flips `import_source` to `'legacy_site_data'`. Outstanding coordination:
    - **Namespace agreement.** The legacy-account export and mirror-derived IDs must use the same `legacy_member_id` namespace (same IDs for same real-world accounts). If they diverge, resolve before loading the export.
    - **MIGRATION_PLAN §2 + §8.** The platform-side doc rewrites (imported rows live in `legacy_members`; claim marks rather than deletes the legacy record) depend on the final dump structure. Coordinate before rewrites land.
    - **Test fixture support.** `tests/fixtures/factories.ts` already has a `legacy_members` factory and auto-creates stub rows on HP insert; additional richer fields in the legacy-account export may warrant factory extensions.

**Dependency order (Still to do):**
- 1 → 3 (legacy identity columns → data review sign-off).
- 1 blocked on 5 (legacy-site dump).
- 2 independent.
- 4 blocked on external IFPA wording.

---

## Deliverables (remaining)

- Canonical `persons.csv` extended with `legacy_user_id` / `legacy_email` (club-only/membership-only persons already in DB via Phase G).
- World records CSV in platform format.
- `run_pipeline.sh full` as single soup-to-nuts entry point.
- Extended `legacy_data/CLAUDE.md`.
- Data review sign-off.

---

## Low-priority: score_text pass-through from legacy HTML

UI renders `score_text` per result row when present. Schema field exists (`event_result_entries.score_text`) but pipeline drops it; 1 of 26,210 entries has a value today. Legacy HTML has extractable data worth passing through:

- **Consecutives / DDOP**: kick counts in parentheses after player names, e.g. "(826)". Clean, consistent format. Extract as "826 kicks". Present post-1996. Pre-1997 sources have placements only.
- **Specific freestyle categories** (Sick 3, routine trick lists): trick names / short descriptions where source HTML is consistent.

Skip generic point totals, judge scores, net rankings. Canonical CSV schema has `score_text` + `notes` (`event_results.csv`), both empty today. Mirror/curated adapters would populate. DB seed scripts already carry the field through. Not blocking.

---

## Next sprint

- **Investigate FK-off in bulk reseed.** `legacy_data/event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py:131` disables FK enforcement with `PRAGMA foreign_keys = OFF` during bulk delete-and-reload (re-enabled at line 534). Only migration script that does so. Determine whether load order can be reordered or cascade-delete applied so FK-on is preserved throughout; if operationally necessary, add an explanatory comment at the deviation site per doc-governance temp-shortcut rule (state: what, why, rollback pattern, re-enable location).
- **Decide `recordsService` scope (records routing on the platform side).** Code currently has a single `recordsService` that reads both `consecutive_kicks_records` and `freestyle_records` for the live `/records` route. `docs/SERVICE_CATALOG.md §4.5` is still titled `ConsecutiveService`, scoped to consecutive only, and states "Does not own any other sport domain." These are root IP catalog-audit sub-items (e) and (i), deferred here because the scope answer depends on the shape James wants `/records` to take as more record sources land (freestyle tricks, consecutive kicks, potentially net records). Two realistic directions: **(A)** narrow the code — keep `ConsecutiveService` as named, move freestyle passback reads into `freestyleService`, accept that `/records` becomes a thin aggregator controller that calls multiple services; **(B)** confirm the cross-sport "records" service intent — rewrite SC §4.5 as `RecordsService` scoped to the `/records` route and document the cross-table read contract. Maintainer recommendation before deferral was (B), since `/records` is already route-plural and aggregating across sport domains is what the page is for. When James picks a direction, the root-IP catalog-audit sub-list (e)+(i) close in one pass (SC rewrite for (B), or code split for (A)).

---

## Release checklist (required before members ungating)

These must all pass before the `requireAuth` gate is removed from member-list pages.

### Data integrity

- [ ] QC STATUS: PASS (0 hard failures from `qc/qc_master.py`)
- [ ] No unexpected row count drops vs previous identity lock version
- [ ] No new NULL `person_id` spikes in participants

### Workbook

- [ ] INDEX event count == `canonical/events.csv` row count
- [ ] No empty year sheets
- [ ] Worlds events correctly labeled (`event_type = worlds`)

### Identity

- [ ] No duplicate `person_canon` values in persons truth
- [ ] No alias leakage into `persons.csv`

### Platform DB

- [ ] Event count in DB matches canonical events CSV
- [ ] Sample event pages load correctly
- [ ] Player pages resolve (no orphan historical person IDs)

---

## Known gaps and follow-up items

Priority order for post-PR work:

### High (before data release)

**H1 — Person filtering parity**
Workbook and platform DB must agree on who is visible. Define explicitly:

```
VISIBLE_PERSON =
  referenced in event_result_participants
  OR has legacy_member_id / BAP flag / HOF flag
```

Enforce this definition in both the workbook builder and the platform export script.
Risk: workbook shows person A, platform does not → user confusion.

**H2 — Event key normalization (1982–1984)**
The 1982–1984 standardization is deferred but not trivial. Risk: duplicate logical
events, broken joins, URL instability on the platform. Lock the rule now:

```
event_key = YYYY_city_slug   (exceptions explicitly listed in overrides/)
```

Fix once, freeze. Do not let this linger past the data release.

### Medium (before or shortly after data release)

**M1 — QC check: workbook INDEX == canonical**
Add a lightweight QC check that counts:
- events in `canonical/events.csv`
- events in workbook EVENT INDEX sheet
- events in workbook year sheets (as a subset check)

Add as a QC warning in `qc/qc_master.py` or a dedicated `qc_workbook_parity.py`.

**M2 — Override visibility**
`results_file_overrides.csv` and `events_overrides.jsonl` are applied silently.
Consider adding `is_overridden` (boolean) to canonical output, or at minimum
a Data Notes sheet in the workbook listing applied overrides.
Increases transparency and credibility of the dataset.

**M3 — `legacy_club_candidates.classification` column**
Upstream pipeline writes a four-value `category` per row (pre_populate,
onboarding_visible, dormant, junk) but the DB load drops it because the
schema has no destination column. Registration Stage 2 needs this
distinction at runtime; dormant is not separable from junk. A schema-site
comment on `legacy_club_candidates` documents the gap in the interim.

Fix requires:
- add `classification TEXT NOT NULL CHECK (classification IN
  ('pre_populate','onboarding_visible','dormant','junk'))` column to
  `database/schema.sql`
- extend the INSERT in `event_results/scripts/09_load_enrichment_to_sqlite.py`
  to carry CSV `category` through (DB column name differs from CSV column name)
- update `tests/fixtures/factories.ts::insertLegacyClubCandidate` with an
  optional override, defaulting to `'junk'`
- add schema round-trip + CHECK-constraint integration tests

### Low / deferred

**L1 — Canonical vs canonical_all fragmentation**
The early pipeline produces `canonical_all` as a superset. Long-term goal:
unify into a single `canonical` (post-1997 + pre-1997 merged) and retire `canonical_all`.
Not urgent but will simplify reasoning about the dataset.

**L2 — Version stamps in outputs**
Add `build_version`, `build_date`, and `identity_lock_version` to workbook and
canonical CSVs. Makes debugging future diffs much easier.

**L3 — DATA NOTES sheet in workbook**
Document what is excluded (sparse events), what sources are used, and what
"unknown" means in placement columns. Saves repeated questions.

---

## Unblocks

- Members ungating (requires data review sign-off)
- World records page (requires records CSV)
- Club bootstrap at cutover (requires classification + leader population)
- Auto-link coverage for club-only members (requires expanded persons.csv)
- Legacy account claim at registration (requires three-key coverage)
