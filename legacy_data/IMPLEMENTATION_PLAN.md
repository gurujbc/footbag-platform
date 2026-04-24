# legacy_data/IMPLEMENTATION_PLAN.md

Historical pipeline integration sprint. Source of truth for the historical-pipeline maintainer's track; the root `IMPLEMENTATION_PLAN.md` links here rather than duplicating. Scope: events, results, persons, clubs, classification, bootstrap leaders, records, variants, legacy identity columns.

---

## Already done

- **Pipeline merged**: `legacy_data/pipeline/`, `legacy_data/scripts/`, `legacy_data/event_results/`
- **Events + results + persons soup-to-nuts**: `legacy_data/run_pipeline.sh full` runs mirror + curated → canonical → QC → workbook → seed → DB
- **Club extract/load scripts wired**: `extract_clubs.py`, `load_clubs_seed.py`, `extract_club_members.py`, `load_club_members_seed.py` run from `scripts/reset-local-db.sh`; produces `seed/clubs.csv` (1,035 rows) and `seed/club_members.csv` (2,399 rows); loads `clubs` and `legacy_person_club_affiliations`
- **Club candidate + confidence pipeline wired**: `clubs/scripts/02_build_legacy_club_candidates.py` produces a candidate CSV with `confidence_score`; `event_results/scripts/09_load_enrichment_to_sqlite.py` loads into `legacy_club_candidates` (311 rows in current DB). Scripts `03_build_legacy_person_club_affiliations.py` and `04_build_club_bootstrap_leaders.py` also exist but leader table is empty today (see Still to do items 2 and 3).
- **Net enrichment subsystem**: schema tables (`net_team`, `net_team_member`, `net_team_appearance`, `net_discipline_group`, `net_stat_policy`, `net_review_queue`, `net_team_appearance_canonical` view); scripts 12/13/14 under `legacy_data/event_results/scripts/`; `run_pipeline.sh net_enrichment` mode; TypeScript layer: `netService.ts`, `netController.ts`, `/net/teams` and `/net/teams/:teamId` routes, `src/views/net/` templates, Nav link; DB seeded with 4,176 teams, ~7,300 appearances, 607 QC review items
- **`legacy_data/CLAUDE.md`**: exists; currently scoped to events/results/persons pipeline only
- **`legacy_data/skills/`**: directory exists

---

## Still to do

1. **Club-only persons extraction** (~1,600): people who appear in mirror only as club members. Prerequisite for classification (per `docs/MIGRATION_PLAN.md §9.1`).
2. **Club classification** per `docs/MIGRATION_PLAN.md §9.1` R1–R9. Deterministic classifier → pre-populate / onboarding-visible / dormant / junk. Current `02_build_legacy_club_candidates.py` sets `bootstrap_eligible` via a placeholder heuristic (`confidence_score >= 0.55 AND mirror_member_id_count >= 1 AND linkable_member_count >= 1`); 0 of 311 candidates qualify today. Replace with the §9.1 R1–R9 rules (hosted-event-in-2020+, page-updated-2020+, contact-competed-2020+, etc.) which require joining hosted-event year and contact-member last_year.
    - **Contact-member-ID extraction (upstream prerequisite for R3/R4/R5).** `legacy_data/scripts/extract_clubs.py` currently captures only `contact_email` from `div.clubsContacts`; the `members/profile/{id}` link is dropped. `02_build_legacy_club_candidates.py` therefore substitutes "any affiliated member with last_year >= 2020" for "contact competed 2020 or later" and sets `contact_signal_substitute_applied=1` per row. Fix: extend `extract_clubs.py` to capture contact `legacy_member_id`, expose it in `seed/clubs.csv`, and swap the predicate in `02_build_legacy_club_candidates.py` to use the actual contact ID. Until done, R3/R4/R5 classification of up to 54 contact-bearing clubs may be inflated or deflated.
3. **Club cutover + leadership inference** (two ordered deliverables for go-live; G13 gate):
    - **3a. Pre-populated clubs cutover script**: take `legacy_club_candidates` rows where `classification = 'pre_populate'` and insert matching live `clubs` rows, setting `legacy_club_candidates.mapped_club_id` to the new `clubs.id` for audit. No script exists today; design needed. Prerequisite for 3b because bootstrap leaders FK to live `clubs.id`.
    - **3b. Bootstrap leaders loader**: populate `club_bootstrap_leaders` for pre-populated clubs with `confidence_score >= 0.70` (MIGRATION_PLAN §2). Script `04_build_club_bootstrap_leaders.py` already produces the CSV and filters on `bootstrap_eligible=1`; empty in DB today because no candidate is marked eligible (see item 2). DB loader script missing; add `load_club_bootstrap_leaders.py` analogous to `load_legacy_members_seed.py`.
