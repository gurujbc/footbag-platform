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

## Dave's track: photo pipeline production wiring (DD §1.5 + §1.8)

Brings the avatar/photo pipeline to its DD-pinned production design (S3 storage, separate `image` Sharp container per DD §1.8, CloudFront serving from bucket per DD §1.5). Closes the prior "Avatar pipeline is local-only" deviation.

**Per-phase detail (file paths, contracts, tests, verification, mirror patterns, do-NOTs, acceptance) lives in `PHOTO_PIPELINE_PLAN.md` at project root. Read that file before starting any phase.**

Phases (each executed in a clean session; lowest-numbered open phase is current):

1. App: `ImageProcessingAdapter` (HTTP-only) + `src/imageWorker.ts` entry
2. Docker: `image` container + compose updates
3. App: `createS3PhotoStorageAdapter` + `env.ts` fail-fast
4. Terraform: S3 infra (versioning + replication + lifecycle + IAM, no CloudFront flip)
5. Cutover (operator-led, scheduled): TF flip + env update + restart + smoke
6. Smoke test + DEVOPS_GUIDE runbook + DD §1.5 doc-sync
7. IP cleanup -- delete this section and `PHOTO_PIPELINE_PLAN.md`

Out of scope: gallery upload routes; rate-limit enforcement; ACM/route53/custom-domain alias; content-hash filenames replacing `?v=`; customer-managed KMS on media bucket.

Cross-phase invariants (NEVER violate):
- Existing avatar test suite (12 cases in `tests/integration/avatar.routes.test.ts`) stays green at every phase boundary.
- `npm run build` clean; coverage thresholds (95/76/93/95) hold or rise.
- No edits to canonical docs (DD/USER_STORIES/SERVICE_CATALOG/DATA_MODEL/DEV_ONBOARDING/DEVOPS_GUIDE/GOVERNANCE) without explicit maintainer approval; show literal BEFORE/AFTER and wait.
- `?v={media_id}` cache-bust query, stable per-member S3 keys, and synchronous USER_STORIES contract are preserved across every phase.
- Adapter parity tests inject fake clients (`fetchImpl`, `s3Client`); never mock the AWS SDK package.

Accepted shortcut: SSE-S3 (AES256) on the media bucket (per DD §3.1), not customer-managed KMS.
