import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  GetPublicKeyCommand,
  SignCommand,
  type KMSClient,
} from '@aws-sdk/client-kms';
import {
  createLocalJwtAdapter,
  createKmsJwtAdapter,
  type JwtSigningAdapter,
} from '../../src/adapters/jwtSigningAdapter';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeLocalJwtAdapter(kid = 'test-kid'): JwtSigningAdapter {
  return createLocalJwtAdapter({
    keypairPath: path.join(tmpDir, 'keypair.pem'),
    kid,
  });
}

function decodeHeader(token: string): Record<string, unknown> {
  const [h] = token.split('.');
  const pad = h.length % 4 === 0 ? '' : '='.repeat(4 - (h.length % 4));
  const json = Buffer.from(
    h.replace(/-/g, '+').replace(/_/g, '/') + pad,
    'base64',
  ).toString('utf8');
  return JSON.parse(json);
}

describe('jwtService — LocalJwtAdapter', () => {
  it('round-trips sign and verify', async () => {
    const signer = makeLocalJwtAdapter();
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 3 });
    const claims = await signer.verifyJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('m-1');
    expect(claims!.passwordVersion).toBe(3);
    expect(claims!.exp).toBeGreaterThan(claims!.iat);
  });

  it('emits RS256 header with configured kid', async () => {
    const signer = makeLocalJwtAdapter('my-kid');
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 });
    const header = decodeHeader(token);
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe('my-kid');
  });

  it('rejects a tampered token', async () => {
    const signer = makeLocalJwtAdapter();
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 });
    const parts = token.split('.');
    const sigBytes = Buffer.from(
      parts[2].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    );
    sigBytes[0] ^= 0xff;
    const tampered =
      parts[0] +
      '.' +
      parts[1] +
      '.' +
      sigBytes
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    expect(await signer.verifyJwt(tampered)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const signer = makeLocalJwtAdapter();
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 }, -1);
    expect(await signer.verifyJwt(token)).toBeNull();
  });

  it('rejects a token with non-RS256 alg', async () => {
    const signer = makeLocalJwtAdapter();
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 });
    const [, p, s] = token.split('.');
    const badHeader = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'test-kid' }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await signer.verifyJwt(`${badHeader}.${p}.${s}`)).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const signer = makeLocalJwtAdapter();
    expect(await signer.verifyJwt('not-a-jwt')).toBeNull();
    expect(await signer.verifyJwt('only.two')).toBeNull();
  });

  it('persists the keypair across signer instances (same file)', async () => {
    const first = makeLocalJwtAdapter();
    const token = await first.signJwt({ sub: 'm-1', passwordVersion: 0 });
    const second = createLocalJwtAdapter({
      keypairPath: path.join(tmpDir, 'keypair.pem'),
      kid: 'test-kid',
    });
    expect(await second.verifyJwt(token)).not.toBeNull();
  });
});

describe('jwtService — KmsJwtAdapter (injected fake client)', () => {
  interface FakeKms {
    client: KMSClient;
    getPublicKeyCalls: () => number;
    lastSignCommand: () => SignCommand | null;
  }

  function makeFakeKms(): FakeKms {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    let getPublicKeyCalls = 0;
    let lastSign: SignCommand | null = null;
    const fake = {
      send: async (cmd: unknown): Promise<unknown> => {
        if (cmd instanceof GetPublicKeyCommand) {
          getPublicKeyCalls++;
          return { PublicKey: new Uint8Array(publicKey) };
        }
        if (cmd instanceof SignCommand) {
          lastSign = cmd;
          const input = cmd.input;
          if (input.SigningAlgorithm !== 'RSASSA_PKCS1_V1_5_SHA_256') {
            throw new Error(`unexpected alg: ${input.SigningAlgorithm}`);
          }
          if (input.MessageType !== 'RAW') {
            throw new Error(`unexpected MessageType: ${input.MessageType}`);
          }
          const message = Buffer.from(input.Message as Uint8Array);
          const signature = crypto.sign('sha256', message, privateKey);
          return { Signature: new Uint8Array(signature) };
        }
        throw new Error('unexpected command');
      },
    };
    return {
      client: fake as unknown as KMSClient,
      getPublicKeyCalls: () => getPublicKeyCalls,
      lastSignCommand: () => lastSign,
    };
  }

  it('round-trips sign and verify and uses RSASSA_PKCS1_V1_5_SHA_256', async () => {
    const fake = makeFakeKms();
    const signer = createKmsJwtAdapter({
      keyId: 'arn:aws:kms:us-east-1:0:key/abc',
      kmsClient: fake.client,
    });
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 7 });
    const claims = await signer.verifyJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.passwordVersion).toBe(7);
    const sent = fake.lastSignCommand();
    expect(sent).not.toBeNull();
    expect(sent!.input.SigningAlgorithm).toBe('RSASSA_PKCS1_V1_5_SHA_256');
    expect(sent!.input.MessageType).toBe('RAW');
  });

  it('puts the KMS key ARN in the JWT kid header', async () => {
    const fake = makeFakeKms();
    const keyId = 'arn:aws:kms:us-east-1:0:key/xyz';
    const signer = createKmsJwtAdapter({ keyId, kmsClient: fake.client });
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 });
    expect(decodeHeader(token).kid).toBe(keyId);
  });

  it('caches the public key across verify calls (one GetPublicKey per process)', async () => {
    const fake = makeFakeKms();
    const signer = createKmsJwtAdapter({
      keyId: 'arn:aws:kms:us-east-1:0:key/abc',
      kmsClient: fake.client,
    });
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 });
    await signer.verifyJwt(token);
    await signer.verifyJwt(token);
    await signer.verifyJwt(token);
    expect(fake.getPublicKeyCalls()).toBe(1);
  });

  it('rejects a tampered token', async () => {
    const fake = makeFakeKms();
    const signer = createKmsJwtAdapter({
      keyId: 'arn:aws:kms:us-east-1:0:key/abc',
      kmsClient: fake.client,
    });
    const token = await signer.signJwt({ sub: 'm-1', passwordVersion: 0 });
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAA${parts[2]}`;
    expect(await signer.verifyJwt(tampered)).toBeNull();
  });
});
