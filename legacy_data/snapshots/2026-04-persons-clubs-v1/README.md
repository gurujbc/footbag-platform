# Persons + Clubs Pipeline Snapshot (April 2026)

## Summary

First complete pass of:
- Membership enrichment
- Club inference + bootstrap leaders
- Provisional person model
- Reconciliation to historical persons

## Key Results

- Clubs: 311 total, 139 bootstrap-eligible
- Leaders: 176 provisional assignments
- Provisional identities: 2,163
- Matched to historical: 37
- Review required: 221
- Staged: 1,905

## Notes

- Matching is conservative (exact + variant only)
- Weak matches not promoted
- Email matching not yet implemented
- Provisional persons represent non-competition population

## Purpose

Baseline snapshot for:
- identity model validation
- future reconciliation improvements
- pipeline integration
Baseline freeze of persons + clubs pipeline

Counts:
- canonical persons: 2,926
- provisional persons: 2,146
  - staged: 2,045
  - review_required: 101

Notes:
- membership dataset: IFPA PDF (2009 rows)
- reconciliation: exact + weak + conflict pass
- no email matching yet
