# Historical Footbag Pipeline + Platform DB

## Scope
This subtree prepares canonical data and integrates with the platform DB.
Do not modify repo-root code, docs, or Claude skills from here.
For repo-root/platform tasks, defer to repo-root `CLAUDE.md` and `IMPLEMENTATION_PLAN.md`.
`legacy_data` work follows James's track; cross-track changes require explicit coordination.

## Source of Truth
- Authoritative outputs: `out/canonical/*.csv`
- Platform DB derives from canonical + enrichment layers
- Workbook is derived only
- Mirror HTML = highest priority (1997–present)
- Structured curated CSVs = authoritative pre-1997 intake
- Identity lock files are frozen (patch toolchain only)

## Routing (use skills)
- Full pipeline run → `complete-pipeline`
- Rebuild / QC / canonical validation → `historical-pipeline`
- Add pre-1997 source → `promote-curated-source`
- Workbook work → `workbook-v22`
- Identity rebuild → `rebuild-identity-pipeline`
- Alias cleanup → `cleanup-alias-pattern-c`
- DB mutation safety → `db-write-safety`

## Pipeline Invariants
- AliasResolver is sole identity authority
- Canonical CSVs deterministic (LF, UTF-8, sorted)
- Name normalization is deterministic (NFKC, lowercase, trim)
- Name-variant generators are idempotent
- Person-likeness gate filters non-person rows
- Alias merges occur upstream only
- Only HIGH-confidence rows reach DB
- No team names in person entities
- Corrections carry provenance metadata
- Honor overrides secondary to AliasResolver
- Workbook person visibility follows platform filter
- Federations (WFA/NHSA) may act as host clubs for early events
## DB Invariants
- Soft delete via `deleted_at`; never hard delete
- Audit logs append-only
- Unique constraints via partial indexes
- Services enforce business rules; DB layer is dumb
- Controllers contain no SQL or business logic
- Ambiguous identity resolution never auto-selects
- Auto-link requires strong multi-anchor match
- name_variants stores high-confidence entries only
- Integration tests use real SQLite DB
- Each test uses isolated temp DB
- Writes are transactional (all-or-nothing)

## Non-negotiable rules
- QC must PASS before committing canonical-output changes
- Never edit `out/canonical/*.csv` directly
- Never modify identity lock files directly
- Never fabricate results (unknown stays unknown)
- All exclusions must be traceable in `overrides/`
- Prefer one-command workflows defined in skills
- Never run git commit/push/pull; stage-only changes allowed, human owns commits
