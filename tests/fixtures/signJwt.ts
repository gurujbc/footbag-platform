/**
 * Test-only synchronous JWT minter. Produces a JWT using the same wire
 * format the production `LocalJwtAdapter` uses, so tokens minted here
 * verify against the app's async middleware running with
 * `JWT_SIGNER=local`. Deliberately standalone — no imports from
 * `src/config/env.ts` or the service-layer adapter chain — so that
 * static-importing this file from test fixtures does not load the
 * production config singleton before per-test-file `setTestEnv()`
 * has had a chance to mutate `process.env`.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TestJwtClaims {
  sub: string;
  role?: string;
  passwordVersion: number;
  iat: number;
  exp: number;
}

const DEFAULT_TTL_SECONDS = 10 * 60;

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeHeaderPayload(kid: string, claims: TestJwtClaims): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const h = b64urlEncode(Buffer.from(JSON.stringify(header)));
  const p = b64urlEncode(Buffer.from(JSON.stringify(claims)));
  return `${h}.${p}`;
}

function loadOrCreateLocalKeypair(keypairPath: string): {
  privateKey: string;
  publicKey: string;
} {
  const abs = path.isAbsolute(keypairPath)
    ? keypairPath
    : path.resolve(process.cwd(), keypairPath);

  if (fs.existsSync(abs)) {
    const privateKey = fs.readFileSync(abs, 'utf8');
    const pubKeyObj = crypto.createPublicKey(privateKey);
    const publicKey = pubKeyObj.export({ type: 'spki', format: 'pem' }) as string;
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

export function signJwtLocalSync(
  keypairPath: string,
  claims: Omit<TestJwtClaims, 'iat' | 'exp'>,
  opts: { kid?: string; ttlSeconds?: number } = {},
): string {
  const { privateKey } = loadOrCreateLocalKeypair(keypairPath);
  const kid = opts.kid ?? 'local-test-kid';
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const full: TestJwtClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const signingInput = encodeHeaderPayload(kid, full);
  const signature = crypto.sign(
    'sha256',
    Buffer.from(signingInput),
    privateKey,
  );
  return `${signingInput}.${b64urlEncode(signature)}`;
}
