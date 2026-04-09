# Review: World Ranking Lists 1993–2003 (FBW_10_2.txt, FBW_11.txt, FBW-12-14.txt)

## Status: DO NOT INGEST as event placements

## Sources
- `FBW_10_2.txt` (lines 165–195, 213–268): 1993 World Ranking
- `FBW_11.txt` (lines 44–112): 1994 World Ranking
- `FBW-12-14.txt`: 1995–2003 World Rankings (one block per year)

## Issue: Rankings are season aggregates, not event placements

These rows represent end-of-season standings accumulated across all events of
the year. They are not placements at a single competition. The pipeline Variant B
schema maps each row to a placement at a named event — ingesting ranking rows as
placements would fabricate a non-existent event called "1993 World Ranking" and
misrepresent every row as a competition result.

Additionally, some ranking blocks use division labels like "Mixed Doubles Net - Men"
and "Mixed Doubles Net - Women" (separate rankings per gender) that do not map to
any standard competition discipline.

## What the data contains

Per year, rankings typically cover:
- Open Singles Net (top 10)
- Women's Singles Net (top 5–7)
- Mixed Doubles Net - Men (top 5–7)
- Mixed Doubles Net - Women (top 5–7)
- Open Singles Freestyle (top 10)
- Women's Singles Freestyle (top 5–8)
- Open Team Freestyle (top 5–7)
- Women's Team Freestyle (top 3–4)
- Mixed Team Freestyle (top 3, in some years)
- Open Singles Consecutive (top 5–8)
- Women's Singles Consecutive (top 3–5)
- Open Footbag Golf (top 5–8)
- Women's Footbag Golf (top 3–5)

## Recommended action

These ranking lists have historical research value but must not be ingested as
event placements. If a season-ranking feature is added to the platform in the
future, these could be imported as a separate data type (e.g., `world_rankings`
table). For now, retain the raw TXT files as research reference only.

Do not create structured CSVs for these blocks.
