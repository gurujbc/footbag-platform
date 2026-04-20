/**
 * Dev↔staging adapter parity contract.
 *
 * The JwtSigningAdapter, SesAdapter, and PhotoStorageAdapter interfaces are
 * the only seam between dev and staging. Both implementations must produce
 * observable outputs with identical structure so the service layer above is
 * free of environment-specific branching. These tests exercise both sides of
 * each seam with injected fake clients standing in for real AWS.
 *
 * Live-AWS parity (kms:Sign, ses:SendEmail actually reaching AWS) is covered
 * in tests/smoke/staging-readiness.test.ts, which is gated behind
 * RUN_STAGING_SMOKE=1 and excluded from the default npm test run.
 */
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
import { SendEmailCommand, type SESClient } from '@aws-sdk/client-ses';
import {
  createLocalJwtAdapter,
  createKmsJwtAdapter,
} from '../../src/adapters/jwtSigningAdapter';
import {
  createStubSesAdapter,
  createLiveSesAdapter,
} from '../../src/adapters/sesAdapter';
import {
  createLocalPhotoStorageAdapter,
  type PhotoStorageAdapter,
} from '../../src/adapters/photoStorageAdapter';

function makeFakeKmsClient(): KMSClient {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fake = {
    send: async (cmd: unknown): Promise<unknown> => {
      if (cmd instanceof GetPublicKeyCommand) {
        return { PublicKey: new Uint8Array(publicKey) };
      }
      if (cmd instanceof SignCommand) {
        const message = Buffer.from(cmd.input.Message as Uint8Array);
        const sig = crypto.sign('sha256', message, privateKey);
        return { Signature: new Uint8Array(sig) };
      }
      throw new Error('unexpected KMS command');
    },
  };
  return fake as unknown as KMSClient;
}

function makeFakeSesClient(): { client: SESClient; captured: SendEmailCommand[] } {
  const captured: SendEmailCommand[] = [];
  const fake = {
    send: async (cmd: unknown): Promise<unknown> => {
      if (cmd instanceof SendEmailCommand) {
        captured.push(cmd);
        return { MessageId: `fake-${captured.length}` };
      }
      throw new Error('unexpected SES command');
    },
  };
  return { client: fake as unknown as SESClient, captured };
}

function b64urlDecodeJson(seg: string): Record<string, unknown> {
  const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
  const base64 = seg.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

describe('adapter-parity: JwtSigningAdapter (Local vs. KMS wire format)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-parity-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function makePair() {
    const local = createLocalJwtAdapter({
      keypairPath: path.join(tmpDir, 'keypair.pem'),
      kid: 'local-parity-kid',
    });
    const kms = createKmsJwtAdapter({
      keyId: 'arn:aws:kms:us-east-1:000000000000:key/parity-test',
      kmsClient: makeFakeKmsClient(),
    });
    return { local, kms };
  }

  it('both produce three dot-separated base64url segments', async () => {
    const { local, kms } = makePair();
    const claims = { sub: 'm-1', passwordVersion: 1 };
    const tokens = [await local.signJwt(claims), await kms.signJwt(claims)];
    for (const token of tokens) {
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
      for (const seg of parts) {
        expect(seg).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    }
  });

  it('both emit headers with alg=RS256, typ=JWT, non-empty kid', async () => {
    const { local, kms } = makePair();
    const claims = { sub: 'm-1', passwordVersion: 1 };
    for (const token of [await local.signJwt(claims), await kms.signJwt(claims)]) {
      const header = b64urlDecodeJson(token.split('.')[0]);
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');
      expect(typeof header.kid).toBe('string');
      expect((header.kid as string).length).toBeGreaterThan(0);
    }
  });

  it('both embed sub, passwordVersion, iat, exp in the payload', async () => {
    const { local, kms } = makePair();
    const claims = { sub: 'm-99', passwordVersion: 42 };
    for (const token of [await local.signJwt(claims), await kms.signJwt(claims)]) {
      const payload = b64urlDecodeJson(token.split('.')[1]);
      expect(payload.sub).toBe('m-99');
      expect(payload.passwordVersion).toBe(42);
      expect(typeof payload.iat).toBe('number');
      expect(typeof payload.exp).toBe('number');
      expect(payload.exp as number).toBeGreaterThan(payload.iat as number);
    }
  });

  it('both round-trip their own signatures through verifyJwt', async () => {
    const { local, kms } = makePair();
    const claims = { sub: 'm-1', passwordVersion: 1 };
    const localClaims = await local.verifyJwt(await local.signJwt(claims));
    const kmsClaims = await kms.verifyJwt(await kms.signJwt(claims));
    expect(localClaims).not.toBeNull();
    expect(kmsClaims).not.toBeNull();
    expect(localClaims!.sub).toBe('m-1');
    expect(kmsClaims!.sub).toBe('m-1');
  });

  it('both reject tokens with mismatched signatures', async () => {
    const { local, kms } = makePair();
    const claims = { sub: 'm-1', passwordVersion: 1 };
    const localTok = await local.signJwt(claims);
    const kmsTok = await kms.signJwt(claims);
    // Swapping signatures across signers must fail: different keypairs.
    const [lh, lp] = localTok.split('.');
    const [, , ks] = kmsTok.split('.');
    const crossed = `${lh}.${lp}.${ks}`;
    expect(await local.verifyJwt(crossed)).toBeNull();
  });
});

