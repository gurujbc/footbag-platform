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
