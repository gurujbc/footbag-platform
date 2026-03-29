/**
 * Integration tests for avatar upload routes.
 *
 * Covers:
 *   GET  /members/:memberId/avatar  — upload form (own profile only)
 *   POST /members/:memberId/avatar  — file upload (own profile only)
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
process.env.FOOTBAG_DB_PATH  = TEST_DB_PATH;
process.env.FOOTBAG_MEDIA_DIR = TEST_MEDIA_DIR;
process.env.PORT             = '3098';
process.env.NODE_ENV         = 'test';
process.env.LOG_LEVEL        = 'error';
process.env.PUBLIC_BASE_URL  = 'http://localhost:3098';
process.env.SESSION_SECRET   = 'avatar-routes-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import sharp from 'sharp';

import { insertMember } from '../fixtures/factories';
import { createSessionCookie } from '../../src/middleware/authStub';

const TEST_SECRET = process.env.SESSION_SECRET!;
const OWN_ID      = 'avatar-test-own-001';
const OWN_SLUG    = 'avatar_owner';
const OTHER_ID    = 'avatar-test-other-001';
const OTHER_SLUG  = 'avatar_other';

function ownCookie(): string {
  return `footbag_session=${createSessionCookie(OWN_ID, 'member', TEST_SECRET, 'Avatar Owner', OWN_SLUG)}`;
}

function otherCookie(): string {
  return `footbag_session=${createSessionCookie(OTHER_ID, 'member', TEST_SECRET, 'Avatar Other', OTHER_SLUG)}`;
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

// ── GET /members/:memberId/avatar ─────────────────────────────────────────────

describe('GET /members/:memberId/avatar -- upload form', () => {
  it('unauthenticated -> 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${OWN_SLUG}/avatar`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?returnTo=%2Fmembers%2F${OWN_SLUG}%2Favatar`);
  });

  it('own profile -> 200 with upload form', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Upload Avatar');
  });

  it("another member's avatar page -> 404", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/avatar`)
      .set('Cookie', otherCookie());
    expect(res.status).toBe(404);
  });
});

// ── POST /members/:memberId/avatar ────────────────────────────────────────────

describe('POST /members/:memberId/avatar -- file upload', () => {
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
    expect(res.headers.location).toBe(`/members/${OWN_SLUG}`);
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
});
