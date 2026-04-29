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

### Infrastructure deviations

1. **`docker/docker-compose.prod.yml` memory limits sized for Lightsail nano_3_0 (512M host).** Current: nginx 64M, web 192M, worker 96M, image 256M with `IMAGE_MAX_CONCURRENT=1`. DD §1.8 production target: nginx 128 / web 512 / worker 384 / image 896 (1,920M total) with `IMAGE_MAX_CONCURRENT=2`, on a 2GB+ host. Image-container code comment at the deviation site captures the OOM-defense detail. Unblock: host bundle upgrade.
