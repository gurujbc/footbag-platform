/**
 * Compose-file ↔ env.ts parity contract.
 *
 * Long-term contract: every committed docker-compose configuration that
 * launches the web or worker service must declare an environment block
 * which, after `${VAR}` / `${VAR:-default}` interpolation, yields a
 * process.env that `src/config/env.ts`'s `loadConfig()` accepts. The image
 * service must declare env values its in-process `parseIntEnv` accepts.
 *
 * Without this contract the compose stack ships configurations the runtime
 * rejects and the failure surfaces only at `docker compose up` time on a
 * developer machine or staging host.
 *
 * Specifically defends against: hardcoding `NODE_ENV=production` in a
 * service environment block while omitting prod-mode required vars
 * (JWT_SIGNER, SES_ADAPTER, IMAGE_PROCESSOR_URL, ...) -- the container
 * fails fast at module load because env.ts requires those when isProd.
 *
 * Scope: dev (`docker/docker-compose.yml` alone), staging
 * (`docker-compose.yml` + `docker-compose.prod.yml` with staging-shape
 * values), and production (same overlay pair with production-shape
 * values). Production differs from staging only in env-var values
 * (bucket names, profile names, KMS ARN, SES identity, sandbox flag,
 * IMAGE_MAX_CONCURRENT); the compose env block is identical for both
 * deployed tiers, so divergence is caught here at the fixture level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

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

interface ComposeService {
  environment?: Record<string, string | number | boolean> | string[];
  restart?: string;
  deploy?: { resources?: { limits?: { memory?: string } } };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
}

/**
 * Resolve compose `${VAR}` and `${VAR:-default}` interpolation against a
 * supplied source map. Mirrors Docker Compose's substitution rules narrowly
 * enough to cover the syntax used in this repo's compose files.
 */
function interpolate(value: string, source: Record<string, string>): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g, (_, name, dflt) => {
    const v = source[name];
    return v !== undefined && v !== '' ? v : (dflt ?? '');
  });
}

/**
 * Build the synthetic container environment that compose would inject for
 * a given service. Only vars declared in `service.environment` end up in
 * the result, exactly as the running container would see it.
 */
function resolveServiceEnv(
  service: ComposeService,
  interpolationSrc: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!service.environment) return out;
  if (Array.isArray(service.environment)) {
    for (const entry of service.environment) {
      const eq = entry.indexOf('=');
      if (eq === -1) {
        const v = interpolationSrc[entry];
        if (v !== undefined) out[entry] = v;
      } else {
        const name = entry.slice(0, eq);
        const raw = entry.slice(eq + 1);
        out[name] = interpolate(raw, interpolationSrc);
      }
    }
  } else {
    for (const [name, raw] of Object.entries(service.environment)) {
      out[name] = interpolate(String(raw), interpolationSrc);
    }
  }
  return out;
}

function loadCompose(relPath: string): ComposeFile {
  const absPath = path.resolve(__dirname, '../..', relPath);
  return parseYaml(readFileSync(absPath, 'utf8')) as ComposeFile;
}

/**
 * Merge a base compose file with an overlay, mirroring `docker compose -f
 * base -f overlay` rules narrowly: services merged by name, environment
 * blocks merged key-by-key with overlay winning, restart/deploy fields
 * replaced wholesale by overlay.
 */
function mergeCompose(base: ComposeFile, overlay: ComposeFile): ComposeFile {
  const out: ComposeFile = { services: { ...base.services } };
  for (const [name, ovlSvc] of Object.entries(overlay.services)) {
    const baseSvc = base.services[name] ?? {};
    const baseEnv = normalizeEnv(baseSvc.environment);
    const ovlEnv = normalizeEnv(ovlSvc.environment);
    const merged: ComposeService = {
      ...baseSvc,
      ...ovlSvc,
      environment: { ...baseEnv, ...ovlEnv },
    };
    out.services[name] = merged;
  }
  return out;
}

