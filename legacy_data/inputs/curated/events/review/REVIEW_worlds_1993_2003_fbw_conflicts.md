# Review: FBW Worlds Placements 1993–2003 (FBW_11.txt, FBW-12-14.txt)

## Status: NEEDS REVIEW — do not ingest automatically

## Sources
- `FBW_11.txt`: 1993 World Footbag Championships (42 rows)
- `FBW-12-14.txt`: 1994–2003 World Footbag Championships (multiple events, ~43 rows each)

## Issue 1: Duplicate coverage for 1993–1997 Worlds

These events are already in the canonical pipeline from other structured sources:

| Year | Existing structured source |
|------|---------------------------|
| 1993 | `worlds90-93.txt` |
| 1994 | `worlds94-97.txt` |
| 1995 | `worlds94-97.txt` |
| 1996 | `worlds94-97.txt` |
| 1997 | `worlds94-97.txt` + mirror HTML |

Adding these from FBW sources would create duplicate events. Before ingesting,
verify whether the existing worlds TXT sources already cover all disciplines.

## Issue 2: Placement conflicts between FBW source and mirror (1997–2003)

For 1997–present, mirror HTML is highest priority. The FBW magazine placements
may differ. Known example:

- **1993 Open Singles Net, p1**: FBW = Randy Mulder; mirror/worlds90-93 = Dan Borsky

Other disciplines may have similar discrepancies. Each conflict must be resolved
individually via `overrides/results_file_overrides.csv` — do not silently override
mirror placements with magazine data.

## Issue 3: World Rankings in same files (separate problem)

Both files also contain "World Ranking" rows (1993 ranking in FBW_10_2.txt,
1994 ranking in FBW_11.txt, 1995+ in FBW-12-14.txt). See separate review note
`REVIEW_world_rankings_1993_2003.md`.

## Recommended action

1. For 1993–1996: compare FBW placements discipline-by-discipline against
   `worlds90-93.txt` / `worlds94-97.txt`. If FBW shows a genuine correction,
   create a targeted override; do not replace the existing source wholesale.

2. For 1997–2003: compare FBW placements against mirror HTML. Mirror wins;
   any confirmed FBW corrections go to `overrides/results_file_overrides.csv`
   with a source citation (FBW volume/issue number).

3. Do not create new structured CSVs for these events until conflict resolution
   is complete. The existing sources already produce QC-passing output.
