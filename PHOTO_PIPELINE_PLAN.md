# PHOTO_PIPELINE_PLAN.md -- Master plan for the photo/avatar pipeline slice

This is a temp planning artifact for the seven-phase slice that brings the avatar/photo pipeline to its DD-pinned production design (S3 storage, separate `image` Sharp container, CloudFront serving from the bucket). It complements the `IMPLEMENTATION_PLAN.md` "Dave's track: photo pipeline production wiring (DD §1.5 + §1.8)" section, which is the authoritative AI-facing entry point per phase.

**Read order for any phase:**
1. The relevant phase block in `IMPLEMENTATION_PLAN.md` -- precise file paths, signatures, tests, verification, mirror patterns, do-NOTs, acceptance criteria.
2. This file -- design rationale, alternatives considered, cross-phase invariants, quick-reference cheat sheets.
3. `docs/DESIGN_DECISIONS.md` §1.4, §1.5, §1.7, §1.8, §3.10 -- the DD pins.
4. `docs/USER_STORIES.md` `M_Upload_Photo` and `M_Organize_Media_Galleries` -- the user-facing contract.
5. `.claude/rules/testing.md` -- the testing mandate that every adapter requires.

This file is deleted at Phase 7 cleanup, along with the IP active-slice block.

---

## Why this slice exists

The IP previously had a deviation entry: "Avatar pipeline is local-only" -- meaning today's `src/services/avatarService.ts` writes processed JPEG variants to the local filesystem via the `LocalPhotoStorageAdapter`. That works for development; it does not match the DD §1.5 design which specifies S3 + CloudFront serving from the bucket + cross-region replication. The pipeline must move to the production design before the avatar feature can ship to production.

The slice scope grew from "swap in S3" to also include the `image` container (DD §1.8) once gallery scope was considered. With galleries, members upload batches of 5-10 photos; browsers fire 4-6 parallel POSTs; multi-user bursts mean 10-20 concurrent Sharp invocations. Sharp peaks ~500MB per upload. Web at 512MB OOMs immediately under that load; even a bumped web at 1408MB OOMs at 4+ concurrent. The DD §1.8 four-container topology (nginx 128 / web 512 / worker 384 / image 896) explicitly accommodates this with a separate, sized container for Sharp. Deferring it would require deferring gallery support too; the slice includes the image container.

---

## Design decisions, with rationale

### 1. Single HTTP-only `ImageProcessingAdapter`, no in-process variant

DD §1.4 mandates "same Dockerized process boundaries". A dual-impl `in_process | http` adapter exercises a different process topology in dev (Sharp inline in web) vs staging/prod (Sharp in image container, web POSTs over HTTP). Bugs in serialization, timeout handling, error mapping, container readiness ordering all surface only in staging/prod, never caught locally. Classic dev-prod gap.

