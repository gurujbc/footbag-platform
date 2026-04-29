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
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  createLocalPhotoStorageAdapter,
  createS3PhotoStorageAdapter,
  type PhotoStorageAdapter,
} from '../../src/adapters/photoStorageAdapter';
import {
  createHttpImageAdapter,
  ImageProcessingError,
} from '../../src/adapters/imageProcessingAdapter';
import sharp from 'sharp';
import { processAvatar } from '../../src/lib/imageProcessing';

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

interface FakeS3State {
  client: S3Client;
  puts: PutObjectCommand[];
  deletes: DeleteObjectCommand[];
  heads: HeadObjectCommand[];
  store: Map<string, Buffer>;
}

function makeFakeS3Client(): FakeS3State {
  const puts: PutObjectCommand[] = [];
  const deletes: DeleteObjectCommand[] = [];
  const heads: HeadObjectCommand[] = [];
  const store = new Map<string, Buffer>();
  const fake = {
    send: async (cmd: unknown): Promise<unknown> => {
      if (cmd instanceof PutObjectCommand) {
        puts.push(cmd);
        const body = cmd.input.Body as Buffer | Uint8Array;
        store.set(
          `${cmd.input.Bucket}/${cmd.input.Key}`,
          Buffer.isBuffer(body) ? body : Buffer.from(body),
        );
        return {};
      }
      if (cmd instanceof DeleteObjectCommand) {
        deletes.push(cmd);
        store.delete(`${cmd.input.Bucket}/${cmd.input.Key}`);
        return {};
      }
      if (cmd instanceof HeadObjectCommand) {
        heads.push(cmd);
        const lookupKey = `${cmd.input.Bucket}/${cmd.input.Key}`;
        if (store.has(lookupKey)) return {};
        const err = new Error('Not Found');
        err.name = 'NotFound';
        throw err;
      }
      throw new Error('unexpected S3 command');
    },
  };
  return {
    client: fake as unknown as S3Client,
    puts,
    deletes,
    heads,
    store,
  };
}

describe('adapter-parity: PhotoStorageAdapter S3 contract', () => {
  it('s3 adapter satisfies put/exists/delete/constructURL round-trip', async () => {
    const fake = makeFakeS3Client();
    const adapter = createS3PhotoStorageAdapter({
      bucket: 'parity-bucket',
      s3Client: fake.client,
    });
    const key = 'avatars/m-1/thumb.jpg';
    expect(await adapter.exists(key)).toBe(false);
    await adapter.put(key, Buffer.from('round-trip-bytes'));
    expect(await adapter.exists(key)).toBe(true);
    expect(adapter.constructURL(key)).toBe('/media/avatars/m-1/thumb.jpg');
    await adapter.delete(key);
    expect(await adapter.exists(key)).toBe(false);
  });

  it('s3 delete is idempotent for a missing key', async () => {
    const fake = makeFakeS3Client();
    const adapter = createS3PhotoStorageAdapter({
      bucket: 'parity-bucket',
      s3Client: fake.client,
    });
    await expect(adapter.delete('never/written.bin')).resolves.toBeUndefined();
    expect(fake.deletes).toHaveLength(1);
  });

  it('s3 put sends Cache-Control: immutable + ContentType: image/jpeg', async () => {
    const fake = makeFakeS3Client();
    const adapter = createS3PhotoStorageAdapter({
      bucket: 'parity-bucket',
      s3Client: fake.client,
    });
    await adapter.put('avatars/m-2/display.jpg', Buffer.from('bytes'));
    expect(fake.puts).toHaveLength(1);
    const input = fake.puts[0].input;
    expect(input.Bucket).toBe('parity-bucket');
    expect(input.Key).toBe('avatars/m-2/display.jpg');
    expect(input.ContentType).toBe('image/jpeg');
    expect(input.CacheControl).toBe('public, max-age=31536000, immutable');
  });

  it('s3 exists returns false on NotFound', async () => {
    const fake = makeFakeS3Client();
    const adapter = createS3PhotoStorageAdapter({
      bucket: 'parity-bucket',
      s3Client: fake.client,
    });
    expect(await adapter.exists('avatars/missing.jpg')).toBe(false);
    expect(fake.heads).toHaveLength(1);
  });

  it('s3 exists rethrows non-NotFound errors', async () => {
    const accessDeniedClient = {
      send: async () => {
        const err = new Error('Access Denied');
        err.name = 'AccessDenied';
        throw err;
      },
    } as unknown as S3Client;
    const adapter = createS3PhotoStorageAdapter({
      bucket: 'parity-bucket',
      s3Client: accessDeniedClient,
    });
    await expect(adapter.exists('avatars/x.jpg')).rejects.toMatchObject({
      name: 'AccessDenied',
    });
  });

  it('s3 constructURL returns /media/{key} (parity with local)', () => {
    const localAdapter = createLocalPhotoStorageAdapter({ baseDir: '/tmp' });
    const s3Adapter = createS3PhotoStorageAdapter({
      bucket: 'parity-bucket',
      s3Client: makeFakeS3Client().client,
    });
    const key = 'avatars/m-3/thumb.jpg';
    expect(localAdapter.constructURL(key)).toBe('/media/avatars/m-3/thumb.jpg');
    expect(s3Adapter.constructURL(key)).toBe('/media/avatars/m-3/thumb.jpg');
  });
});