describe('adapter-parity: SesAdapter (Stub vs. Live interface)', () => {
  it('both return { messageId, deliveredAt } on successful send', async () => {
    const stub = createStubSesAdapter();
    const fakeSes = makeFakeSesClient();
    const live = createLiveSesAdapter({
      fromIdentity: 'noreply@footbag.org',
      sesClient: fakeSes.client,
    });

    const msg = { to: 'user@example.com', subject: 'Hi', bodyText: 'Body' };
    for (const result of [await stub.sendEmail(msg), await live.sendEmail(msg)]) {
      expect(typeof result.messageId).toBe('string');
      expect(result.messageId.length).toBeGreaterThan(0);
      expect(typeof result.deliveredAt).toBe('string');
      expect(Number.isNaN(new Date(result.deliveredAt).getTime())).toBe(false);
    }
  });

  it('both honor the optional per-message from override', async () => {
    const stub = createStubSesAdapter();
    const fakeSes = makeFakeSesClient();
    const live = createLiveSesAdapter({
      fromIdentity: 'default@footbag.org',
      sesClient: fakeSes.client,
    });

    const msg = {
      to: 'u@example.com',
      subject: 'Hi',
      bodyText: 'B',
      from: 'override@footbag.org',
    };
    await stub.sendEmail(msg);
    await live.sendEmail(msg);

    expect(stub.sentMessages[0].from).toBe('override@footbag.org');
    expect(fakeSes.captured[0].input.Source).toBe('override@footbag.org');
  });

  it('both apply the default sender when the message omits from', async () => {
    const stub = createStubSesAdapter();
    const fakeSes = makeFakeSesClient();
    const live = createLiveSesAdapter({
      fromIdentity: 'default@footbag.org',
      sesClient: fakeSes.client,
    });

    const msg = { to: 'u@example.com', subject: 'S', bodyText: 'B' };
    await stub.sendEmail(msg);
    await live.sendEmail(msg);

    // Stub records the original msg (with no from). Live applies the default.
    expect(stub.sentMessages[0].from).toBeUndefined();
    expect(fakeSes.captured[0].input.Source).toBe('default@footbag.org');
  });
});

describe('adapter-parity: PhotoStorageAdapter contract', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-parity-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('local adapter satisfies put/exists/delete/constructURL', async () => {
    const adapter: PhotoStorageAdapter = createLocalPhotoStorageAdapter({
      baseDir: tmpDir,
    });
    const key = 'avatars/parity-test.bin';
    expect(await adapter.exists(key)).toBe(false);
    await adapter.put(key, Buffer.from('parity-data'));
    expect(await adapter.exists(key)).toBe(true);
    expect(adapter.constructURL(key)).toContain(key);
    await adapter.delete(key);
    expect(await adapter.exists(key)).toBe(false);
  });

  it('delete is idempotent for a missing key', async () => {
    const adapter = createLocalPhotoStorageAdapter({ baseDir: tmpDir });
    await expect(adapter.delete('never/written.bin')).resolves.toBeUndefined();
  });
});
