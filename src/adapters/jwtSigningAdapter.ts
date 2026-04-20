/**
 * JwtSigningAdapter: interface + implementations + singleton getter for the
 * adapters layer. `KmsJwtAdapter` signs via
 * AWS KMS in production; `LocalJwtAdapter` signs with a file-based RSA
 * keypair in dev/test. The JwtSigningAdapter interface is the single swap
 * point between the two, enabling dev/prod parity with identical
 * service-layer code paths in both environments.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
} from '@aws-sdk/client-kms';
import { config } from '../config/env';

export interface JwtClaims {
  sub: string;
  role?: string;
  passwordVersion: number;
  iat: number;
  exp: number;
}

export interface JwtSigningAdapter {
  readonly kid: string;
  signJwt(
    claims: Omit<JwtClaims, 'iat' | 'exp'>,
    ttlSeconds?: number,
  ): Promise<string>;
  verifyJwt(token: string): Promise<JwtClaims | null>;
}

export const DEFAULT_TTL_SECONDS = 10 * 60;
const PUBLIC_KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(base64, 'base64');
}

function encodeHeaderPayload(kid: string, claims: JwtClaims): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const h = b64urlEncode(Buffer.from(JSON.stringify(header)));
  const p = b64urlEncode(Buffer.from(JSON.stringify(claims)));
  return `${h}.${p}`;
}

function parseToken(
  token: string,
): { signingInput: string; header: unknown; payload: unknown; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(b64urlDecode(h).toString('utf8'));
    const payload = JSON.parse(b64urlDecode(p).toString('utf8'));
    const signature = b64urlDecode(s);
    return { signingInput: `${h}.${p}`, header, payload, signature };
  } catch {
    return null;
  }
}

function isValidClaims(payload: unknown): payload is JwtClaims {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.sub === 'string' &&
    typeof p.passwordVersion === 'number' &&
    typeof p.iat === 'number' &&
    typeof p.exp === 'number'
  );
}

function hasExpired(claims: JwtClaims, nowSeconds: number): boolean {
  return claims.exp <= nowSeconds;
}

function loadOrCreateLocalKeypair(keypairPath: string): {
  privateKey: string;
  publicKey: string;
} {
  const abs = path.isAbsolute(keypairPath)
    ? keypairPath
    : path.join(process.cwd(), keypairPath);

  if (fs.existsSync(abs)) {
    const privateKey = fs.readFileSync(abs, 'utf8');
    const publicKey = crypto
      .createPublicKey(privateKey)
      .export({ type: 'spki', format: 'pem' })
      .toString();
    return { privateKey, publicKey };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, privateKey, { mode: 0o600 });
  return { privateKey, publicKey };
}

export function createLocalJwtAdapter(opts: {
  keypairPath: string;
  kid?: string;
}): JwtSigningAdapter {
  const { privateKey, publicKey } = loadOrCreateLocalKeypair(opts.keypairPath);
  const kid = opts.kid ?? 'local-test-kid';

  return {
    kid,
    async signJwt(claims, ttlSeconds = DEFAULT_TTL_SECONDS) {
      const now = Math.floor(Date.now() / 1000);
      const full: JwtClaims = { ...claims, iat: now, exp: now + ttlSeconds };
      const signingInput = encodeHeaderPayload(kid, full);
      const signature = crypto.sign(
        'sha256',
        Buffer.from(signingInput),
        privateKey,
      );
      return `${signingInput}.${b64urlEncode(signature)}`;
    },
    async verifyJwt(token) {
      const parsed = parseToken(token);
      if (!parsed) return null;
      const { signingInput, header, payload, signature } = parsed;
      if (!header || typeof header !== 'object') return null;
      if ((header as Record<string, unknown>).alg !== 'RS256') return null;
      if (!isValidClaims(payload)) return null;
      const ok = crypto.verify(
        'sha256',
        Buffer.from(signingInput),
        publicKey,
        signature,
      );
      if (!ok) return null;
      if (hasExpired(payload, Math.floor(Date.now() / 1000))) return null;
      return payload;
    },
  };
}

function derToPem(derBytes: Uint8Array): string {
  const base64 = Buffer.from(derBytes).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

export function createKmsJwtAdapter(opts: {
  keyId: string;
  region?: string;
  kmsClient?: KMSClient;
}): JwtSigningAdapter {
  const client =
    opts.kmsClient ??
    new KMSClient(opts.region ? { region: opts.region } : {});
  const kid = opts.keyId;

  let cachedPem: string | null = null;
  let cachedAt = 0;

  async function publicKeyPem(): Promise<string> {
    const now = Date.now();
    if (cachedPem && now - cachedAt < PUBLIC_KEY_CACHE_TTL_MS) {
      return cachedPem;
    }
    const res = await client.send(
      new GetPublicKeyCommand({ KeyId: opts.keyId }),
    );
    if (!res.PublicKey) {
      throw new Error('KMS GetPublicKey returned no PublicKey');
    }
    cachedPem = derToPem(res.PublicKey);
    cachedAt = now;
    return cachedPem;
  }

  return {
    kid,
    async signJwt(claims, ttlSeconds = DEFAULT_TTL_SECONDS) {
      const now = Math.floor(Date.now() / 1000);
      const full: JwtClaims = { ...claims, iat: now, exp: now + ttlSeconds };
      const signingInput = encodeHeaderPayload(kid, full);
      const res = await client.send(
        new SignCommand({
          KeyId: opts.keyId,
          Message: Buffer.from(signingInput),
          MessageType: 'RAW',
          SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
        }),
      );
      if (!res.Signature) {
        throw new Error('KMS Sign returned no Signature');
      }
      return `${signingInput}.${b64urlEncode(Buffer.from(res.Signature))}`;
    },
    async verifyJwt(token) {
      const parsed = parseToken(token);
      if (!parsed) return null;
      const { signingInput, header, payload, signature } = parsed;
      if (!header || typeof header !== 'object') return null;
      if ((header as Record<string, unknown>).alg !== 'RS256') return null;
      if (!isValidClaims(payload)) return null;
      const pem = await publicKeyPem();
      const ok = crypto.verify(
        'sha256',
        Buffer.from(signingInput),
        pem,
        signature,
      );
      if (!ok) return null;
      if (hasExpired(payload, Math.floor(Date.now() / 1000))) return null;
      return payload;
    },
  };
}

let singleton: JwtSigningAdapter | null = null;

export function getJwtSigningAdapter(): JwtSigningAdapter {
  if (singleton) return singleton;
  if (config.jwtSigner === 'kms') {
    if (!config.jwtKmsKeyId) {
      throw new Error('JWT_KMS_KEY_ID is required when JWT_SIGNER=kms');
    }
    singleton = createKmsJwtAdapter({
      keyId: config.jwtKmsKeyId,
      region: config.awsRegion,
    });
  } else {
    singleton = createLocalJwtAdapter({ keypairPath: config.jwtLocalKeypairPath });
  }
  return singleton;
}

export function resetJwtSigningAdapterForTests(): void {
  singleton = null;
}
