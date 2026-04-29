/**
 * Integration tests for avatar upload routes.
 *
 * Covers:
 *   POST /members/:memberKey/avatar  — file upload (own profile only)
 *
 * All routes require auth. Each unauthenticated test asserts a 302 redirect to
 * /login with a returnTo param.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DB_PATH = path.join(os.tmpdir(), `footbag-test-avatar-${Date.now()}.db`);
const TEST_MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'footbag-media-'));

// Set env vars BEFORE any module that reads them is imported.
// JWT/SES env vars come from tests/setup-env.ts (per-vitest-worker defaults).
process.env.FOOTBAG_DB_PATH          = TEST_DB_PATH;
process.env.FOOTBAG_MEDIA_DIR        = TEST_MEDIA_DIR;
process.env.PORT                     = '3098';
process.env.NODE_ENV                 = 'test';
process.env.LOG_LEVEL                = 'error';
process.env.PUBLIC_BASE_URL          = 'http://localhost:3098';
process.env.SESSION_SECRET           = 'avatar-routes-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import sharp from 'sharp';

import {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

import { insertMember, createTestSessionJwt } from '../fixtures/factories';

// imageProcessingAdapter imports config from env.ts, which freezes its
// singleton on first import. Defer those module loads to beforeAll so that
// the FOOTBAG_DB_PATH override above lands first.
let resetImageProcessingAdapterForTests: () => void;

const OWN_ID      = 'avatar-test-own-001';
const OWN_SLUG    = 'avatar_owner';
const OTHER_ID    = 'avatar-test-other-001';
const OTHER_SLUG  = 'avatar_other';

function ownCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: OWN_ID })}`;
}

function otherCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: OTHER_ID })}`;
}

beforeAll(async () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'database', 'schema.sql'),
    'utf8',
  );
  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  insertMember(db, { id: OWN_ID,   slug: OWN_SLUG,   display_name: 'Avatar Owner',  login_email: 'avatarowner@example.com' });
  insertMember(db, { id: OTHER_ID, slug: OTHER_SLUG, display_name: 'Avatar Other', login_email: 'avatarother@example.com' });

  db.close();

  const mod = await import('../../src/app');
  createApp = mod.createApp;

  // Defer adapter module loads until after FOOTBAG_DB_PATH has been overridden
  // (these modules import src/config/env which freezes config on first import).
  const adapterMod = await import('../../src/adapters/imageProcessingAdapter');
  const imgMod = await import('../../src/lib/imageProcessing');
  resetImageProcessingAdapterForTests = adapterMod.resetImageProcessingAdapterForTests;

  // Inject an image-processing adapter whose fake fetch invokes the real
  // Sharp pipeline inline. The avatar route tests run in-process and have
  // no real worker to talk to; the adapter code path under test is the
  // production HTTP one. This matches the JwtSigningAdapter / SesAdapter
  // pattern of injecting a fake client at the SDK boundary.
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = init?.body as Buffer | Uint8Array;
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const processed = await imgMod.processAvatar(buf);
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
  adapterMod.setImageProcessingAdapterForTests(
    adapterMod.createHttpImageAdapter({ baseUrl: 'http://test-injected', fetchImpl: fakeFetch }),
  );
});

afterAll(() => {
  resetImageProcessingAdapterForTests();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch { /* ignore */ }
  }
  try { fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── POST /members/:memberKey/avatar ────────────────────────────────────────────

describe('POST /members/:memberKey/avatar -- file upload', () => {
  it('unauthenticated -> 302 to /login with returnTo', async () => {
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();

    const res = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .attach('avatar', validJpeg, 'test.jpg');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?returnTo=%2Fmembers%2F${OWN_SLUG}%2Favatar`);
  });

  it('valid JPEG upload -> 302 redirect to profile', async () => {
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();

    const res = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'test.jpg');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/members/${OWN_SLUG}/edit`);
  });

  it('non-image file -> 422 with error', async () => {
    const app = createApp();
    const notAnImage = Buffer.from('not an image');

    const res = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', notAnImage, 'test.txt');
    expect(res.status).toBe(422);
    expect(res.text).toContain('Only JPEG and PNG images are accepted');
  });

  it('no file submitted -> 422 with error', async () => {
    const app = createApp();

    const res = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .type('form')
      .send({});
    expect(res.status).toBe(422);
    expect(res.text).toContain('Please select an image file to upload');
  });

  it("another member's avatar upload -> 404", async () => {
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();

    const res = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', otherCookie())
      .attach('avatar', validJpeg, 'test.jpg');
    expect(res.status).toBe(404);
  });

  it('after upload, profile page shows avatar img tag', async () => {
    const app = createApp();

    // Upload a valid image first.
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();

    const uploadRes = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'avatar.jpg');
    expect(uploadRes.status).toBe(302);

    // Now fetch the profile and check for the avatar image.
    const profileRes = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', ownCookie());
    expect(profileRes.status).toBe(200);
    expect(profileRes.text).toContain('profile-avatar-img');
  });

  it('rendered avatar URL includes a ?v= cache-bust version', async () => {
    const app = createApp();

    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 128, b: 0 } },
    }).jpeg().toBuffer();

    const uploadRes = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'v.jpg');
    expect(uploadRes.status).toBe(302);

    // Profile page — avatar img src must carry a ?v= token so browsers and
    // CloudFront do not serve a stale copy from the stable storage key.
    // Handlebars HTML-escapes `=` to `&#x3D;` inside attribute values; the
    // browser decodes it back on request, so both forms are acceptable here.
    const cacheBustRe = /\/media\/avatars\/[^"]+\?v(?:=|&#x3D;)[^"]+/;

    const profileRes = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', ownCookie());
    expect(profileRes.status).toBe(200);
    expect(profileRes.text).toMatch(cacheBustRe);

    // Edit page — same expectation on the current-avatar thumbnail.
    const editRes = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie());
    expect(editRes.status).toBe(200);
    expect(editRes.text).toMatch(cacheBustRe);
  });

  it('avatar URL version changes when a new avatar is uploaded', async () => {
    const app = createApp();

    const redJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().toBuffer();
    const blueJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).jpeg().toBuffer();

    const extractVersion = (html: string): string | null => {
      // `=` is HTML-escaped by Handlebars inside attribute values; match both.
      const m = html.match(/\/media\/avatars\/[^"]+\?v(?:=|&#x3D;)([^"&]+)/);
      return m ? m[1] : null;
    };

    await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', redJpeg, 'red.jpg');
    const firstRes = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', ownCookie());
    const v1 = extractVersion(firstRes.text);
    expect(v1).toBeTruthy();

    await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', blueJpeg, 'blue.jpg');
    const secondRes = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', ownCookie());
    const v2 = extractVersion(secondRes.text);
    expect(v2).toBeTruthy();

    expect(v2).not.toBe(v1);
  });

  it('authenticated responses carry Cache-Control: private, no-store', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('unauthenticated responses are not marked no-store', async () => {
    const app = createApp();
    // Public welcome page at /members for unauthenticated visitors.
    const res = await request(app).get('/members');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('after upload, edit page shows success flash once and clears it', async () => {
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().toBuffer();

    // Upload sets the signed flash cookie on the redirect response.
    const uploadRes = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'flash.jpg');
    expect(uploadRes.status).toBe(302);
    const flashSet = (uploadRes.headers['set-cookie'] ?? []).find((c: string) =>
      c.startsWith('footbag_flash='),
    );
    expect(flashSet).toBeTruthy();

    // Replay the signed flash cookie with the auth cookie on the profile-edit
    // GET. The filename is embedded in the signed cookie value so the banner
    // shows continuity between "chose flash.jpg" and "updated: flash.jpg".
    const flashValue = flashSet!.split(';')[0];
    const firstGet = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', [ownCookie(), flashValue].join('; '));
    expect(firstGet.status).toBe(200);
    expect(firstGet.text).toContain('Avatar updated: flash.jpg');

    // The same request must clear the flash cookie so a reload does not re-show.
    const setCookies = (firstGet.headers['set-cookie'] ?? []) as string[];
    expect(setCookies.some((c) => /^footbag_flash=;/.test(c))).toBe(true);

    // Without the cookie, the message must not appear.
    const secondGet = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie());
    expect(secondGet.status).toBe(200);
    expect(secondGet.text).not.toContain('Avatar updated');
  });

  it('upload POST sets a signed flash cookie carrying the filename from multipart info', async () => {
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 5, g: 5, b: 5 } },
    }).jpeg().toBuffer();

    const uploadRes = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'my-photo.jpg');
    expect(uploadRes.status).toBe(302);

    const setCookies = (uploadRes.headers['set-cookie'] ?? []) as string[];
    const flashCookie = setCookies.find((c) => c.startsWith('footbag_flash='));
    expect(flashCookie).toBeTruthy();

    // Round-trip the signed cookie through the real read path to confirm
    // the filename survives signing/verification.
    const flashValue = flashCookie!.split(';')[0];
    const editRes = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', [ownCookie(), flashValue].join('; '));
    expect(editRes.status).toBe(200);
    expect(editRes.text).toContain('Avatar updated: my-photo.jpg');
  });
});