4. **Legacy identity columns** on persons: add `legacy_user_id` and `legacy_email` to canonical persons CSV where mirror provides them. Claim flow needs all three keys.
5. **Name variants table seed** (~290 pairs). Schema exists (`name_variants` in `database/schema.sql`; documented in DATA_MODEL §4.26 and MIGRATION_PLAN §14.16). Pipeline scripts already encode variant knowledge across `legacy_data/inputs/identity_lock/Person_Display_Names_v1.csv`, `legacy_data/overrides/person_aliases.csv`, and workbook builders (`pipeline/04B_create_community_excel.py`, `persons/scripts/05_build_persons_master.py`). Work: extract/curate the ~290 canonical pairs, add a loader script (analogous to `load_legacy_members_seed.py`) that inserts into `name_variants`, and wire it into `run_pipeline.sh full`. Unblocks registration-time auto-link (root IP §Open production-rewrite item) and ongoing claim-time prompts (MIGRATION_PLAN §6).
6. **World records CSV export**: 166 tricks in records data; no `out/records/` export in repo yet. Unblocks `/records`.
7. **Persons count reconciliation**: canonical `persons.csv` has 3,366 rows; MIGRATION_PLAN §25 says ~4,861. Reconcile.
8. **Extend `legacy_data/CLAUDE.md`**: add sections for clubs, classification, bootstrap, records, variants, `docs/MIGRATION_PLAN.md` refs.
9. **Integrate into `run_pipeline.sh full`**: today `full` stops at events/results/persons; extend to produce clubs (classified), bootstrap leaders, club-only persons, variants, records. `scripts/reset-local-db.sh` then collapses to a one-liner.
10. **Data review sign-off**: confirm legacy data is complete and member-list presentation is reviewed.
11. **Freestyle rules pages**: content for the four competition formats (Routine, Circle, Sick 3, Shred 30) — template(s) and route(s) for `/freestyle/rules` (single page with anchors, or per-format paths). Unblocks re-enabling the "Rules" buttons that were dropped from `/freestyle` landing competition-format cards.
12. **Legacy-site data dump (legacy-site webmaster coordination)** — final source for `legacy_members`. Current population is from `legacy_data/scripts/load_legacy_members_seed.py` (mirror-derived, 2,507 rows, columns limited to PK + `display_name` + `import_source='mirror'`). The legacy-site dump supersedes with full profile fields (`real_name`, `legacy_email`, `legacy_user_id`, `country`, `city`, `region`, `bio`, `birth_date`, `ifpa_join_date`, `first_competition_year`, `is_hof`, `is_bap`, `legacy_is_admin`) and flips `import_source` to `'legacy_site_data'`. Outstanding coordination:
    - **Namespace agreement.** The legacy-account export and mirror-derived IDs must use the same `legacy_member_id` namespace (same IDs for same real-world accounts). If they diverge, resolve before loading the export.
    - **MIGRATION_PLAN §2 + §8.** The platform-side doc rewrites (imported rows live in `legacy_members`; claim marks rather than deletes the legacy record) depend on the final dump structure. Coordinate before rewrites land.
    - **Test fixture support.** `tests/fixtures/factories.ts` already has a `legacy_members` factory and auto-creates stub rows on HP insert; additional richer fields in the legacy-account export may warrant factory extensions.

**Dependency order (Still to do):**
- 1 → 2 → 3a → 3b (club-only persons → classification → pre-populated clubs cutover → bootstrap leaders)
- 1 → 7 (persons count reconciliation validates the pipeline)
- 3 + 6 → 9 (full-mode pipeline integration)
- 1 + 2 + 3 + 4 + 5 + 7 → 10 (data review sign-off)
- 4, 5, 6, 12 independent (item 5 seeding independent; classification accuracy in item 2 reuses item 1 outputs)
- 8, 11 low-priority, independent

---

## Deliverables (remaining)

- Expanded canonical `persons.csv` with club-only persons + `legacy_user_id` / `legacy_email`
- `legacy_club_candidates` rows with `bootstrap_eligible` per §9.1
- `club_bootstrap_leaders` rows for pre-populated clubs ≥0.70 confidence
- Name variants seed file + schema
- World records CSV in platform format
- `run_pipeline.sh full` as single soup-to-nuts entry point
- Extended `legacy_data/CLAUDE.md`
- Data review sign-off

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

**H2 — Event key normalization (1982–1986)**
The 1982–1986 standardization is deferred but not trivial. Risk: duplicate logical
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
