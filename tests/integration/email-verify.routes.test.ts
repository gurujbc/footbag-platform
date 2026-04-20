/**
 * Integration tests for email verification at registration.
 *
 * Exercises the full verify flow: registration enqueues a verify email,
 * GET /verify/:token consumes the token and logs the member in, resend is
 * rate-limited, and unverified members cannot log in and do not appear in
 * authenticated member search.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3069');

let createApp: Awaited<ReturnType<typeof importApp>>;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sesMod: typeof import('../../src/adapters/sesAdapter');

beforeAll(async () => {
  const db = createTestDb(dbPath);
  // Searcher: must exist so we can authenticate the search call.
  insertMember(db, { id: 'verify-searcher', slug: 'verify_searcher', login_email: 'searcher@example.com' });
  db.close();
  createApp = await importApp();
  sesMod = await import('../../src/adapters/sesAdapter');
});

afterAll(() => cleanupTestDb(dbPath));

beforeEach(() => {
  const stub = sesMod.getStubSesAdapterForTests();
  stub?.clear();
});

function tokenFromOutbox(email: string): string {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const row = db.prepare(
    `SELECT body_text FROM outbox_emails WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(email) as { body_text: string } | undefined;
  db.close();
  if (!row) throw new Error(`no outbox row for ${email}`);
  const match = row.body_text.match(/\/verify\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no verify link in body for ${email}`);
  return match[1];
}

describe('POST /register → check-email + outbox enqueue', () => {
  it('enqueues a verify email with a /verify/:token link', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Verify Tester',
        email: 'verify-one@example.com',
        password: 'verifypass!1',
        confirmPassword: 'verifypass!1',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/register/check-email');

    const db = new BetterSqlite3(dbPath, { readonly: true });
    const row = db.prepare(
      `SELECT recipient_email, body_text, status FROM outbox_emails WHERE recipient_email = ?`,
    ).get('verify-one@example.com') as { recipient_email: string; body_text: string; status: string };
    db.close();
    expect(row.status).toBe('pending');
    expect(row.body_text).toMatch(/\/verify\/[A-Za-z0-9_-]+/);

    // Unverified DB state: email_verified_at IS NULL, not in members_searchable.
    const db2 = new BetterSqlite3(dbPath, { readonly: true });
    const m = db2.prepare(
      `SELECT email_verified_at FROM members WHERE login_email_normalized = ?`,
    ).get('verify-one@example.com') as { email_verified_at: string | null };
    const searchable = db2.prepare(
      `SELECT COUNT(*) AS n FROM members_searchable WHERE login_email_normalized = ?`,
    ).get('verify-one@example.com') as { n: number };
    db2.close();
    expect(m.email_verified_at).toBeNull();
    expect(searchable.n).toBe(0);
  });

  it('duplicate registration produces no new outbox row (silent dedup)', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Dup One',
      email: 'verify-dup@example.com',
      password: 'verifypass!1',
      confirmPassword: 'verifypass!1',
    });
    // Re-register same email — same RealName rules (must differ from existing slug).
    await request(app).post('/register').type('form').send({
      realName: 'Dup Two',
      email: 'verify-dup@example.com',
      password: 'anotherpass!2',
      confirmPassword: 'anotherpass!2',
    });
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const rows = db.prepare(
      `SELECT id FROM outbox_emails WHERE recipient_email = ?`,
    ).all('verify-dup@example.com') as Array<{ id: string }>;
    db.close();
    expect(rows).toHaveLength(1);
  });
});

describe('GET /verify/:token', () => {
  it('consumes valid token → sets email_verified_at, issues session cookie, redirects to /members/:slug', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Verify Good',
      email: 'verify-good@example.com',
      password: 'verifypass!1',
      confirmPassword: 'verifypass!1',
    });
    const token = tokenFromOutbox('verify-good@example.com');
    const res = await request(app).get(`/verify/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/members\//);
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('footbag_session='))).toBe(true);

    const db = new BetterSqlite3(dbPath, { readonly: true });
    const m = db.prepare(
      `SELECT email_verified_at FROM members WHERE login_email_normalized = ?`,
    ).get('verify-good@example.com') as { email_verified_at: string | null };
    db.close();
    expect(m.email_verified_at).not.toBeNull();
  });

  it('second consume of the same token → 400 with generic error', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Verify Twice',
      email: 'verify-twice@example.com',
      password: 'verifypass!1',
      confirmPassword: 'verifypass!1',
    });
    const token = tokenFromOutbox('verify-twice@example.com');
    const first = await request(app).get(`/verify/${token}`);
    expect(first.status).toBe(302);
    const second = await request(app).get(`/verify/${token}`);
    expect(second.status).toBe(400);
    expect(second.text).toContain('invalid, expired, or already used');
  });

  it('unknown token → 400 with identical error', async () => {
    const app = createApp();
    const res = await request(app).get('/verify/bogus-token-xxx');
    expect(res.status).toBe(400);
    expect(res.text).toContain('invalid, expired, or already used');
  });
});

describe('Unverified login is rejected', () => {
  it('an unverified member cannot log in', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Verify Blocked',
      email: 'verify-blocked@example.com',
      password: 'verifypass!1',
      confirmPassword: 'verifypass!1',
    });
    const res = await request(app).post('/login').type('form').send({
      email: 'verify-blocked@example.com',
      password: 'verifypass!1',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('POST /verify/resend', () => {
  it('issues a new verify email for an unverified member and rate-limits after 3 per hour', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Resend Tester',
      email: 'resend@example.com',
      password: 'verifypass!1',
      confirmPassword: 'verifypass!1',
    });
    // First outbox row is the registration email.
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/verify/resend').type('form').send({ email: 'resend@example.com' });
      expect(r.status).toBe(200);
    }
    // After 3 allowed resends the bucket is at its limit; the 4th doesn't enqueue.
    const before = (() => {
      const db = new BetterSqlite3(dbPath, { readonly: true });
      const count = db.prepare(
        `SELECT COUNT(*) AS n FROM outbox_emails WHERE recipient_email = ?`,
      ).get('resend@example.com') as { n: number };
      db.close();
      return count.n;
    })();
    const blocked = await request(app).post('/verify/resend').type('form').send({ email: 'resend@example.com' });
    // Identical response (200 check-email) either way — anti-enumeration.
    expect(blocked.status).toBe(200);
    const after = (() => {
      const db = new BetterSqlite3(dbPath, { readonly: true });
      const count = db.prepare(
        `SELECT COUNT(*) AS n FROM outbox_emails WHERE recipient_email = ?`,
      ).get('resend@example.com') as { n: number };
      db.close();
      return count.n;
    })();
    expect(after).toBe(before);
  });

  it('renders identical check-email page when the email does not match any member', async () => {
    const app = createApp();
    const res = await request(app).post('/verify/resend').type('form').send({
      email: 'never-existed@example.com',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('new verification link has been sent');
  });
});

describe('Authenticated member search excludes unverified rows', () => {
  it('an unverified member is not in members_searchable and not in /members?q=', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Shadow Figure',
      email: 'shadow-figure@example.com',
      password: 'verifypass!1',
      confirmPassword: 'verifypass!1',
    });

    const cookie = `footbag_session=${createTestSessionJwt({ memberId: 'verify-searcher' })}`;
    const res = await request(app).get('/members?q=Shadow').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Shadow Figure');
  });
});
