/**
 * Environment configuration for the Footbag platform.
 *
 * Canonical deploy-time configuration loader. Validates
 * required environment variables at module-load time so that
 * misconfiguration surfaces immediately at startup rather than at
 * first request. Expects dotenv to have been loaded before this module
 * is imported (i.e. `import 'dotenv/config'` must appear first in server.ts).
 *
 * Every module in src/ reads configuration through the exported `config`
 * singleton; no other module reads `process.env` directly. The singleton
 * is frozen after construction to prevent mutation.
 */

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  dbPath: string;
  publicBaseUrl: string;
  sessionSecret: string;
  mediaDir: string;
  jwtSigner: 'kms' | 'local';
  jwtKmsKeyId: string | undefined;
  jwtLocalKeypairPath: string;
  awsRegion: string | undefined;
  sesAdapter: 'live' | 'stub';
  sesSandboxMode: boolean;
  sesFromIdentity: string | undefined;
  imageProcessorUrl: string;
  imageMaxConcurrent: number;
  imagePort: number;
  imageProcessTimeoutMs: number;
  photoStorageAdapter: 's3' | 'local';
  photoStorageS3Bucket: string | undefined;
  // Value for Express's `trust proxy` setting. Number, boolean, or
  // comma-separated subnet/IP list — anything Express's setting accepts.
  // Default: 2 in production (CloudFront + nginx), 0 elsewhere.
  trustProxy: number | boolean | string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): AppConfig {
  const rawPort = requireEnv('PORT');
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid integer between 1 and 65535, got: ${rawPort}`);
  }

  const nodeEnv = requireEnv('NODE_ENV');
  const isProd = nodeEnv === 'production';

  const rawJwtSigner = process.env.JWT_SIGNER;
  let jwtSigner: 'kms' | 'local';
  if (rawJwtSigner === 'kms' || rawJwtSigner === 'local') {
    jwtSigner = rawJwtSigner;
  } else if (rawJwtSigner) {
    throw new Error(`JWT_SIGNER must be 'kms' or 'local', got: ${rawJwtSigner}`);
  } else if (isProd) {
    throw new Error('JWT_SIGNER must be set explicitly in production (no default)');
  } else {
    jwtSigner = 'local';
  }

  const jwtKmsKeyId = process.env.JWT_KMS_KEY_ID || undefined;
  if (jwtSigner === 'kms' && !jwtKmsKeyId) {
    throw new Error('JWT_KMS_KEY_ID is required when JWT_SIGNER=kms');
  }

  const jwtLocalKeypairPath =
    process.env.JWT_LOCAL_KEYPAIR_PATH || 'database/dev-jwt-keypair.pem';

  const rawSesAdapter = process.env.SES_ADAPTER;
  let sesAdapter: 'live' | 'stub';
  if (rawSesAdapter === 'live' || rawSesAdapter === 'stub') {
    sesAdapter = rawSesAdapter;
  } else if (rawSesAdapter) {
    throw new Error(`SES_ADAPTER must be 'live' or 'stub', got: ${rawSesAdapter}`);
  } else if (isProd) {
    throw new Error('SES_ADAPTER must be set explicitly in production (no default)');
  } else {
    sesAdapter = 'stub';
  }

  const sesFromIdentity = process.env.SES_FROM_IDENTITY || undefined;
  if (sesAdapter === 'live' && !sesFromIdentity) {
    throw new Error('SES_FROM_IDENTITY is required when SES_ADAPTER=live');
  }

  const rawSesSandbox = process.env.SES_SANDBOX_MODE;
  let sesSandboxMode: boolean;
  if (rawSesSandbox === undefined || rawSesSandbox === '') {
    sesSandboxMode = false;
  } else if (rawSesSandbox === '1' || rawSesSandbox === 'true') {
    sesSandboxMode = true;
  } else if (rawSesSandbox === '0' || rawSesSandbox === 'false') {
    sesSandboxMode = false;
  } else {
    throw new Error(`SES_SANDBOX_MODE must be '1', '0', 'true', or 'false', got: ${rawSesSandbox}`);
  }

  const awsRegion = process.env.AWS_REGION || undefined;

  const rawImageUrl = process.env.IMAGE_PROCESSOR_URL;
  let imageProcessorUrl: string;
  if (rawImageUrl) {
    imageProcessorUrl = rawImageUrl;
  } else if (isProd) {
    throw new Error('IMAGE_PROCESSOR_URL must be set explicitly in production (no default)');
  } else {
    imageProcessorUrl = 'http://localhost:4001';
  }

  const rawPhotoStorage = process.env.PHOTO_STORAGE_ADAPTER;
  let photoStorageAdapter: 's3' | 'local';
  if (rawPhotoStorage === 's3' || rawPhotoStorage === 'local') {
    photoStorageAdapter = rawPhotoStorage;
  } else if (rawPhotoStorage) {
    throw new Error(
      `PHOTO_STORAGE_ADAPTER must be 's3' or 'local', got: ${rawPhotoStorage}`,
    );
  } else if (isProd) {
    throw new Error(
      'PHOTO_STORAGE_ADAPTER must be set explicitly in production (no default)',
    );
  } else {
    photoStorageAdapter = 'local';
  }

  const photoStorageS3Bucket = process.env.PHOTO_STORAGE_S3_BUCKET || undefined;
  if (photoStorageAdapter === 's3' && !photoStorageS3Bucket) {
    throw new Error(
      'PHOTO_STORAGE_S3_BUCKET is required when PHOTO_STORAGE_ADAPTER=s3',
    );
  }

  if (
    (jwtSigner === 'kms' ||
      sesAdapter === 'live' ||
      photoStorageAdapter === 's3') &&
    !awsRegion
  ) {
    throw new Error(
      'AWS_REGION is required when JWT_SIGNER=kms, SES_ADAPTER=live, or PHOTO_STORAGE_ADAPTER=s3',
    );
  }

  function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    if (!/^\d+$/.test(raw)) {
      throw new Error(`${name} must be a positive integer, got: ${raw}`);
    }
    const n = parseInt(raw, 10);
    if (n < min || n > max) {
      throw new Error(`${name} must be between ${min} and ${max}, got: ${raw}`);
    }
    return n;
  }

  const imageMaxConcurrent = parseIntEnv('IMAGE_MAX_CONCURRENT', 2, 1, 16);
  const imagePort = parseIntEnv('IMAGE_PORT', 4000, 1, 65535);
  const imageProcessTimeoutMs = parseIntEnv('IMAGE_PROCESS_TIMEOUT_MS', 30000, 1, 600000);

  const rawTrustProxy = process.env.TRUST_PROXY;
  let trustProxy: number | boolean | string;
  if (rawTrustProxy === undefined || rawTrustProxy === '') {
    trustProxy = isProd ? 'loopback, linklocal, uniquelocal' : 0;
  } else if (/^\d+$/.test(rawTrustProxy)) {
    trustProxy = parseInt(rawTrustProxy, 10);
  } else if (rawTrustProxy === 'true' || rawTrustProxy === 'false') {
    trustProxy = rawTrustProxy === 'true';
  } else {
    trustProxy = rawTrustProxy;
  }

  const sessionSecret = requireEnv('SESSION_SECRET');
  if (isProd) {
    if (sessionSecret.length < 32) {
      throw new Error(
        'SESSION_SECRET must be at least 32 characters in production. Generate with: openssl rand -hex 32',
      );
    }
    if (sessionSecret.toLowerCase().includes('changeme')) {
      throw new Error(
        'SESSION_SECRET appears to contain the .env.example placeholder ("changeme"). Generate a fresh value with: openssl rand -hex 32',
      );
    }
  }

  return {
    port,
    nodeEnv,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    dbPath: requireEnv('FOOTBAG_DB_PATH'),
    publicBaseUrl: requireEnv('PUBLIC_BASE_URL'),
    sessionSecret,
    mediaDir: process.env.FOOTBAG_MEDIA_DIR || './data/media',
    jwtSigner,
    jwtKmsKeyId,
    jwtLocalKeypairPath,
    awsRegion,
    sesAdapter,
    sesSandboxMode,
    sesFromIdentity,
    imageProcessorUrl,
    imageMaxConcurrent,
    imagePort,
    imageProcessTimeoutMs,
    photoStorageAdapter,
    photoStorageS3Bucket,
    trustProxy,
  };
}

export const config: AppConfig = Object.freeze(loadConfig());
