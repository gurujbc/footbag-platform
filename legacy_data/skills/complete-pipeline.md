# Skill: complete-pipeline

## When to Use
Invoke this skill when:
- Running the full pipeline from source data to SQLite DB (the normal production cycle)
- Adding or modifying any source (new image, curated CSV, override, identity supplement)
- Verifying the system end-to-end after any non-trivial change

Do NOT invoke this skill for:
- Quick targeted runs (use individual `./run_pipeline.sh rebuild|release|qc` as needed)
- Workbook-only changes (use `workbook-v22` skill)
- Identity lock upgrades (those have their own patch toolchain)

---

## The One Command

```bash
cd ~/projects/footbag-platform/legacy_data
./run_pipeline.sh complete
```

This runs all 7 stages in order and **fails fast on QC hard failures** — stages 5–7
(workbook, seed, DB) never run if QC returns a hard failure.

---

## Stage Order

| # | Name | What it does |
|---|------|--------------|
| 1 | Rebuild | Mirror + curated → stage2 canonical events |
| 2 | Release | Export `out/canonical/*.csv` + `canonical_input/` via `export_canonical_platform.py` |
| 3 | Supplement | `02p5b_supplement_class_b.py` — injects Class B rows into Placements_Flat (workbook completeness) |
| 4 | QC gate | `pipeline/qc/run_qc.py` — **exit 1 on hard failure; pipeline stops** |
| 5 | Workbook | `build_workbook_release.py` → `out/Footbag_Results_Release.xlsx` |
| 6 | Seed build | `event_results/scripts/07_build_mvfp_seed_full.py` → `event_results/seed/mvfp_full/` |
| 7 | DB load | `event_results/scripts/08_load_mvfp_seed_full_to_sqlite.py` → `database/footbag.db` |

**Why 02p5b runs after release (not after rebuild):**
`02p5b` reads from `event_results/canonical_input/` which is only populated by the
release step (`export_canonical_platform.py`). Running it before release produces
incomplete or stale data.

**Why 08 needs repo root:**
`08_load_mvfp_seed_full_to_sqlite.py` writes to `database/footbag.db` in the repo root.
`run_pipeline.sh` resolves `REPO_ROOT` automatically from the script's own location —
always invoke via `./run_pipeline.sh complete`, not directly.

---

## Outputs After a Successful Complete Run

| Output | Location |
|--------|----------|
| Canonical CSVs | `out/canonical/*.csv` |
| Platform-filtered CSVs | `event_results/canonical_input/*.csv` |
| Release workbook | `out/Footbag_Results_Release.xlsx` |
| Seed CSVs | `event_results/seed/mvfp_full/*.csv` |
| SQLite DB | `database/footbag.db` (repo root) |

---

## Integrating New Images / Curated Sources

```
1. Derive structured CSV → inputs/curated/events/structured/  (Variant A, B, or C)
2. New persons → inputs/identity_lock/Person_Display_Names_v1.csv
3. ./run_pipeline.sh complete
4. Inspect: git diff out/canonical/  and  git diff event_results/canonical_input/
5. Commit only if QC STATUS: PASS and counts are expected
```

See `promote-curated-source` skill for full promotion checklist.

---

## Do-Not-Regress Rules

- Never load the DB (stage 7) after a QC failure — `./run_pipeline.sh complete` enforces this.
- Never commit canonical outputs (`out/canonical/`, `event_results/canonical_input/`) with QC failing.
- Never run `02p5b` before release — it depends on `canonical_input/` being populated.
- Never skip the `rebuild` step before `release` — stale stage2 + fresh release = wrong outputs.
- Never edit `out/canonical/*.csv` directly — fix at source, then rebuild.
- Never modify identity lock files directly (`Persons_Truth_Final_v51.csv`, `Placements_ByPerson_v96.csv`).
