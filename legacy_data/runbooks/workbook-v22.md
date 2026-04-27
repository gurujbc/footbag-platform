# Runbook: workbook-v22

## When to Use
Use this runbook when:
- Building or updating the v22-style release workbook (`out/Footbag_Results_Release.xlsx`)
- Porting or modifying `pipeline/build_workbook_release.py`
- Deciding what events, persons, or sheets belong in the primary workbook deliverable

Do NOT use this runbook for:
- Canonical pipeline changes (use `historical-pipeline` instead)
- Community format workbook (`build_workbook_community.py` — v13 lineage; separate builder)
- Platform/DB export (see CLAUDE.md "Platform / DB Export" section)

---

## Builder

**Primary script:** `pipeline/build_workbook_release.py`
**Output:** `out/Footbag_Results_Release.xlsx`
**Run after:** rebuild + release + QC pass

Preferred invocation — part of the full pipeline:
```bash
./run_pipeline.sh full   # workbook is stage 5 of 7; QC must pass first
```

Standalone invocation (only after a completed rebuild + release + QC pass):
```bash
.venv/bin/python pipeline/build_workbook_release.py
```

---

## Inputs

| File | Role |
|------|------|
| `out/canonical/events.csv` | Event metadata (all events) |
| `out/canonical/event_disciplines.csv` | Disciplines per event |
| `out/canonical/event_results.csv` | Placement rows |
| `out/canonical/event_result_participants.csv` | Participant rows |
| `out/canonical/persons.csv` | Canonical persons (upstream) |
| `event_results/canonical_input/persons.csv` | Platform-filtered persons (preferred for person stats) |

The builder reads from `out/canonical/` (same source as the platform export). It does
**not** read from `out/canonical_all/` — that path is for the early pipeline only.

---

## Year Sheet Rules

- **Include:** events where at least one discipline has placement data (non-sparse)
- **Exclude:** events flagged as SPARSE or NO RESULTS from the canonical export
- Each year gets one sheet; disciplines share fixed row positions within the sheet
- Placements: p1–p10 per discipline
- Tie notation: `T-N` prefix (e.g. `T-3`) on tied placements

---

## EVENT INDEX Sheet

- References **all** events, including sparse and QC-excluded events
- This is the complete historical record; do not filter it to year-sheet events
- Columns include: event_key, event_name, year, location, discipline count, notes

---

## Person Stats / Visibility

- Visible persons in the workbook should align with `event_results/canonical_input/persons.csv`
  as closely as practical — the same filtering logic governs both:
  - Referenced by at least one participant row, **or**
  - Has a member_id (legacy footbag.org ID), **or**
  - Has BAP or HOF designation
- Do not include persons who appear only in the identity lock but have no placement data
  and no membership/honour designation

---

## Sheets NOT Included in the Primary Deliverable

The following are explicitly **out of scope** for `build_workbook_release.py`:

- **Consecutive Records** — not needed in the main release workbook
- **Freestyle Insights** — not needed in the main release workbook

These may exist in legacy builders (v17, v13) but should not be ported.

---

## Deprecated Builders — Do Not Use as Model

| Script | Why deprecated |
|--------|----------------|
| `pipeline/03_build_excel.py` | Summary-column format; not the release deliverable |
| `pipeline/04_build_analytics.py` | Companion to 03; same issue |
| `pipeline/04B_create_community_excel.py` | Predates v13 port |

`build_workbook_v17.py` (in FOOTBAG_DATA repo) **is** the correct migration base for
`build_workbook_release.py`. Column mapping from `canonical_all/` to `out/canonical/`:

| v17 column | canonical column |
|------------|-----------------|
| `event_id` | `event_key` |
| `discipline` | `discipline_key` |
| `division_canonical` | `discipline_name` |
| `category_canonical` | `discipline_category` (uppercase) |
| `person_canon` | `person_name` |
| `fbhof_member` | `hof_member` |
| `bap_member == "Y"` | `bap_member in ("1","True","true")` |
| location | construct from `city`, `region`, `country` |
| publication whitelist | simplify to `set(events.keys())` — already filtered upstream |

---

## What Not To Do

- Do not run `build_workbook_release.py` before `./run_pipeline.sh release` completes —
  the canonical inputs will be stale
- Do not use `03_build_excel.py` output as a reference for correctness
- Do not add Consecutive Records or Freestyle Insights sheets
- Do not filter the EVENT INDEX to year-sheet events — it must be complete
- Do not diverge person visibility from the platform filtering logic without explicit
  human decision
