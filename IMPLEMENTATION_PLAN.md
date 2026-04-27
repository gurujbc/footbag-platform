# IMPLEMENTATION_PLAN.md

This file tracks the current build: active sprint, accepted dev shortcuts, and external blockers. Long-term design lives in `docs/USER_STORIES.md`, `docs/DESIGN_DECISIONS.md`, and `docs/MIGRATION_PLAN.md`; anything narrower than those docs is implicit future work and is not enumerated here.

## Active slice now

### Parallel tracks

Two developers work in parallel. **AI assistants: read only the track section matching the active developer; other tracks are out-of-scope noise.** Identify the developer from the git user, the prompt, or by asking.

| Dev | Handle | Track | Section |
|---|---|---|---|
| Dave | (primary maintainer) | normal maintenance | — |
| James | JamesLeberknight | Historical pipeline completion (data import / legacy migration) | "James's track" (routing only; detail in `legacy_data/IMPLEMENTATION_PLAN.md`) |

Cross-track changes require explicit human coordination.

---

## James's track: Historical pipeline completion (parallel)

Tracked in `legacy_data/IMPLEMENTATION_PLAN.md`. Load only when working in that subtree.

---

## Accepted temporary deviations

### Feature deviations

1. **Avatar pipeline is local-only.** No server-side processing; raw uploads stored as-is (Busboy streaming, 5 MB limit); stable path + `?v={media_id}` cache-bust. `PhotoStorageAdapter` boot-time/parity/staging-smoke trio still to complete for S3 impl. CloudFront `/media/*` custom cache policy keys on query string for the cache-bust; retire to `Managed-CachingOptimized` once content-hash filenames replace `?v=`. Unblock: S3/media pipeline.
### Infrastructure deviations

6. **`src/db/db.ts` does module-load-time `db.prepare()` calls.** Top-level prepared statements compile against whatever DB `FOOTBAG_DB_PATH` resolves to at import time, before any test's `beforeAll` schema apply. Currently masked at the test layer: integration tests use unique per-file dbPaths (`test-${port}-${Date.now()}-${pid}-${rand}.db` in `tests/fixtures/testDb.ts`), so each vitest worker opens its own DB and applies schema before src/ imports compile prepares. The architectural concern remains: any future src/ module that prepares at load time, or any test path that imports src/ before its `setTestEnv` runs, re-exposes the failure mode. Unblock: refactor `src/db/db.ts` to lazy-prepare (getter-per-statement or factory-passing-db); pattern A (getter) is the smaller change.
