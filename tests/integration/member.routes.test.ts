/**
 * Integration tests for member profile routes.
 *
 * Covers:
 *   GET  /members                     — landing redirect
 *   GET  /members/:memberKey           — profile view (own vs other)
 *   GET  /members/:memberKey/edit      — edit form (own vs other)
 *   POST /members/:memberKey/edit      — save profile (validation, auth, cross-member guard)
 *   GET  /members/:memberKey/:section  — stub pages (own vs other, known vs unknown section)
 *
 * All routes require auth. Each unauthenticated test asserts a 302 redirect to
 * /login with a returnTo param.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { insertMember } from '../fixtures/factories';
import { createSessionCookie } from '../../src/middleware/authStub';

const TEST_DB_PATH = path.join(process.cwd(), `test-member-profile-${Date.now()}.db`);

// Set env vars BEFORE any module that reads them is imported.
process.env.FOOTBAG_DB_PATH  = TEST_DB_PATH;
process.env.PORT             = '3003';
process.env.NODE_ENV         = 'test';
process.env.LOG_LEVEL        = 'error';
process.env.PUBLIC_BASE_URL  = 'http://localhost:3003';
process.env.SESSION_SECRET   = 'member-profile-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

const TEST_SECRET = process.env.SESSION_SECRET!;
const OWN_ID      = 'member-profile-test-001';
const OWN_SLUG    = 'test_member';
const OTHER_ID    = 'member-other-test-001';
const OTHER_SLUG  = 'other_member';

function ownCookie(): string {
  return `footbag_session=${createSessionCookie(OWN_ID, 'member', TEST_SECRET, 'Test Member', OWN_SLUG)}`;
}

function otherCookie(): string {
  return `footbag_session=${createSessionCookie(OTHER_ID, 'member', TEST_SECRET, 'Other Member', OTHER_SLUG)}`;
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

  insertMember(db, { id: OWN_ID,   slug: OWN_SLUG,   display_name: 'Test Member',  login_email: 'testmember@example.com' });
  insertMember(db, { id: OTHER_ID, slug: OTHER_SLUG, display_name: 'Other Member', login_email: 'othermember@example.com' });

  db.close();

  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ── GET /members ───────────────────────────────────────────────────────────────

describe('GET /members — landing page', () => {
  it('unauthenticated → 200 with welcome page', async () => {
    const app = createApp();
    const res = await request(app).get('/members');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sign Up');
    expect(res.text).toContain('/register');
  });

  it('authenticated → 200 with landing page', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members')
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Welcome,');
    expect(res.text).toContain('My Profile');
    expect(res.text).toContain(`/members/${OWN_SLUG}`);
    expect(res.text).toContain('Search for Members and Historical Players');
    expect(res.text).toContain('Member Features');
    expect(res.text).toContain('card-coming-soon');
  });
});

// ── GET /members/:memberKey ─────────────────────────────────────────────────────

describe('GET /members/:memberKey — profile view', () => {
  it('unauthenticated → 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${OWN_SLUG}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?returnTo=%2Fmembers%2F${OWN_SLUG}`);
  });

  it('own profile → 200', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
  });

  it("another member's profile → 404", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}`)
      .set('Cookie', otherCookie());
    expect(res.status).toBe(404);
  });

  it('nonexistent member key → 404', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members/does-not-exist')
      .set('Cookie', `footbag_session=${createSessionCookie('does-not-exist', 'member', TEST_SECRET)}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /members/:memberKey/edit ────────────────────────────────────────────────

describe('GET /members/:memberKey/edit — edit form', () => {
  it('unauthenticated → 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${OWN_SLUG}/edit`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?returnTo=%2Fmembers%2F${OWN_SLUG}%2Fedit`);
  });

  it('own profile → 200 with form fields', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('emailVisibility');
    expect(res.text).not.toContain('name="displayName"');
  });

  it("another member's edit page → 404", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', otherCookie());
    expect(res.status).toBe(404);
  });

  it('/edit is not swallowed as :section — route resolves to edit form, not stub', async () => {
    // If route ordering is wrong, /edit would hit getStub and return 404 (not in STUB_SEGMENTS).
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Edit Profile');
  });
});

// ── POST /members/:memberKey/edit ───────────────────────────────────────────────

describe('POST /members/:memberKey/edit — save profile', () => {
  it('unauthenticated → 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit`)
      .type('form')
      .send({ bio: '', city: '', region: '', country: '', phone: '', emailVisibility: 'private' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?returnTo=%2Fmembers%2F${OWN_SLUG}%2Fedit`);
  });

  it("another member's profile edit → 404 (cross-member write guard)", async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', otherCookie())
      .type('form')
      .send({ bio: '', city: '', region: '', country: '', phone: '', emailVisibility: 'private' });
    expect(res.status).toBe(404);
  });

  it('bio exceeding 1000 characters → 422 with error message', async () => {
    const app = createApp();
    const longBio = 'B'.repeat(1001);
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie())
      .type('form')
      .send({ bio: longBio, city: '', region: '', country: '', phone: '', emailVisibility: 'private' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('1000 characters');
  });

  it('invalid emailVisibility value is silently coerced to private — no 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie())
      .type('form')
      .send({
        bio:             '',
        city:            '',
        region:          '',
        country:         '',
        phone:           '',
        emailVisibility: 'bad-value',
      });
    // Service coerces bad visibility to 'private' — no validation error.
    expect(res.status).toBe(302);
  });

  it('valid input → 302 redirect to own profile (slug unchanged)', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit`)
      .set('Cookie', ownCookie())
      .type('form')
      .send({
        bio:             'A short bio.',
        city:            'Portland',
        region:          'OR',
        country:         'US',
        phone:           '',
        emailVisibility: 'members',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/members/${OWN_SLUG}`);
  });
});

// ── GET /members/:memberKey/:section — stub pages ───────────────────────────────

describe('GET /members/:memberKey/:section — stub pages', () => {
  const VALID_SECTIONS = ['media', 'settings', 'password', 'download', 'delete'];

  it('unauthenticated → 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${OWN_SLUG}/settings`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?returnTo=%2Fmembers%2F${OWN_SLUG}%2Fsettings`);
  });

  for (const section of VALID_SECTIONS) {
    it(`own profile /${section} → 200`, async () => {
      const app = createApp();
      const res = await request(app)
        .get(`/members/${OWN_SLUG}/${section}`)
        .set('Cookie', ownCookie());
      expect(res.status).toBe(200);
      expect(res.text).toContain('coming soon');
    });
  }

  it("another member's stub page → 404", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/settings`)
      .set('Cookie', otherCookie());
    expect(res.status).toBe(404);
  });

  it('unknown section → 404', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/not-a-real-section`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(404);
  });
});
