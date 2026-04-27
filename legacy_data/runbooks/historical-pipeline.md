# Skill: historical-pipeline
## Positioning
This is a **specialist/debugging skill**.

For normal operation, always use `complete-pipeline`.

Use this skill only when:
- isolating a stage
- debugging QC failures
- validating targeted changes
## When to Use
Invoke this skill when:
- Rebuilding canonical outputs after a parser fix, override change, or curated CSV addition
- Validating that a change to pipeline code, overrides, or identity lock did not break QC
- Preparing a release-ready canonical dataset
- Running the full soup-to-nuts pipeline (use `./run_pipeline.sh full`)

Do NOT invoke this skill for:
- Adding a new pre-1997 source (use `promote-curated-source` instead)
- Identity lock version upgrades (those have their own patch toolchain)
- Workbook generation alone — use the `workbook-v22` skill; but note that
  `./run_pipeline.sh full` builds the workbook as part of the full pipeline
- Platform/DB export alone — scripts 07 and 08 run automatically inside
  `./run_pipeline.sh full`; see CLAUDE.md "Platform / DB Export" for manual invocation

---

## Inputs Expected
- A working pipeline checkout with `.venv/` available
- At minimum one of: modified parser (`pipeline/02_canonicalize_results.py`), modified
  override file, or new curated CSV in `inputs/curated/events/structured/`
- No uncommitted changes to `out/canonical/` (pipeline outputs should be clean before rebuild)

---

## Safe Workflow

### Full pipeline (preferred — one command)

```bash
cd ~/projects/footbag-platform/legacy_data

# Baseline before running
wc -l out/canonical/*.csv

# Complete pipeline: rebuild → release → supplement → QC → workbook → seed → DB
# Fails fast on QC hard failures (stages 5–7 never run if QC fails)
./run_pipeline.sh full

# Diff canonical outputs to confirm expected delta
wc -l out/canonical/*.csv
git diff --stat out/canonical/
```

### Targeted rebuild (when you only need canonical outputs, not workbook/DB)

```bash
# Step 1: Baseline current outputs
wc -l out/canonical/*.csv

# Step 2: Full rebuild (parse mirror + curated → stage2)
./run_pipeline.sh rebuild

# Step 3: Apply identity lock + export canonical CSVs
./run_pipeline.sh release

# Step 4: QC gate — must return PASS before proceeding
.venv/bin/python pipeline/qc/run_qc.py

# Step 5: Diff canonical outputs to confirm expected delta
wc -l out/canonical/*.csv
git diff --stat out/canonical/
```

---

## Validation Steps
1. `QC STATUS: PASS` — zero hard failures
2. Row counts are plausible — if canonical row counts drop unexpectedly, stop and
   investigate before proceeding; do not commit
3. `git diff out/canonical/` shows only expected rows (e.g., new event, corrected placement)
4. If adding a pre-1997 event: confirm the new event_key appears in `out/canonical/events.csv`
5. If fixing a mirror event: confirm placements changed only for the target event_id

---

## What Not To Do
- Do not commit if QC returns any hard failure
- Do not edit `out/canonical/*.csv` directly — rebuild instead
- Do not run scripts 07 or 08 manually after a change unless QC has already passed
- Do not modify `inputs/identity_lock/` files — they are versioned and frozen
- Do not skip `./run_pipeline.sh rebuild` before `release` — stale stage2 + fresh release
  produces incorrect outputs
- Do not run `02p5b_supplement_class_b.py` before `release` — it reads from `canonical_input/`
  which is populated by the release step
- If canonical row counts drop unexpectedly, stop and investigate before proceeding —
  do not commit
