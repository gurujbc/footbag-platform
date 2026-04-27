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

**Top priority, fix first.** `run_pipeline.sh:214` references `inputs/identity_lock/Persons_Truth_Final_v53.csv` which is not committed to this repo (only `Persons_Truth_Final_v52.csv` is). On a fresh clone the `--from-mirror` path crashes during phase 2 rebuild (`02p5_player_token_cleanup.py`), and the AWS deploy `bash deploy_to_aws.sh --with-db --from-mirror` is therefore operator-local only. The mirror-free deploy path (`--with-db --from-csv`) is unaffected and is the documented fallback while this is open.

**Refactor directive: drop the version-number suffixes from identity-lock filenames.** Git already tracks history, so `Persons_Truth_Final_v52.csv` / `Persons_Truth_Final_v53.csv` / `Placements_ByPerson_v97.csv` / `Persons_Unresolved_Organized_v27.csv` / `Persons_Unresolved_Organized_v28.csv` / `Person_Display_Names_v1.csv` should all become version-free names (e.g. `Persons_Truth_Final.csv`, `Placements_ByPerson.csv`). This eliminates the entire class of "script references vN, repo has vM" drift. Update every consumer (`run_pipeline.sh`, `run_pipeline_reference.sh`, `02p5_player_token_cleanup.py`, anything else grep finds) in the same change. This refactor closes the immediate v52/v53 issue above as a side effect.

The historical-pipeline maintainer should be grilled on this before the refactor lands. Question set Claude can drive when re-engaged on this item:
1. Patch toolchain — does `legacy_data/tools/patch_pt_v{N}_*.py` / `patch_placements_v{M}_*.py` still need to lookup files by version glob? If yes, where does the version live after the rename (sidecar `.version` file, frontmatter row, git tag)?
2. Lexicographic-max-version selection (per `legacy_data/CLAUDE.md` "Lock file glob picks lexicographic max version") — what replaces this lookup once filenames are stable?
3. Audit trail — when a lock is regenerated, how is the prior content recoverable? `git log --follow inputs/identity_lock/Persons_Truth_Final.csv` plus signed commit messages, or a separate `inputs/identity_lock/CHANGELOG.md`?
4. Cross-repo references — any external consumer (downstream tooling, exports, partner systems) that hard-codes a versioned filename? Sweep the repo and any sister repos before renaming.
5. Cutover plan — atomic single-commit rename + every-consumer-update, or staged with a transitional symlink? Recommend single-commit-atomic given consumer count is small.

1. **Legacy identity columns** on persons: add `legacy_user_id` and `legacy_email` to canonical persons CSV where mirror provides them. Claim flow needs all three keys.
2. **Pipeline unification (re-scoped)**: ensure `run_pipeline.sh full` is a complete, self-contained soup-to-nuts data pipeline from mirror → canonical → QC → workbook → seed → DB load. `run_pipeline.sh` owns all data generation and DB population steps; eliminate hidden dependencies on prior `scripts/reset-local-db.sh` runs (e.g. preflight requiring `seed/clubs.csv` / `seed/club_members.csv` that no pipeline-internal step produced). Add mirror extraction (Phase B) and clubs DB load into the pipeline. Explicit non-goals: do NOT modify `scripts/reset-local-db.sh`, do NOT modify AWS/deploy scripts, do NOT collapse DB lifecycle into the pipeline. `reset-local-db.sh` serves a distinct fast-deploy role in the AWS staging pipeline (called from `scripts/deploy-rebuild.sh`) and must remain independent.
3. **Data review sign-off**: confirm legacy data is complete and member-list presentation is reviewed.
4. **Freestyle rules pages**: content for the four competition formats (Routine, Circle, Sick 3, Shred 30) — template(s) and route(s) for `/freestyle/rules` (single page with anchors, or per-format paths). Unblocks re-enabling the "Rules" buttons that were dropped from `/freestyle` landing competition-format cards.
5. **Legacy-site data dump (legacy-site webmaster coordination)** — final source for `legacy_members`. Current population is from `legacy_data/scripts/load_legacy_members_seed.py` (mirror-derived, 2,507 rows, columns limited to PK + `display_name` + `import_source='mirror'`). The legacy-site dump supersedes with full profile fields (`real_name`, `legacy_email`, `legacy_user_id`, `country`, `city`, `region`, `bio`, `birth_date`, `ifpa_join_date`, `first_competition_year`, `is_hof`, `is_bap`, `legacy_is_admin`) and flips `import_source` to `'legacy_site_data'`. Outstanding coordination:
    - **Namespace agreement.** The legacy-account export and mirror-derived IDs must use the same `legacy_member_id` namespace (same IDs for same real-world accounts). If they diverge, resolve before loading the export.
    - **MIGRATION_PLAN §2 + §8.** The platform-side doc rewrites (imported rows live in `legacy_members`; claim marks rather than deletes the legacy record) depend on the final dump structure. Coordinate before rewrites land.
    - **Test fixture support.** `tests/fixtures/factories.ts` already has a `legacy_members` factory and auto-creates stub rows on HP insert; additional richer fields in the legacy-account export may warrant factory extensions.
