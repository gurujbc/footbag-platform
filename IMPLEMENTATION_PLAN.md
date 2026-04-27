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

5. **Deploy scripts always rebuild docker images on the workstation.** `scripts/deploy-code.sh` and `scripts/deploy-rebuild.sh` run `docker compose build` unconditionally on the workstation, then ship the image via `docker save | ssh | docker load`. The host-OOM problem is already solved (build is off nano_3_0; `scripts/deploy-code.sh` documents the rationale). Residual issue: the workstation rebuilds every deploy even when no `src/`, `package-lock.json`, or `docker/web/Dockerfile` changed, wasting minutes on code-only and compose-only deploys. Unblock: add `SKIP_BUILD=yes` opt-out to both scripts, or hash the build inputs locally and skip when unchanged.
6. **`src/db/db.ts` does module-load-time `db.prepare()` calls.** Top-level prepared statements (e.g. `publicEvents.listUpcoming`) execute as soon as any importer loads the module, against whatever DB `process.env.FOOTBAG_DB_PATH` resolves to AT IMPORT TIME. Test isolation (`setTestEnv` + `createTestDb`) runs in `beforeAll`/`beforeEach`, AFTER imports. Tests in workers where this module loads first connect to the operator's local `database/footbag.db` and fail with `SqliteError: no such table: ...` if local DB lacks any referenced table. Symptom is non-deterministic across vitest runs (depends on parallel scheduling). Manifestation seen during deploy preflight: `email-verify.autolink-classification.test.ts` failed on missing `events` table. Unblock: refactor `src/db/db.ts` to lazy-prepare (getter-per-statement or factory-passing-db). Pattern A (getter) is the smaller change. Workaround until refactored: keep local DB schema-current via `bash scripts/reset-local-db.sh` before any test run.
