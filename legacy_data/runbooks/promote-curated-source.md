# Skill: promote-curated-source

## When to Use
Invoke this skill when:
- Promoting a raw TXT, magazine scan, or legacy stub to a production-ready structured CSV
- Retiring a `stage1_raw_events_magazine.csv` stub by replacing it with a structured CSV
- Adding a newly digitized pre-1997 event to the canonical dataset

Do NOT invoke this skill for:
- Post-1997 mirror events (those go through `overrides/results_file_overrides.csv`)
- Identity corrections (use `person_aliases.csv` or the patch toolchain)
- Events already in canonical as structured CSVs

---

## Inputs Expected
- The source data: magazine scan, TXT file, or existing legacy file
- Event metadata: name, year, location, category (NET / FREESTYLE / GOLF)
- Placement data: division, place, player_1, [player_2 for doubles]
- A source citation for the `notes` column (e.g., `IFAB-RB-P1`, `FBW-V3-P12`)

---

## Safe Workflow

```bash
# Step 1: Determine target filename
# Convention: magazine_YYYY_eventname.csv or fbw_YYYY_eventname.csv
# e.g.: inputs/curated/events/structured/magazine_1981_worlds_minneapolis.csv

# Step 2: Create the structured CSV (Variant B schema)
# Columns: event_name,year,location,category,division,place,player_1,player_2,score,notes

# Step 3: If new persons appear, add display-name rows to:
#   inputs/identity_lock/Person_Display_Names_v1.csv
#   (existing UUID variant, or new Class B UUID5 entry)

# Step 4: Verify the file before rebuild (see validation checklist below)

# Step 5: If replacing a legacy stub, remove it from stage1_raw_events_magazine.csv
# and from overrides/results_file_overrides.csv

# Step 6: Run the full pipeline (fails fast on QC hard failures)
cd ~/projects/footbag-platform/legacy_data
./run_pipeline.sh full

# Step 7: Confirm new event appears in canonical
grep "<event_key>" out/canonical/events.csv

# Step 8: Confirm participant count matches source
grep "<event_key>" out/canonical/event_result_participants.csv | wc -l

# Step 9: Only commit if QC STATUS: PASS and row counts are expected
```

---

## Validation Checklist (before rebuild)
- All rows have `event_name`, `year`, `division`, `place`, `player_1`
- Doubles rows have both `player_1` and `player_2`
- `category` is one of: `NET`, `FREESTYLE`, `GOLF`
- place values should start at 1 and be sequential where known; if intermediate
  placements are unknown, stop at the last confirmed placement — do not fabricate
  missing places
- `notes` column contains a source citation

## Validation Steps (after rebuild)
1. `QC STATUS: PASS`
2. New event_key appears in `out/canonical/events.csv` with correct year and location
3. Discipline count matches the number of distinct divisions in the source CSV
4. Placement count matches the number of rows in the source CSV
5. Doubles divisions have exactly 2 participants per placement
6. Player names resolve to `person_id` values — check
   `out/canonical/event_result_participants.csv`; blank `person_id` = unresolved,
   which is allowed but should be noted
7. If retiring a stub: old event_id no longer appears anywhere in `out/canonical/`

---

## What Not To Do
- Do not fabricate placements for gaps — if place 2 is unknown, stop the list at
  the last confirmed placement
- Do not use `stage1_raw_events_magazine.csv` as a template — it is a legacy format
  that has been fully superseded
- Do not add a source without a citation in the `notes` column
- Do not hand-edit `out/stage1_raw_events_curated.csv` — it is a pipeline output
- Do not override an authoritative source (especially
  `authoritative-results-1980-1985.txt`) without documenting the conflict in `overrides/`
- Do not commit before QC PASS
