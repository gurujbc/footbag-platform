# `pipeline/identity/` — shared identity primitives

Modules in this subtree own the rules by which raw player names resolve to
canonical person identities. Every stage that touches persons must route
through these modules; ad-hoc name normalization or alias lookup elsewhere
in the pipeline is a bug.

## Modules

| Module                     | Purpose                                                                                  |
|----------------------------|------------------------------------------------------------------------------------------|
| `alias_resolver.py`        | Canonical resolver over `overrides/person_aliases.csv` + `out/canonical/persons.csv`. Single source of truth for name → `person_id`. |
| `person_gate.py`           | `_is_person_like` predicate shared by ingress stages (keeps junk strings out of the person pool). |
| `stub_uuid.py`             | Deterministic Class-B UUID5 generation for provisional / pending-identity names.         |
| `build_name_variants.py`   | Build `inputs/name_variants.csv` from aliases + display-names + BAP + canonical persons. |

## `build_name_variants.py` — when to re-run

The output `legacy_data/inputs/name_variants.csv` is deterministic for a
given set of inputs. Regenerate any time an upstream source changes:

- `overrides/person_aliases.csv` edited (alias cleanup, Bucket-2 resolution)
- `inputs/identity_lock/Person_Display_Names_v1.csv` extended with new curated
  display-name mappings
- `inputs/bap_data_updated.csv` refreshed after a BAP honor list update
- `out/canonical/persons.csv` changes (e.g. after a `canonical_only` run that
  adds new persons or updates canonical spellings)

Run from `legacy_data/` with the venv active:

```bash
python pipeline/identity/build_name_variants.py
```

Review the `git diff` of `inputs/name_variants.csv`. The file is a curated
seed, not a pipeline cache; diffs are intentional and human-reviewable. No
stage in `run_pipeline.sh` consumes it yet — the loader and QC check are
drafted but not wired (see `scripts/load_name_variants_seed.py` and
`pipeline/qc/check_name_variants.py`).

## Loader policy (draft, not yet wired)

- **high**-confidence rows are eligible for production use: the loader will
  write them to the DB `name_variants` table (source=`mirror_mined`) when
  wiring lands.
- **medium**-confidence rows are reported but not loaded. They surface in
  the loader's staging artifact for human review; they do not participate
  in registration-time auto-linking.

Wiring is blocked on the platform-side auto-link code path (MIGRATION_PLAN
§7). Do not add the loader to `run_pipeline.sh` until that consumer exists.

## Integration hook — where name_variants plugs into the identity flow

`name_variants` is a **platform-side** table (`database/schema.sql`,
`docs/MIGRATION_PLAN.md §7`). Its primary consumer is the registration /
email-verify flow, not the legacy-data pipeline. The hook locations below
are the places where a future consumer should consult the table.

### Phase 2 (current): report-only wiring

- **QC:** `pipeline/qc/check_name_variants.py` runs under `run_qc.py` at
  `severity=info`. Reports structural problems without blocking. Promote
  to `warn` once the loader wires in, and to `hard` once production reads
  the DB table.
- **Loader:** `scripts/load_name_variants_seed.py` is runnable by hand
  (`--apply --db <path>`) and loads only HIGH-confidence rows with
  `source='mirror_mined'`. MEDIUM rows write to
  `out/name_variants_deferred.csv` for review; they are NEVER inserted
  by this loader. Not auto-invoked by `run_pipeline.sh` or
  `scripts/reset-local-db.sh`.

### Phase 3 (deferred): auto-link at registration (platform-side)

Target: `src/services/legacyMigrationService.ts` (the Phase 4-F'
extraction) or `identityAccessService.ts::verifyEmailByToken`
(interim). Flow:

1. User verifies email; `verifyEmailByToken` resolves the bound member row.
2. Normalize the member's `real_name` with the same NFKC + lower +
   collapse + trim rule used at load time.
3. Look up in `name_variants` table by either `canonical_normalized` or
   `variant_normalized`. Only HIGH rows are present (enforced at load).
4. Join the matched canonical form to `historical_persons` by
   `normalize(person_name)` to produce auto-link candidates.
5. Present candidates in the claim UI per `docs/MIGRATION_PLAN.md §7`.

MEDIUM rows are not consulted. Treat them as a curator review queue
backed by `out/name_variants_deferred.csv`.

### Pipeline-side hook (optional, deferred)

If the pipeline itself ever needs to use variants (e.g. to collapse
near-duplicate raw player tokens before persons.csv is built), the hook
sits **outside** `AliasResolver`, as a pre-step:

    raw_name
      → normalize_name                (alias_resolver.normalize_name)
      → name_variants lookup          (optional pre-step; variant → canonical_normalized)
      → AliasResolver.resolve         (unchanged: alias registry, then canonical index)
      → canonical person_id

`AliasResolver` itself stays alias-registry-first. Do not fold
`name_variants` into `resolve()`; keep the consultation explicit at the
call site so every ingress point that opts in is auditable. Candidate
call sites when this lands: `pipeline/02p5_player_token_cleanup.py` and
`persons/provisional/scripts/03_reconcile_provisional_to_historical.py`.

No pipeline ingress opts in today. `out/canonical/*.csv` remains
produced without any name_variants consultation — Phase 2 does not
change canonical outputs.
