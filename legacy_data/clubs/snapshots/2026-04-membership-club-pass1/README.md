# Membership + Club Bootstrap Snapshot (April 2026)

## Summary

This snapshot represents the first complete pass of:

- Membership enrichment
- Club candidate scoring
- Person-club affiliation mapping
- Bootstrap leader selection

## Key Results

- Total clubs: 311
- Bootstrap eligible clubs: 139
- Clubs with leaders: 139
- Co-leaders assigned: 37
- Total provisional assignments: 176

## Pipeline

1. membership enrichment
2. build person universe (results + membership)
3. club candidate scoring
4. affiliation graph
5. bootstrap leader selection

## Notes

- Matching is exact-name only (no fuzzy)
- Alias fallback not fully applied
- Email matching not yet implemented
- Membership-only persons are not yet leader-linkable unless tied to canonical persons

## Purpose

This snapshot is a baseline for:
- validating club inference logic
- comparing future improvements
- integration into migration pipeline