function normalizeEnv(
  env: ComposeService['environment'],
): Record<string, string> {
  if (!env) return {};
  if (Array.isArray(env)) {
    const obj: Record<string, string> = {};
    for (const entry of env) {
      const eq = entry.indexOf('=');
      if (eq === -1) obj[entry] = '';
      else obj[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return obj;
  }
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) obj[k] = String(v);
  return obj;
}

/**
 * Dev interpolation fixture: provides values for every `${VAR}` referenced
 * by `docker/docker-compose.yml` alone. SESSION_SECRET must be 32+ chars
 * and not contain "changeme" so prod-mode guards accept it.
 */
const DEV_FIXTURE: Record<string, string> = {
  SESSION_SECRET: 'a'.repeat(48),
};

/**
 * Staging interpolation fixture: provides values for every `${VAR}` the
 * dev base + prod overlay reference together. Values are syntactically
 * valid for env.ts; they are not the real staging values (those live
 * in /srv/footbag/env on the host).
 */
const STAGING_FIXTURE: Record<string, string> = {
  ...DEV_FIXTURE,
  PUBLIC_BASE_URL: 'https://staging.example.com',
  X_ORIGIN_VERIFY_SECRET: 'stub-origin-verify-secret',
  AWS_PROFILE: 'stub-staging-runtime',
  AWS_REGION: 'us-east-1',
  JWT_SIGNER: 'kms',
  JWT_KMS_KEY_ID: 'arn:aws:kms:us-east-1:000000000000:key/stub-key',
  SES_ADAPTER: 'live',
  SES_FROM_IDENTITY: 'noreply@example.com',
  SES_SANDBOX_MODE: '1',
  IMAGE_PROCESSOR_URL: 'http://image:4000',
  IMAGE_MAX_CONCURRENT: '1',
  PHOTO_STORAGE_ADAPTER: 'local',
};

/**
 * Production interpolation fixture: same compose-overlay pair as staging,
 * with production-shape values. Sandbox-mode is off, IMAGE_MAX_CONCURRENT
 * is the DD §1.8 production target, PhotoStorage adapter is `s3` with a
 * production bucket name (which exercises the env.ts `PHOTO_STORAGE_S3_BUCKET`
 * required-when-s3 guard the staging fixture skips). Values are stub-but-
 * shape-valid; real production values live in the host env file.
 */
const PRODUCTION_FIXTURE: Record<string, string> = {
  ...DEV_FIXTURE,
  PUBLIC_BASE_URL: 'https://footbag.org',
  X_ORIGIN_VERIFY_SECRET: 'stub-prod-origin-verify-secret',
  AWS_PROFILE: 'stub-production-runtime',
  AWS_REGION: 'us-east-1',
  JWT_SIGNER: 'kms',
  JWT_KMS_KEY_ID: 'arn:aws:kms:us-east-1:111111111111:key/stub-prod-key',
  SES_ADAPTER: 'live',
  SES_FROM_IDENTITY: 'noreply@footbag.org',
  SES_SANDBOX_MODE: '0',
  IMAGE_PROCESSOR_URL: 'http://image:4000',
  IMAGE_MAX_CONCURRENT: '2',
  PHOTO_STORAGE_ADAPTER: 's3',
  PHOTO_STORAGE_S3_BUCKET: 'footbag-production-media',
};

async function loadEnvWith(containerEnv: Record<string, string>): Promise<void> {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, containerEnv);
  // env.ts evaluates loadConfig() at module load and exports a frozen
  // singleton; vi.resetModules() + dynamic import re-runs it.
  await import('../../src/config/env');
}

describe('compose ↔ env.ts parity (dev: docker-compose.yml alone)', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('web service env loads', async () => {
    const compose = loadCompose('docker/docker-compose.yml');
    const env = resolveServiceEnv(compose.services.web, DEV_FIXTURE);
    await expect(loadEnvWith(env)).resolves.toBeUndefined();
  });

  it('worker service env loads', async () => {
    const compose = loadCompose('docker/docker-compose.yml');
    // worker imports the same src/config/env.ts as web; dev compose runs it
    // under NODE_ENV=production, so it needs the same prod-mode passthroughs.
    // Worker compose env block lacks PORT (worker doesn't bind one); env.ts
    // still requires PORT to be present, so any test must supply a benign
    // PORT default. The fix on the compose side is to declare PORT in the
    // worker environment block.
    const env = resolveServiceEnv(compose.services.worker, DEV_FIXTURE);
    await expect(loadEnvWith(env)).resolves.toBeUndefined();
  });

  it('image service env values are valid for imageWorker parsers', () => {
    const compose = loadCompose('docker/docker-compose.yml');
    const env = resolveServiceEnv(compose.services.image, DEV_FIXTURE);
    // imageWorker.ts's parseIntEnv requires positive integers within bounds.
    // IMAGE_PORT [1, 65535]; IMAGE_MAX_CONCURRENT [1, 16].
    expect(env.IMAGE_PORT).toMatch(/^\d+$/);
    const port = parseInt(env.IMAGE_PORT, 10);
    expect(port).toBeGreaterThanOrEqual(1);
    expect(port).toBeLessThanOrEqual(65535);
    expect(env.IMAGE_MAX_CONCURRENT).toMatch(/^\d+$/);
    const maxC = parseInt(env.IMAGE_MAX_CONCURRENT, 10);
    expect(maxC).toBeGreaterThanOrEqual(1);
    expect(maxC).toBeLessThanOrEqual(16);
  });
});

