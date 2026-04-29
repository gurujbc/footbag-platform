/**
 * Boot-time config assertions for src/config/env.ts.
 *
 * Dev↔staging adapter parity (testing rule §"Dev↔staging adapter parity"):
 * prod-mode env.ts must fail-fast at module-load with specific error messages
 * when required AWS wiring env vars are absent. These tests exercise the
 * fail-fast paths directly so a misconfigured staging host surfaces the
 * problem at container startup, not at first request.
 *
 * Pattern: vi.resetModules() between cases + fresh dynamic import of
 * ../../src/config/env so the frozen `config` singleton is re-evaluated with
 * per-case process.env overrides. Global defaults from tests/setup-env.ts
 * are explicitly deleted where a case needs "unset".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return { ...process.env };
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  for (const [k, v] of Object.entries(snap)) {
    if (v !== undefined) process.env[k] = v;
  }
}

function baselineRequired(): void {
  process.env.PORT = '3099';
  process.env.LOG_LEVEL = 'error';
  process.env.FOOTBAG_DB_PATH = ':memory:';
  process.env.PUBLIC_BASE_URL = 'http://localhost';
  // Valid prod SESSION_SECRET by default; specific tests override.
  process.env.SESSION_SECRET = 'a'.repeat(48);
}

function clearAwsWiring(): void {
  delete process.env.JWT_SIGNER;
  delete process.env.JWT_KMS_KEY_ID;
  delete process.env.JWT_LOCAL_KEYPAIR_PATH;
  delete process.env.SES_ADAPTER;
  delete process.env.SES_FROM_IDENTITY;
  delete process.env.SES_SANDBOX_MODE;
  delete process.env.AWS_REGION;
  delete process.env.IMAGE_PROCESSOR_URL;
  delete process.env.IMAGE_MAX_CONCURRENT;
  delete process.env.IMAGE_PORT;
  delete process.env.IMAGE_PROCESS_TIMEOUT_MS;
  delete process.env.PHOTO_STORAGE_ADAPTER;
  delete process.env.PHOTO_STORAGE_S3_BUCKET;
}

describe('env config: dev defaults apply when NODE_ENV is not production', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('defaults JWT_SIGNER=local and SES_ADAPTER=stub under NODE_ENV=development', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    const { config } = await import('../../src/config/env');
    expect(config.jwtSigner).toBe('local');
    expect(config.sesAdapter).toBe('stub');
  });

  it('defaults JWT_SIGNER=local and SES_ADAPTER=stub under NODE_ENV=test', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'test';
    const { config } = await import('../../src/config/env');
    expect(config.jwtSigner).toBe('local');
    expect(config.sesAdapter).toBe('stub');
  });

  it('accepts SESSION_SECRET=changeme-short outside production', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.SESSION_SECRET = 'short-changeme-value';
    const { config } = await import('../../src/config/env');
    expect(config.sessionSecret).toBe('short-changeme-value');
  });
});

describe('env config: prod-mode fail-fast (staging runtime)', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('throws when JWT_SIGNER is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /JWT_SIGNER must be set explicitly in production/,
    );
  });

  it('throws when JWT_SIGNER has an invalid value', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'bogus';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /JWT_SIGNER must be 'kms' or 'local', got: bogus/,
    );
  });

  it('throws when JWT_SIGNER=kms but JWT_KMS_KEY_ID is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'kms';
    process.env.SES_ADAPTER = 'stub';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /JWT_KMS_KEY_ID is required when JWT_SIGNER=kms/,
    );
  });

  it('throws when SES_ADAPTER is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /SES_ADAPTER must be set explicitly in production/,
    );
  });

  it('throws when SES_ADAPTER has an invalid value', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'bogus';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /SES_ADAPTER must be 'live' or 'stub', got: bogus/,
    );
  });

  it('throws when SES_ADAPTER=live but SES_FROM_IDENTITY is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'live';
    process.env.AWS_REGION = 'us-east-1';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /SES_FROM_IDENTITY is required when SES_ADAPTER=live/,
    );
  });

  it('throws when JWT_SIGNER=kms or SES_ADAPTER=live but AWS_REGION is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'kms';
    process.env.JWT_KMS_KEY_ID = 'arn:aws:kms:us-east-1:0:key/x';
    process.env.SES_ADAPTER = 'stub';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    process.env.PHOTO_STORAGE_ADAPTER = 'local';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /AWS_REGION is required when JWT_SIGNER=kms/,
    );
  });

  it('throws when SESSION_SECRET is shorter than 32 characters', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'stub';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    process.env.PHOTO_STORAGE_ADAPTER = 'local';
    process.env.SESSION_SECRET = 'a'.repeat(31);
    await expect(import('../../src/config/env')).rejects.toThrow(
      /SESSION_SECRET must be at least 32 characters in production/,
    );
  });

  it('throws when SESSION_SECRET contains the "changeme" placeholder', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'stub';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    process.env.PHOTO_STORAGE_ADAPTER = 'local';
    process.env.SESSION_SECRET = 'a'.repeat(20) + 'changeme' + 'b'.repeat(20);
    await expect(import('../../src/config/env')).rejects.toThrow(
      /SESSION_SECRET appears to contain the \.env\.example placeholder/,
    );
  });

  it('loads successfully with a complete staging-style configuration', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'kms';
    process.env.JWT_KMS_KEY_ID =
      'arn:aws:kms:us-east-1:000000000000:key/abcd-efgh';
    process.env.SES_ADAPTER = 'live';
    process.env.SES_FROM_IDENTITY = 'noreply@footbag.org';
    process.env.AWS_REGION = 'us-east-1';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    process.env.PHOTO_STORAGE_ADAPTER = 'local';
    const { config } = await import('../../src/config/env');
    expect(config.jwtSigner).toBe('kms');
    expect(config.jwtKmsKeyId).toBe(
      'arn:aws:kms:us-east-1:000000000000:key/abcd-efgh',
    );
    expect(config.sesAdapter).toBe('live');
    expect(config.sesFromIdentity).toBe('noreply@footbag.org');
    expect(config.awsRegion).toBe('us-east-1');
    expect(config.imageProcessorUrl).toBe('http://image:4000');
    expect(config.photoStorageAdapter).toBe('local');
  });

  it('throws when IMAGE_PROCESSOR_URL is unset in production', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'stub';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /IMAGE_PROCESSOR_URL must be set explicitly in production/,
    );
  });
});

describe('env config: PHOTO_STORAGE_*', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('defaults to local when unset outside production', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    const { config } = await import('../../src/config/env');
    expect(config.photoStorageAdapter).toBe('local');
    expect(config.photoStorageS3Bucket).toBeUndefined();
  });

  it('throws when PHOTO_STORAGE_ADAPTER is unset in production', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'stub';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /PHOTO_STORAGE_ADAPTER must be set explicitly in production/,
    );
  });

  it('throws on invalid PHOTO_STORAGE_ADAPTER value', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.PHOTO_STORAGE_ADAPTER = 'gcs';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /PHOTO_STORAGE_ADAPTER must be 's3' or 'local', got: gcs/,
    );
  });

  it('throws when PHOTO_STORAGE_ADAPTER=s3 but PHOTO_STORAGE_S3_BUCKET is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.PHOTO_STORAGE_ADAPTER = 's3';
    process.env.AWS_REGION = 'us-east-1';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /PHOTO_STORAGE_S3_BUCKET is required when PHOTO_STORAGE_ADAPTER=s3/,
    );
  });

  it('throws when PHOTO_STORAGE_ADAPTER=s3 but AWS_REGION is unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.PHOTO_STORAGE_ADAPTER = 's3';
    process.env.PHOTO_STORAGE_S3_BUCKET = 'media-bucket-1';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /AWS_REGION is required.*PHOTO_STORAGE_ADAPTER=s3/,
    );
  });

  it('accepts an explicit local configuration', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.PHOTO_STORAGE_ADAPTER = 'local';
    const { config } = await import('../../src/config/env');
    expect(config.photoStorageAdapter).toBe('local');
    expect(config.photoStorageS3Bucket).toBeUndefined();
  });

  it('accepts a fully-populated s3 configuration', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'stub';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    process.env.PHOTO_STORAGE_ADAPTER = 's3';
    process.env.PHOTO_STORAGE_S3_BUCKET = 'footbag-staging-media';
    process.env.AWS_REGION = 'us-east-1';
    const { config } = await import('../../src/config/env');
    expect(config.photoStorageAdapter).toBe('s3');
    expect(config.photoStorageS3Bucket).toBe('footbag-staging-media');
    expect(config.awsRegion).toBe('us-east-1');
  });
});

describe('env config: IMAGE_* parsing and defaults', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('uses dev defaults when IMAGE_* vars are unset outside production', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    const { config } = await import('../../src/config/env');
    expect(config.imageProcessorUrl).toBe('http://localhost:4001');
    expect(config.imageMaxConcurrent).toBe(2);
    expect(config.imagePort).toBe(4000);
    expect(config.imageProcessTimeoutMs).toBe(30000);
  });

  it('honors IMAGE_PROCESSOR_URL when set', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_PROCESSOR_URL = 'http://image:4000';
    const { config } = await import('../../src/config/env');
    expect(config.imageProcessorUrl).toBe('http://image:4000');
  });

  it('throws when IMAGE_MAX_CONCURRENT is non-numeric', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_MAX_CONCURRENT = 'abc';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /IMAGE_MAX_CONCURRENT must be a positive integer/,
    );
  });

  it('throws when IMAGE_MAX_CONCURRENT is out of range', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_MAX_CONCURRENT = '99';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /IMAGE_MAX_CONCURRENT must be between 1 and 16/,
    );
  });

  it('throws when IMAGE_PORT is non-numeric', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_PORT = 'not-a-port';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /IMAGE_PORT must be a positive integer/,
    );
  });

  it('throws when IMAGE_PORT is out of range', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_PORT = '99999';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /IMAGE_PORT must be between 1 and 65535/,
    );
  });

  it('throws when IMAGE_PROCESS_TIMEOUT_MS is non-numeric', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_PROCESS_TIMEOUT_MS = 'never';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /IMAGE_PROCESS_TIMEOUT_MS must be a positive integer/,
    );
  });

  it('parses valid IMAGE_* integers', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.IMAGE_MAX_CONCURRENT = '5';
    process.env.IMAGE_PORT = '4500';
    process.env.IMAGE_PROCESS_TIMEOUT_MS = '15000';
    const { config } = await import('../../src/config/env');
    expect(config.imageMaxConcurrent).toBe(5);
    expect(config.imagePort).toBe(4500);
    expect(config.imageProcessTimeoutMs).toBe(15000);
  });
});

describe('env config: SES_SANDBOX_MODE', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('defaults to false when unset', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    const { config } = await import('../../src/config/env');
    expect(config.sesSandboxMode).toBe(false);
  });

  it('accepts "1" and "true" as true', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.SES_SANDBOX_MODE = '1';
    const { config } = await import('../../src/config/env');
    expect(config.sesSandboxMode).toBe(true);

    vi.resetModules();
    process.env.SES_SANDBOX_MODE = 'true';
    const { config: c2 } = await import('../../src/config/env');
    expect(c2.sesSandboxMode).toBe(true);
  });

  it('accepts "0" and "false" as false', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.SES_SANDBOX_MODE = '0';
    const { config } = await import('../../src/config/env');
    expect(config.sesSandboxMode).toBe(false);

    vi.resetModules();
    process.env.SES_SANDBOX_MODE = 'false';
    const { config: c2 } = await import('../../src/config/env');
    expect(c2.sesSandboxMode).toBe(false);
  });

  it('throws on any other value', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'development';
    process.env.SES_SANDBOX_MODE = 'yes';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /SES_SANDBOX_MODE must be '1', '0', 'true', or 'false', got: yes/,
    );
  });
});

describe('env config: PORT validation', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('throws on non-numeric PORT', async () => {
    baselineRequired();
    process.env.NODE_ENV = 'development';
    process.env.PORT = 'not-a-port';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /PORT must be a valid integer between 1 and 65535/,
    );
  });

  it('throws on out-of-range PORT', async () => {
    baselineRequired();
    process.env.NODE_ENV = 'development';
    process.env.PORT = '99999';
    await expect(import('../../src/config/env')).rejects.toThrow(
      /PORT must be a valid integer between 1 and 65535/,
    );
  });
});
