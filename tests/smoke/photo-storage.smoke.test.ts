/**
 * Photo storage staging-smoke test.
 *
 * Long-term, opt-in smoke suite. Exercises createS3PhotoStorageAdapter
 * against the real staging media bucket via the assumed-role chain. The
 * contract asserted here is permanent: the host's runtime identity can
 * put, head-check, and delete S3 objects in the configured bucket, and
 * keys are preserved exactly as the adapter writes them (no `media/`
 * prefix on the storage side; the `/media/` prefix is purely a URL
 * convention applied by constructURL).
 *
 * Run with: npm run test:smoke (uses scripts/test-smoke.sh to set
 * AWS_PROFILE=footbag-staging-runtime, AWS_REGION=us-east-1,
 * PHOTO_STORAGE_S3_BUCKET from terraform output, and gate behind
 * RUN_STAGING_SMOKE=1).
 *
 * Failure modes:
 *   - PutObject AccessDenied: app_runtime IAM policy lost s3:PutObject
 *     on the media bucket.
 *   - HeadObject NotFound on a key just put: PUT-after-HEAD on the source
 *     bucket should be strongly consistent; a NotFound here indicates an
 *     SDK, region, or bucket-name misconfiguration.
 *   - DeleteObject AccessDenied: app_runtime IAM lost s3:DeleteObject on
 *     the media bucket.
 *   - PHOTO_STORAGE_S3_BUCKET unset: terraform-output media_bucket_name
 *     could not be read; check scripts/test-smoke.sh.
 *
 * Excluded from the default `npm test` suite via the test:smoke script's
 * tests/smoke/ scope; never reaches AWS in dev or CI.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createS3PhotoStorageAdapter } from '../../src/adapters/photoStorageAdapter';

const RUN = process.env.RUN_STAGING_SMOKE === '1';
const region = process.env.AWS_REGION ?? 'us-east-1';
const bucket = process.env.PHOTO_STORAGE_S3_BUCKET ?? '';

// Worker-unique prefix so parallel smoke runs do not collide. Tests track
// the keys they create; afterAll deletes those tracked keys best-effort
// so a failed assertion still cleans up.
const SMOKE_PREFIX = `smoke/photo-storage-${process.pid}-${Date.now()}`;
const trackedKeys: string[] = [];

describe.skipIf(!RUN)('photo storage adapter against staging S3', () => {
  if (!bucket) {
    throw new Error(
      'PHOTO_STORAGE_S3_BUCKET must be set; check scripts/test-smoke.sh',
    );
  }

  const adapter = createS3PhotoStorageAdapter({ bucket, region });

  afterAll(async () => {
    for (const key of trackedKeys) {
      try {
        await adapter.delete(key);
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  it('put: writes an object that exists() then reports true', async () => {
    const key = `${SMOKE_PREFIX}/probe-put.jpg`;
    trackedKeys.push(key);
    await adapter.put(key, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(await adapter.exists(key)).toBe(true);
  });

  it('exists: reports false for a key that was never written', async () => {
    expect(await adapter.exists(`${SMOKE_PREFIX}/never-existed.jpg`)).toBe(
      false,
    );
  });

  it('delete: removes an object so exists() reports false', async () => {
    const key = `${SMOKE_PREFIX}/probe-delete.jpg`;
    trackedKeys.push(key);
    await adapter.put(key, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(await adapter.exists(key)).toBe(true);
    await adapter.delete(key);
    expect(await adapter.exists(key)).toBe(false);
  });

  it('constructURL: returns /media/{key} unchanged from the storage key', () => {
    const key = `${SMOKE_PREFIX}/probe-url.jpg`;
    expect(adapter.constructURL(key)).toBe(`/media/${key}`);
  });
});