// ── POST /members/:memberKey/avatar via the S3 storage adapter ────────────────
//
// The same controller code path runs against `createS3PhotoStorageAdapter`
// with an injected fake S3Client. This proves the controller contract
// (?v= cache-bust, /media/{key} URL shape, two PutObjects per upload) is
// preserved when the storage seam swaps from local fs to S3.

describe('POST /members/:memberKey/avatar -- s3 adapter parity', () => {
  let s3Puts: PutObjectCommand[];
  let s3Store: Map<string, Buffer>;
  let resetPhotoStorageAdapterForTests: () => void;

  beforeAll(async () => {
    s3Puts = [];
    s3Store = new Map<string, Buffer>();
    const fakeS3: S3Client = {
      send: async (cmd: unknown): Promise<unknown> => {
        if (cmd instanceof PutObjectCommand) {
          s3Puts.push(cmd);
          const body = cmd.input.Body as Buffer | Uint8Array;
          s3Store.set(
            `${cmd.input.Bucket}/${cmd.input.Key}`,
            Buffer.isBuffer(body) ? body : Buffer.from(body),
          );
          return {};
        }
        if (cmd instanceof DeleteObjectCommand) {
          s3Store.delete(`${cmd.input.Bucket}/${cmd.input.Key}`);
          return {};
        }
        if (cmd instanceof HeadObjectCommand) {
          if (s3Store.has(`${cmd.input.Bucket}/${cmd.input.Key}`)) return {};
          const err = new Error('Not Found');
          err.name = 'NotFound';
          throw err;
        }
        throw new Error('unexpected S3 command');
      },
    } as unknown as S3Client;

    const photoMod = await import('../../src/adapters/photoStorageAdapter');
    resetPhotoStorageAdapterForTests = photoMod.resetPhotoStorageAdapterForTests;
    photoMod.setPhotoStorageAdapterForTests(
      photoMod.createS3PhotoStorageAdapter({
        bucket: 'test-bucket',
        s3Client: fakeS3,
      }),
    );
  });

  afterAll(() => {
    resetPhotoStorageAdapterForTests();
  });

  it('valid JPEG upload sends two PutObjectCommands with immutable Cache-Control', async () => {
    s3Puts.length = 0;
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 7, g: 7, b: 7 } },
    }).jpeg().toBuffer();

    const res = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'test.jpg');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/members/${OWN_SLUG}/edit`);

    const keys = s3Puts.map((p) => p.input.Key);
    expect(keys).toContain(`avatars/${OWN_ID}/thumb.jpg`);
    expect(keys).toContain(`avatars/${OWN_ID}/display.jpg`);
    for (const cmd of s3Puts) {
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.ContentType).toBe('image/jpeg');
      expect(cmd.input.CacheControl).toBe('public, max-age=31536000, immutable');
    }
  });

  it('rendered avatar URL shape (/media/{key}?v=) matches the local-adapter contract', async () => {
    const app = createApp();
    const validJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 30, g: 60, b: 90 } },
    }).jpeg().toBuffer();

    const uploadRes = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'shape.jpg');
    expect(uploadRes.status).toBe(302);

    const profileRes = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', ownCookie());
    expect(profileRes.status).toBe(200);
    expect(profileRes.text).toMatch(
      /\/media\/avatars\/[^"]+\?v(?:=|&#x3D;)[^"]+/,
    );
  });

  it('avatar URL version changes when a new avatar is uploaded (s3 path)', async () => {
    const app = createApp();
    const redJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 0, b: 0 } },
    }).jpeg().toBuffer();
    const blueJpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 200 } },
    }).jpeg().toBuffer();

    const extractVersion = (html: string): string | null => {
      const m = html.match(/\/media\/avatars\/[^"]+\?v(?:=|&#x3D;)([^"&]+)/);
      return m ? m[1] : null;
    };

    await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', redJpeg, 'red.jpg');
    const v1 = extractVersion(
      (
        await request(app)
          .get(`/members/${OWN_SLUG}`)
          .set('Cookie', ownCookie())
      ).text,
    );

    await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', blueJpeg, 'blue.jpg');
    const v2 = extractVersion(
      (
        await request(app)
          .get(`/members/${OWN_SLUG}`)
          .set('Cookie', ownCookie())
      ).text,
    );

    expect(v1).toBeTruthy();
    expect(v2).toBeTruthy();
    expect(v2).not.toBe(v1);
  });
});