describe('compose ↔ env.ts parity (staging: base + prod overlay)', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('web service env loads under staging fixture', async () => {
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.web, STAGING_FIXTURE);
    await expect(loadEnvWith(env)).resolves.toBeUndefined();
  });

  it('worker service env loads under staging fixture', async () => {
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.worker, STAGING_FIXTURE);
    await expect(loadEnvWith(env)).resolves.toBeUndefined();
  });

  it('image service env values remain valid under overlay', () => {
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.image, STAGING_FIXTURE);
    expect(env.IMAGE_PORT).toMatch(/^\d+$/);
    expect(env.IMAGE_MAX_CONCURRENT).toMatch(/^\d+$/);
  });
});

describe('compose ↔ env.ts parity (production: base + prod overlay)', () => {
  let snap: EnvSnapshot;
  beforeEach(() => {
    snap = snapshotEnv();
    vi.resetModules();
  });
  afterEach(() => restoreEnv(snap));

  it('web service env loads under production fixture', async () => {
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.web, PRODUCTION_FIXTURE);
    await expect(loadEnvWith(env)).resolves.toBeUndefined();
  });

  it('worker service env loads under production fixture', async () => {
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.worker, PRODUCTION_FIXTURE);
    await expect(loadEnvWith(env)).resolves.toBeUndefined();
  });

  it('image service env values remain valid under production fixture', () => {
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.image, PRODUCTION_FIXTURE);
    expect(env.IMAGE_PORT).toMatch(/^\d+$/);
    expect(env.IMAGE_MAX_CONCURRENT).toMatch(/^\d+$/);
  });

  it('PHOTO_STORAGE_S3_BUCKET is present when adapter=s3', () => {
    // env.ts rejects PHOTO_STORAGE_ADAPTER=s3 without a non-empty
    // PHOTO_STORAGE_S3_BUCKET. Production uses the s3 adapter; the fixture
    // and merged compose env must carry the bucket name for the merged env
    // to load, otherwise the web/worker tests above would fail-fast.
    const base = loadCompose('docker/docker-compose.yml');
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    const merged = mergeCompose(base, overlay);
    const env = resolveServiceEnv(merged.services.web, PRODUCTION_FIXTURE);
    expect(env.PHOTO_STORAGE_ADAPTER).toBe('s3');
    expect(env.PHOTO_STORAGE_S3_BUCKET).toBe('footbag-production-media');
  });
});

describe('compose cross-service consistency', () => {
  it('image IMAGE_PORT agrees with web IMAGE_PROCESSOR_URL port (dev)', () => {
    const compose = loadCompose('docker/docker-compose.yml');
    const webEnv = resolveServiceEnv(compose.services.web, DEV_FIXTURE);
    const imageEnv = resolveServiceEnv(compose.services.image, DEV_FIXTURE);
    const url = new URL(webEnv.IMAGE_PROCESSOR_URL);
    // url.port can be empty for default ports; compose explicitly sets one.
    expect(url.port).toBe(imageEnv.IMAGE_PORT);
    // Web reaches image by service name on the docker network.
    expect(url.hostname).toBe('image');
  });
});

describe('docker-compose.prod.yml structural invariants', () => {
  it('web and image have restart: always; worker has restart: unless-stopped', () => {
    // Web and image must auto-restart on any crash or OOM-kill (image's
    // OOM-recovery story depends on it). Worker is the email-outbox loop;
    // it's intentionally `unless-stopped` so an operator can stop it for
    // maintenance via `docker compose down` without it bouncing back.
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    expect(overlay.services.web.restart).toBe('always');
    expect(overlay.services.image.restart).toBe('always');
    expect(overlay.services.worker.restart).toBe('unless-stopped');
  });

  it('memory limits match documented nano_3_0 values', () => {
    // Documented in the compose file's deviation comments and in
    // IMPLEMENTATION_PLAN.md's photo-pipeline accepted-deviation entry.
    // If these change, both the comments and IP must be updated together.
    const overlay = loadCompose('docker/docker-compose.prod.yml');
    expect(overlay.services.nginx.deploy?.resources?.limits?.memory).toBe('64M');
    expect(overlay.services.web.deploy?.resources?.limits?.memory).toBe('192M');
    expect(overlay.services.worker.deploy?.resources?.limits?.memory).toBe('96M');
    expect(overlay.services.image.deploy?.resources?.limits?.memory).toBe('256M');
  });
});