6. **Audit and clean this file** (top of current sprint; do first). Apply these rules:
    - IP is AI-facing: delete completed items outright (no "Already done" tombstone log). Architecture facts that still help AI orient go to `legacy_data/CLAUDE.md` if not already there.
    - Anything narrower than `docs/USER_STORIES.md` / `docs/DESIGN_DECISIONS.md` / `docs/MIGRATION_PLAN.md` is implicit future work; do not enumerate.
    - Keep only: active work, current substitute mechanisms (with unblock conditions), external blockers, release-readiness criteria.
    - Cutover-revert items go in `docs/MIGRATION_PLAN.md` §28.8, not here.
    - No em dashes in prose; no emojis.

    Specific findings already identified (apply each):
    1. Delete entire "Already done" section (currently 13 bullets). Move any architectural detail still useful for AI orientation to `legacy_data/CLAUDE.md`; most is already there.
    2. Delete "Deliverables (remaining)". Duplicates "Still to do"; contains stale items (records CSV and extended CLAUDE.md are done).
    3. Audit "Unblocks". World records page is live with data; club bootstrap is loaded by Phase H of `run_pipeline.sh`; "Members ungating" gating actually uses `hof_member || bap_member` flag per `src/services/historyService.ts:121`, not data-review sign-off. Prune accordingly.
    4. Consolidate three overlapping work lists ("Still to do" / "Release checklist" / "Known gaps and follow-up items") into one prioritized list.
    5. Delete L1, L2, L3 in "Known gaps". Pure long-term improvements (canonical_all merge, version stamps, DATA NOTES sheet) with no current substitute mechanism.
    6. Delete "Low-priority: score_text pass-through" section. Deferred enhancement, no AI-now value.
    7. Move H1 VISIBLE_PERSON definition into `docs/DESIGN_DECISIONS.md` or `docs/DATA_MODEL.md`; it is a design rule, not a to-do.
    8. Reframe release-checklist heading: drop "before members ungating" wording (gate is HoF/BAP-flag based per code, not data-review).
    9. Tighten "Still to do" items 2 and 5. Coordination context can collapse to 1-2 lines plus unblock condition.
    10. Match root-IP intro style: one line of purpose plus pointer to `legacy_data/CLAUDE.md` for pipeline architecture.

    Workflow: propose changes one at a time, show literal before/after for each, await human approval per change. Never edit docs without explicit human approval. Target: ~60-70 lines (from 185). Delete this item 6 as the final step.

7. **Rebuild pipeline orchestration gap + test coverage.** `event_results/scripts/20_link_footbag_org_sources.py` consumes `legacy_data/out/scraped_footbag_moves.csv`, produced by `18_scrape_footbag_org_moves.py`. `scripts/reset-local-db.sh` runs step 20 but never step 18; the rebuild crashes mid-pipeline against a fresh `legacy_data/out/`. Surfaced 2026-04-27 during a staging deploy on Dave's track: `--with-db --db-only` failed at step 20 with `FileNotFoundError`, operator manually ran step 18 (HTTP scrape of footbag.org) to unblock. Same shape as item 2's "hidden dependencies on prior runs" pattern. Fix options (item 2 constraint forbids editing `reset-local-db.sh`): make step 20 graceful on missing input (no-op + warn) OR have the producer (step 18) run earlier in the orchestrator that calls step 20. **Test coverage ask (separate item, same root cause):** no integration test runs the rebuild end-to-end against a clean `legacy_data/out/`. Add a rebuild smoke test that (a) starts from a clean `out/`, (b) runs the full chain to completion, (c) asserts every `out/*` consumer's producer ran earlier so missing-input crashes surface in CI rather than during a staging deploy. Generalize the pattern: any step that reads `out/*` must either declare its producer or fail with a clear preflight error.

**Dependency order (Still to do):**
- 6 unblocked; do first (file cleanup precursor that surfaces the real state of the rest).
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