The fix: one production code path, `createHttpImageAdapter`. Tests inject `fetchImpl` (the same shape as `LiveSesAdapter`'s `sesClient` injection) and the fake fetch invokes Sharp inline so test fixtures still produce real processed bytes. Same adapter code path in tests, dev (`npm run dev:image` on localhost:4001), compose dev (image container on image:4000), staging, prod.

The `JwtSigningAdapter` and `SesAdapter` precedent is misleading here -- both have dual implementations that run in the same web Node process (local crypto vs KMS API call; in-memory record vs SES API call). They never cross a process boundary. Image processing is the only adapter in the codebase that crosses an OS-level container boundary, so it warrants the more conservative one-implementation pattern.

### 2. S3 PUT `Cache-Control: public, max-age=31536000, immutable`

The cache-bust is URL-versioned via the existing `?v={mediaId}` query string (a fresh UUID per upload, generated in `src/services/avatarService.ts:31`). The CloudFront `media_assets` cache policy includes the query string in the cache key (`terraform/staging/cloudfront.tf:23-44`, `query_string_behavior = "all"`). So:

- Each `?v=uuid-A` is a distinct cache entry under that exact URL.
- Replacement upload emits `?v=uuid-B` -- different cache key, cache miss, fresh fetch.
- The cached `?v=uuid-A` entry is now unreachable from any rendered page; nothing emits it. Its bytes-at-that-URL are immutable forever.

Therefore `immutable` is semantically correct -- the URL is the cache identity, the S3 key is the storage location, the two are decoupled. 1-year max-age is the conventional CDN-immutable upper bound; functionally identical to 30 days for our purposes since URLs are unique per upload.

The DD literal text says "30-day cache TTL" (line 220). This is drift from an early MVP draft that didn't consider URL-versioning. The DD update is proposed in Phase 6 doc-sync.

### 3. `constructURL` returns relative `/media/{key}` in both adapters

DD §3.10 confirms a single CloudFront distribution serves traffic on multiple hostnames via path behaviors. There is no separate `media.footbag.org` subdomain -- DD §1.5's parenthetical is drift from an early draft. So:

- The page is served from the same distribution that serves `/media/*`.
- A relative URL `/media/{key}?v={uuid}` resolves correctly via the existing `/media/*` cache behavior in CloudFront, which (after Phase 5) routes to S3 via OAC.
- Local adapter and S3 adapter return identical URL shapes. No per-environment hostname construction.
- No `PHOTO_STORAGE_CLOUDFRONT_DOMAIN` env var.

### 4. SSE-S3 (AES256), not customer-managed KMS, on the media bucket

DD §3.1 explicitly accepts SSE-S3 for buckets that don't carry secret data. Photos are public-read content (Tier 1 published media); the at-rest encryption requirement is satisfied by AWS-managed AES256. KMS adds operational complexity (key policy, replication of KMS-encrypted objects, IAM grants) without a security gain commensurate with this scope. KMS could be added later if a regulatory or governance change demands it.

### 5. `app_runtime` IAM gets PutObject/DeleteObject/HeadObject only, no GetObject

CloudFront-OAC handles object reads. Web only writes (PutObject), removes (DeleteObject), and checks existence (HeadObject). Granting GetObject would be unnecessary attack surface. If a future feature needs to re-read original bytes (e.g., regenerate variants on a Sharp upgrade), GetObject can be added in a follow-up.

### 6. No backfill in cutover

Memory rule: staging tolerates full DB reset; the maintainer confirmed this for the photo-pipeline cutover. Skip the `aws s3 sync` step. The cutover is a clean cut: existing local-fs avatars (if any) are discarded; members re-upload after cutover. This rule applies to STAGING ONLY -- production cutovers will need backfill if and when production is provisioned.

### 7. Two-phase Terraform (Phase 4 + Phase 5)

The CloudFront `/media/*` origin flip cannot decouple from the env-var flip -- whichever lands first leaves the system in a broken state (CloudFront points at empty S3 OR app writes to S3 but CloudFront still serves from Lightsail's empty local fs). So:

- Phase 4: stand up S3 infra (versioning, replication, lifecycle, IAM). `/media/*` CloudFront origin unchanged. Existing displays unaffected.
- Phase 5: the cutover step does both the CloudFront flip TF apply AND the env update AND the compose restart together as a single operator-led, scheduled step.

### 8. Lifecycle includes `NoncurrentVersionExpiration` (30d)

Versioning must be enabled on the source media bucket for cross-region replication to function. Without `NoncurrentVersionExpiration`, every replacement upload would accumulate old bytes forever (since avatar keys are stable per member, replacement is overwrite-in-place, which under versioning means a new current version + a noncurrent version). 30 days noncurrent expiration matches the snapshots bucket convention and gives operator headroom to restore prior versions if needed.

### 9. Separate `s3_replication` IAM role (not on `app_runtime`)

S3 cross-region replication requires a role assumable by `s3.amazonaws.com` with replication-specific permissions. Combining this with `app_runtime` would muddy the role's purpose; separating keeps each role to its principal of trust.

### 10. Image worker concurrency semaphore (MAX=2 default)

The image container's 896MB memory budget accommodates one Sharp op at ~500MB peak plus headroom. Express by default handles requests concurrently; under a gallery batch upload (4-6 parallel POSTs from a browser), unconstrained concurrency would OOM. A simple semaphore at MAX=2 allows two concurrent Sharp ops (~1GB peak, fits within 896MB after compaction); excess waits up to 30s before returning 503. Env-overridable for tuning under observed load.

---

## Cross-phase invariants

Apply to every phase. If you find yourself violating one, stop and confirm with the maintainer.

1. **Existing avatar test suite stays green.** `tests/integration/avatar.routes.test.ts` (12 cases) must pass after every phase. If a phase requires extending the test (e.g., parameterizing for the s3 adapter), the existing cases must still pass against the existing local adapter.
2. **`npm run build` clean at every phase boundary.** No `tsc` errors.
3. **Coverage thresholds hold or rise.** `vitest.config.ts`: 95% statements, 76% branches, 93% functions, 95% lines.
4. **No edits to canonical docs without explicit maintainer approval.** DD, USER_STORIES, SERVICE_CATALOG, DATA_MODEL, DEV_ONBOARDING, DEVOPS_GUIDE, GOVERNANCE. All proposals are PROPOSE-with-literal-text and require approval before applying.
5. **`?v={media_id}` cache-bust query is preserved.** The current code at `src/services/avatarService.ts:31` and `src/services/memberService.ts:114` is the contract; do not refactor to content-hash filenames in this slice.
6. **Stable per-member S3 keys are preserved.** `avatars/{memberId}/thumb.jpg` and `avatars/{memberId}/display.jpg`. Do not refactor to per-upload unique keys; the URL-versioning + immutable contract depends on key stability.
7. **Synchronous USER_STORIES contract is preserved.** The user must see the new avatar immediately after upload completes. The image container is a sync RPC, not a queue.
8. **Four-container topology lands in Phase 2 and is never reverted.** nginx, web, worker, image. The image container is the DD §1.8 design.
9. **`detectImageType` lives in `src/lib/imageProcessing.ts` and is called from BOTH web (cheap reject) and image worker (defense-in-depth).**
10. **Adapter parity tests use injected fake clients, never AWS-SDK mocks.** Per `.claude/rules/testing.md`: "No mocking the AWS SDK package; inject a fake client."

---

## Cheat sheet -- what each phase produces

| Phase | App code | Docker | Terraform | Operator | Tests |
|---|---|---|---|---|---|
| 1 | ImageProcessingAdapter (HTTP) + imageWorker.ts + dev:image script + avatarService refactor + env.ts | -- | -- | -- | env-config + adapter-parity (fake fetch) + image-worker.routes + avatar.routes via test-injection |
| 2 | -- | image Dockerfile + compose service + web depends_on + prod overrides | -- | -- | -- |
| 3 | createS3PhotoStorageAdapter + env.ts (PHOTO_STORAGE_*) + Express static cache | -- | -- | -- | env-config + adapter-parity (fake S3Client) + avatar.routes parameterized |
| 4 | -- | -- | s3.tf (versioning + replication + lifecycle) + iam.tf (replication role + app_s3_media) + outputs.tf | terraform apply; verify replication | -- |
| 5 | -- | -- | cloudfront.tf (OAC + S3 origin + flip) + s3.tf (bucket policy) | terraform apply; /srv/footbag/env update; systemctl restart; smoke; manual verify | -- |
| 6 | -- | -- | -- | -- | photo-storage.smoke.test.ts; scripts/test-smoke.sh exports; DEVOPS_GUIDE additions PROPOSED; DD drift fixes PROPOSED |
| 7 | -- | -- | -- | Delete IP active-slice block; delete this PHOTO_PIPELINE_PLAN.md | -- |

---

## Operator runbook -- proposed text for DEVOPS_GUIDE (Phase 6 PROPOSE)

To be added to `docs/DEVOPS_GUIDE.md` as a new subsection. Show this literal text to the maintainer for approval before applying.

```markdown
### Photo storage pipeline (S3 + image container)

The avatar/photo pipeline runs on a four-container topology (nginx + web + worker + image), with photo bytes stored in S3 and served by CloudFront with OAC. Per-environment configuration lives in `/srv/footbag/env` (not Parameter Store -- these are non-secret deploy-time values per §5.3). The `image` container runs Sharp internally on the docker network and is reachable only from web.

#### Required `/srv/footbag/env` variables

- `PHOTO_STORAGE_ADAPTER=s3` (production/staging) or `local` (operator parity check only)
- `PHOTO_STORAGE_S3_BUCKET=<terraform output media_bucket_name>`
- `IMAGE_PROCESSOR_URL=http://image:4000`
- `IMAGE_MAX_CONCURRENT=2` (default; tune under observed load)

#### Replication verification (after any TF apply touching s3.tf)

1. `aws s3api get-bucket-replication --bucket <media>` -- expect `Status: Enabled`, destination `<dr_bucket_arn>`.
2. Put a marker: `aws s3api put-object --bucket <media> --key replication-test/$(date +%s).txt --body /etc/hostname`.
3. Wait 5 minutes.
4. `aws s3api head-object --bucket <dr> --key <marker_key>` -- expect 200 with `ReplicationStatus: REPLICA`.
5. Delete the marker from both buckets.

#### OAC bucket-policy verification

`aws s3api get-bucket-policy --bucket <media>` -- the `Principal` should be `cloudfront.amazonaws.com` and the `Condition.StringEquals."aws:SourceArn"` should match the CloudFront distribution ARN. Any other principal is a misconfiguration.

#### Smoke trigger

After every `terraform apply` that touches `s3.tf`, `iam.tf`, or `cloudfront.tf` for the photo path, run `npm run test:smoke` from a workstation with `AWS_PROFILE=footbag-staging-runtime`. The `tests/smoke/photo-storage.smoke.test.ts` cases must be green before declaring the change successful.

#### Cutover sequence (one-time, when transitioning a fresh environment from local-fs to S3)

1. Verify Phase 4 of the photo pipeline slice is applied: bucket versioning enabled, replication active, app_runtime has `app_s3_media` policy.
2. `terraform plan` for cloudfront.tf + s3.tf bucket policy. Review.
3. `terraform apply`. CloudFront propagation takes ~5-15 minutes; monitor via `aws cloudfront get-distribution --id <id>`.
4. SSH to host. Edit `/srv/footbag/env` (root-owned, 0600). Add the four lines listed above.
5. `systemctl restart footbag.service`. Wait for `docker compose ps` to show all four containers healthy.
6. `npm run test:smoke` from a workstation. Must be green.
7. Manual verification: log in as the preview-user; upload a JPEG avatar; refresh the profile-edit page; confirm display works and the URL has a `?v=` UUID; confirm `aws s3 ls s3://<media>/avatars/{member_id}/` shows two keys.

#### Rollback

If the cutover fails after step 4:

- Revert `/srv/footbag/env`: remove the four lines added in step 4.
- `systemctl restart footbag.service`.
- `terraform apply` a revert of `cloudfront.tf` to point `/media/*` back to `lightsail-origin` (and remove OAC + S3 origin + bucket policy). Required because CloudFront still serves from S3 until the TF revert lands; with the env reverted but CloudFront still on S3, displays will 404.

A clean rollback requires both an env revert AND a CloudFront TF revert.
```

---

## DD §1.5 drift fixes -- proposed text (Phase 6 PROPOSE)

Show literal BEFORE/AFTER to maintainer for approval before applying.

**`docs/DESIGN_DECISIONS.md:220` -- BEFORE:**
> CloudFront distribution (media.footbag.org) serves from primary bucket with 30-day cache TTL. Photos are immutable due to unique paths in filenames, so aggressive caching is safe.

**AFTER (proposed):**
> CloudFront serves photos directly from the primary bucket via the `/media/*` cache behavior on the single site distribution. The cache-bust mechanism is URL-versioned via a `?v={media_id}` query string (a fresh UUID per upload), and the cache key includes the query string. S3 PUT sets `Cache-Control: public, max-age=31536000, immutable`. Photos are immutable from any cache's point of view because each emitted URL is unique to its upload; the URL is the cache identity, the S3 key is the storage location, decoupled.

**`docs/DESIGN_DECISIONS.md:226` -- BEFORE:**
> Photos are backed up separately from database via S3 cross-region replication. Primary bucket (us-east-1) replicates automatically to backup bucket (us-west-2) using One Zone-IA storage class. Replication is continuous with RPO less than 15 minutes. No backup job required; S3 native feature handles this automatically.

**AFTER (proposed):**
> Photos are backed up separately from database via S3 cross-region replication. Primary bucket (us-east-1) replicates automatically to the disaster-recovery (DR) bucket (us-west-2) using One Zone-IA storage class. Replication is continuous with RPO less than 15 minutes. No backup job required; S3 native feature handles this automatically. (The DR bucket is named `<env>-dr` in Terraform, matching the DR convention used for SQLite snapshots.)

**`docs/DESIGN_DECISIONS.md:246` -- BEFORE:**
> - CloudFront configuration documented for media.footbag.org distribution.

**AFTER (proposed):**
> - CloudFront `/media/*` cache behavior with OAC documented in DEVOPS_GUIDE.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| CloudFront propagation window (~5-15 min) leaves /media/* in transition | Phase 5 cutover scheduled in low-traffic window; operator monitors `Status: Deployed` before env update |
| S3 PutObject failure during avatar upload (transient AWS issue) | Web returns 5xx to user; user retries; no orphan state because DB transaction is post-PUT |
| Image container OOM under burst | MAX_CONCURRENT_PROCESSING=2 semaphore limits in-flight; CWAgent alarm at 80% memory triggers operator review |
| Image container down at boot | web serves all non-upload routes normally; avatar upload returns clear "image processing service unavailable" error; ops alert via healthcheck |
| Replication lag exceeds RPO during a regional incident | DR bucket has the most recent replicated objects; older versions retained 30 days |
| Cutover fails partway | Rollback playbook in DEVOPS_GUIDE; env revert + TF revert restores Lightsail-served /media/* |
| Test flakiness from real S3 in smoke | Worker-unique key prefix; pre-cleanup of stranded prefixes >1h old; afterAll deletes prefix even on prior failure |
| Versioning + no expiration grows storage forever | Lifecycle rule with NoncurrentVersionExpiration 30 days on both media and dr |

---

## File index -- everything that gets touched across all phases

**Source:**
- `src/adapters/imageProcessingAdapter.ts` (NEW -- Phase 1)
- `src/adapters/photoStorageAdapter.ts` (extend -- Phase 3)
- `src/imageWorker.ts` (NEW -- Phase 1)
- `src/services/avatarService.ts` (modify -- Phase 1)
- `src/controllers/memberController.ts` (modify -- Phase 1)
- `src/config/env.ts` (extend -- Phase 1 + Phase 3)
- `src/app.ts` (modify -- Phase 3)
- `src/lib/imageProcessing.ts` (UNCHANGED -- still owns Sharp + detectImageType)

**Tests:**
- `tests/unit/env-config.test.ts` (extend -- Phase 1 + Phase 3)
- `tests/integration/adapter-parity.test.ts` (extend -- Phase 1 + Phase 3)
- `tests/integration/avatar.routes.test.ts` (extend -- Phase 1 + Phase 3)
- `tests/integration/image-worker.routes.test.ts` (NEW -- Phase 1)
- `tests/smoke/photo-storage.smoke.test.ts` (NEW -- Phase 6)

**Docker:**
- `docker/image/Dockerfile` (NEW -- Phase 2)
- `docker/docker-compose.yml` (modify -- Phase 2)
- `docker/docker-compose.prod.yml` (modify -- Phase 2)

**Terraform:**
- `terraform/staging/s3.tf` (extend -- Phase 4 + Phase 5)
- `terraform/staging/iam.tf` (extend -- Phase 4)
- `terraform/staging/cloudfront.tf` (extend -- Phase 5)
- `terraform/staging/outputs.tf` (extend -- Phase 4)

**Scripts + config:**
- `package.json` (add `dev:image`, add `@aws-sdk/client-s3` -- Phase 1 + Phase 3)
- `scripts/test-smoke.sh` (extend -- Phase 6)
- `scripts/deploy-rebuild.sh` or equivalent (verify image build step -- Phase 2)

**Docs (PROPOSE only, require maintainer approval):**
- `docs/DEVOPS_GUIDE.md` (extend -- Phase 6)
- `docs/DESIGN_DECISIONS.md` (drift fixes at lines 220, 226, 246 -- Phase 6)

**This file (`PHOTO_PIPELINE_PLAN.md`) and the IP active-slice block:**
- Both deleted in Phase 7 once cutover is verified in staging and smoke is green.