describe('adapter-parity: ImageProcessingAdapter contract', () => {
  async function makeJpeg(width = 50, height = 50): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();
  }

  function makeProcessingFakeFetch(): {
    fetchImpl: typeof fetch;
    calls: Array<{ url: string; method: string; contentType: string; bodyLen: number }>;
  } {
    const calls: Array<{ url: string; method: string; contentType: string; bodyLen: number }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const contentType = headers['Content-Type'] ?? headers['content-type'] ?? '';
      const body = init?.body as Buffer | Uint8Array;
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      calls.push({ url, method, contentType, bodyLen: buf.length });
      const processed = await processAvatar(buf);
      return new Response(
        JSON.stringify({
          thumb: processed.thumb.toString('base64'),
          display: processed.display.toString('base64'),
          widthPx: processed.widthPx,
          heightPx: processed.heightPx,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    return { fetchImpl, calls };
  }

  it('round-trips real JPEG bytes through the HTTP boundary', async () => {
    const { fetchImpl, calls } = makeProcessingFakeFetch();
    const adapter = createHttpImageAdapter({ baseUrl: 'http://fake', fetchImpl });
    const jpeg = await makeJpeg(100, 80);

    const result = await adapter.processAvatar(jpeg);

    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(80);
    expect(Buffer.isBuffer(result.thumb)).toBe(true);
    expect(Buffer.isBuffer(result.display)).toBe(true);
    expect(result.thumb.length).toBeGreaterThan(0);
    expect(result.display.length).toBeGreaterThan(0);

    // Decode the returned thumb back through Sharp and confirm dimensions.
    const thumbMeta = await sharp(result.thumb).metadata();
    expect(thumbMeta.width).toBe(300);
    expect(thumbMeta.height).toBe(300);
    expect(thumbMeta.format).toBe('jpeg');

    const displayMeta = await sharp(result.display).metadata();
    expect(displayMeta.format).toBe('jpeg');
    expect(displayMeta.width).toBeLessThanOrEqual(800);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://fake/process/avatar');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].contentType).toBe('application/octet-stream');
    expect(calls[0].bodyLen).toBe(jpeg.length);
  });

  it('strips a trailing slash from baseUrl', async () => {
    const { fetchImpl, calls } = makeProcessingFakeFetch();
    const adapter = createHttpImageAdapter({ baseUrl: 'http://fake/', fetchImpl });
    await adapter.processAvatar(await makeJpeg());
    expect(calls[0].url).toBe('http://fake/process/avatar');
  });

  it('throws ImageProcessingError on 400 with image-type message', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'unrecognized image type' }), { status: 400 });
    const adapter = createHttpImageAdapter({ baseUrl: 'http://fake', fetchImpl });
    await expect(adapter.processAvatar(Buffer.from('not-an-image'))).rejects.toMatchObject({
      name: 'ImageProcessingError',
      status: 400,
    });
    await expect(adapter.processAvatar(Buffer.from('not-an-image'))).rejects.toThrow(
      /image type/,
    );
  });

  it('throws ImageProcessingError on 503', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'busy' }), { status: 503 });
    const adapter = createHttpImageAdapter({ baseUrl: 'http://fake', fetchImpl });
    await expect(adapter.processAvatar(await makeJpeg())).rejects.toMatchObject({
      name: 'ImageProcessingError',
      status: 503,
    });
  });

  it('throws on timeout', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const adapter = createHttpImageAdapter({
      baseUrl: 'http://fake',
      fetchImpl,
      timeoutMs: 50,
    });
    const err = await adapter.processAvatar(await makeJpeg()).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ImageProcessingError);
    expect((err as Error).message).toMatch(/timed out/);
  });

  it('wraps fetch transport errors as ImageProcessingError', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const adapter = createHttpImageAdapter({ baseUrl: 'http://fake', fetchImpl });
    await expect(adapter.processAvatar(await makeJpeg())).rejects.toMatchObject({
      name: 'ImageProcessingError',
    });
    await expect(adapter.processAvatar(await makeJpeg())).rejects.toThrow(/ECONNREFUSED/);
  });
});
