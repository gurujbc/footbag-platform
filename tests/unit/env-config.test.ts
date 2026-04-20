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
  delete process.env.AWS_REGION;
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
    await expect(import('../../src/config/env')).rejects.toThrow(
      /AWS_REGION is required when JWT_SIGNER=kms or SES_ADAPTER=live/,
    );
  });

  it('throws when SESSION_SECRET is shorter than 32 characters', async () => {
    baselineRequired();
    clearAwsWiring();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SIGNER = 'local';
    process.env.SES_ADAPTER = 'stub';
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
    const { config } = await import('../../src/config/env');
    expect(config.jwtSigner).toBe('kms');
    expect(config.jwtKmsKeyId).toBe(
      'arn:aws:kms:us-east-1:000000000000:key/abcd-efgh',
    );
    expect(config.sesAdapter).toBe('live');
    expect(config.sesFromIdentity).toBe('noreply@footbag.org');
    expect(config.awsRegion).toBe('us-east-1');
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
