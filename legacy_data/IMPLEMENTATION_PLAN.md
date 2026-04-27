# legacy_data/IMPLEMENTATION_PLAN.md

Historical-pipeline maintainer's track. Pipeline architecture, loader invariants, and MIGRATION_PLAN routing live in `legacy_data/CLAUDE.md`. This file tracks active work, current substitute mechanisms, external blockers, and release-readiness criteria only.

---

## Active work

Prioritized.

1. **Event key normalization (1982-1984).** Rule to lock: `event_key = YYYY_city_slug` with explicit overrides in `overrides/`. Source adjudication required for the 1982-1984 cluster (1980-1981 are clean). Risk if deferred past data release: duplicate logical events, broken joins, URL instability.

---

## Current substitute mechanisms

- **`legacy_members` population.** Mirror-derived via `legacy_data/scripts/load_legacy_members_seed.py` (2,507 rows; columns limited to PK + `display_name` + `import_source='mirror'`). Unblock: legacy-site data dump received.

---

## External blockers

- **Legacy-site data dump (legacy-site webmaster coordination).** Final source for `legacy_members`; supplies `real_name`, `legacy_email`, `legacy_user_id`, `country`, `city`, `region`, `bio`, `birth_date`, `ifpa_join_date`, `first_competition_year`, `is_hof`, `is_bap`, `legacy_is_admin`, and flips `import_source` to `'legacy_site_data'`. Open coordination: namespace agreement (export IDs and mirror-derived IDs must share the same `legacy_member_id` namespace); MIGRATION_PLAN §2 + §8 platform-side rewrites depend on the final dump structure; `tests/fixtures/factories.ts` may need extensions for the richer fields.
- **Freestyle rules content (IFPA).** Wording for Routine, Circle, Sick 3, Shred 30. Re-enables the "Rules" buttons dropped from `/freestyle` competition-format cards.
- **Data review sign-off.** Confirmation that legacy data is complete and member-list presentation is reviewed. Required before removing the `requireAuth` gate from member-list pages.

---

## Release-readiness criteria

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

## Unblocks

- Auto-link coverage for club-only members: gated on `legacy_email` (blocked on legacy-site data dump). `legacy_user_id` and `legacy_member_id` already in canonical persons.
- Legacy account claim at registration: gated on `legacy_email` for full three-key coverage (blocked on legacy-site data dump). `legacy_member_id` and `legacy_user_id` already in canonical persons.

---

## Deferred / parked work (non-blocking)

Kept for visibility only; not part of active work or release gating. No current substitute mechanism, no unblock dependency, no release-readiness impact. Promote to Active work only if scope or priority changes.

- **Rebuild orchestration gap in `scripts/reset-local-db.sh` (owner approval required).** `event_results/scripts/20_link_footbag_org_sources.py` consumes `legacy_data/out/scraped_footbag_moves.csv`, produced by `legacy_data/event_results/scripts/18_scrape_footbag_org_moves.py`. `scripts/reset-local-db.sh` runs step 20 but never step 18; on a fresh `out/` the rebuild crashes with `FileNotFoundError` (observed 2026-04-27 on a staging deploy; operator manually ran step 18 to unblock). `legacy_data/out/` is gitignored, so the file is operator-supplied; a fresh-clone operator must run step 18 manually before `reset-local-db.sh` succeeds. Documented risk; not part of this track's active work. `scripts/reset-local-db.sh` is owned by David, and any change requires owner approval. The fail-fast / producer-before-consumer pattern that landed in `run_pipeline.sh` (early preflight + marker-file mirror check) is the obvious model if the work reopens; companion follow-up would be a rebuild smoke test that starts from a clean `out/` and asserts every `out/*` consumer's producer ran earlier.

- **FK-off bulk reseed investigation.** `event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py:131` disables FK enforcement with `PRAGMA foreign_keys = OFF` during bulk delete-and-reload (re-enabled at line 534); only migration script that does so. Determine whether load order can be reordered or cascade-delete applied to preserve FK-on; if operationally necessary, add an explanatory comment at the deviation site.
- **`score_text` pass-through from legacy HTML.** Schema field exists (`event_result_entries.score_text`); pipeline drops it. Worth extracting: consecutives kick counts (e.g. `(826)`) and Sick 3 / routine trick descriptors. Skip generic point totals, judge scores, net rankings.
- **Workbook automated parity QC.** Lightweight check that `canonical/events.csv` row count == workbook EVENT INDEX row count == year-sheet event union. Today verified by hand against the release-readiness checklist.
- **Override visibility.** `results_file_overrides.csv` and `events_overrides.jsonl` are applied silently. Surface via an `is_overridden` boolean on canonical output or a Data Notes sheet in the workbook.
- **Canonical vs canonical_all unification.** Long-term: merge post-1997 + pre-1997 into a single `canonical` and retire `canonical_all`. Simplifies reasoning about the dataset.
- **Version stamps in outputs.** Add `build_version`, `build_date`, `identity_lock_version` to workbook and canonical CSVs. Eases diffing across builds.
- **DATA NOTES sheet in workbook.** Document excluded events (sparse), sources used, and the meaning of "unknown" in placement columns.
