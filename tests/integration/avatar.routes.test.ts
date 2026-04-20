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

import { insertMember, createTestSessionJwt } from '../fixtures/factories';

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
});

afterAll(() => {
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

    // Upload sets the flash cookie on the redirect response.
    const uploadRes = await request(app)
      .post(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie())
      .attach('avatar', validJpeg, 'flash.jpg');
    expect(uploadRes.status).toBe(302);
    const flashSet = uploadRes.headers['set-cookie']?.find((c: string) =>
      c.startsWith('footbag_flash=avatar_uploaded'),
    );
    expect(flashSet).toBeTruthy();

    // Simulate the browser following the redirect with both flash cookies.
    // The filename (captured from multipart upload) rides in a companion cookie
    // and is shown in the banner so the user sees continuity between
    // "chose flash.jpg" and "updated: flash.jpg".
    const firstGet = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', [
        ownCookie(),
        'footbag_flash=avatar_uploaded',
        'footbag_flash_name=flash.jpg',
      ].join('; '));
    expect(firstGet.status).toBe(200);
    expect(firstGet.text).toContain('Avatar updated: flash.jpg');

    // The same request must clear both flash cookies so a reload does not re-show them.
    const setCookies = (firstGet.headers['set-cookie'] ?? []) as string[];
    expect(setCookies.some((c) => /^footbag_flash=;/.test(c))).toBe(true);
    expect(setCookies.some((c) => /^footbag_flash_name=;/.test(c))).toBe(true);

    // Without the cookies, the message must not appear.
    const secondGet = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie());
    expect(secondGet.status).toBe(200);
    expect(secondGet.text).not.toContain('Avatar updated');
  });

  it('upload POST sets the filename flash cookie from multipart info', async () => {
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
    expect(setCookies.some((c) => c.startsWith('footbag_flash=avatar_uploaded'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('footbag_flash_name=my-photo.jpg'))).toBe(true);
  });
});
