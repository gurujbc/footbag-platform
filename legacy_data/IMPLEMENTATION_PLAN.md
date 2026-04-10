# legacy_data/IMPLEMENTATION_PLAN.md

Tracks pipeline sprint status, known gaps, and the release checklist for the
historical data integration. This file governs scope and sequencing within `legacy_data/`.
The root `IMPLEMENTATION_PLAN.md` governs the broader platform sprint.

---

## Current status (as of 2026-04-10)

**soup2nuts PR merged.** Post-merge cleanup and canonical data bug fix complete.

### Completed since PR merge (2026-04-10)

- `run_pipeline.sh` v2: three modes (`canonical_only`, `enrichment_only`, `full`); brother's venv-detection loop merged in
- `run_pipeline.sh_V0` removed from git; `run_pipeline_reference.sh` kept untracked for reference
- `persons/out/` and `persons/provisional/out/` added to `.gitignore` (matching `clubs/out/`, `membership/out/`)
- **Fix 9 in `05p5_remediate_canonical.py`**: disambiguates bare division labels (e.g. "Open Singles" → "Open Singles Net") in multi-category events; 242 labels upgraded, QC PASS, platform DB updated
- `README.md` and `CLAUDE.md` updated: three pipeline modes documented

### What the PR delivered

- Full pipeline code merged into `legacy_data/` (Python scripts, QC, overrides, inputs, skills)
- Curated event CSVs (1980–1997) committed as authoritative source inputs
- Identity lock snapshots: `Persons_Truth_Final_v52`, `Placements_ByPerson_v97`
- `legacy_data/CLAUDE.md` and pipeline skills
- Generated outputs (`canonical_input/`, `seed/mvfp_full/`) removed from git tracking (gitignored)
- `db.ts` history listing filter simplified to `WHERE source_scope = 'CANONICAL'`
- Test factory fix: `insertHistoricalPerson` now defaults `source_scope = 'CANONICAL'`

### What is NOT yet done (sprint goals outstanding)

Per root `IMPLEMENTATION_PLAN.md §James's sprint`:

- [ ] Expanded `persons.csv` with ~1,600 club-only members
- [ ] Club pipeline: `legacy_club_candidates`, affiliations, confidence scoring, bootstrap eligibility
- [ ] `club_bootstrap_leaders` rows for bootstrap-eligible clubs
- [ ] Known name variants seeded (~290 pairs)
- [ ] World records CSV in platform-loadable format
- [ ] Legacy member identity extraction (`legacy_member_id`, `legacy_user_id`, `legacy_email`)
- [ ] Soup-to-nuts master script (`scripts/reset-local-db.sh` runs everything end-to-end)
- [ ] **Data review sign-off** (blocks members ungating)

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

Completing the release checklist unblocks:
- **Members ungating** (remove `requireAuth` from member-list routes)
- **World records page** (requires world records CSV in platform format)
- **Club bootstrap at cutover** (requires club pipeline output + leadership data)
- **Legacy account claim at registration** (requires legacy member identity extraction)
