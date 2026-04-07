# Identity Lock

This directory contains immutable snapshots of the identity resolution tables used to produce each pipeline release.

## Active Lock (v2.15.0)

| File | Version | Rows | Role |
|---|---|---|---|
| `Persons_Truth_Final_v47.csv` | v47 | 3,468 | Canonical person registry |
| `Placements_ByPerson_v85.csv` | v85 | 27,980 | Player-resolved placement records |
| `Persons_Unresolved_Organized_v28.csv` | v28 | 82 | Unresolvable entries (tracked separately) |

These are the files referenced in `run_pipeline.sh` and `Makefile`. Do not modify them.

## Historical Versions

All prior versions (PT v31–v46, PBP v33–v84) are retained in this directory for audit traceability. They are not used by the current pipeline but document the identity resolution history.

The `archive/` subdirectory may contain additional earlier snapshots.
