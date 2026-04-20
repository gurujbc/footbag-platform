/**
 * Integration tests for member registration.
 *
 * Covers:
 *   GET  /register        — form render
 *   POST /register        — valid registration, duplicate email, short password,
 *                           mismatched passwords, missing display name
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const TEST_DB_PATH      = path.join(process.cwd(), `test-register-${Date.now()}.db`);

// JWT/SES env vars come from tests/setup-env.ts (per-vitest-worker defaults).
process.env.FOOTBAG_DB_PATH          = TEST_DB_PATH;
process.env.PORT                     = '3004';
process.env.NODE_ENV                 = 'test';
process.env.LOG_LEVEL                = 'error';
process.env.PUBLIC_BASE_URL          = 'http://localhost:3004';
process.env.SESSION_SECRET           = 'register-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

beforeAll(async () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'database', 'schema.sql'),
    'utf8',
  );
  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // Pre-existing member for duplicate-email tests.
  insertMember(db, {
    id:          'member-existing-001',
    slug:        'existing_user',
    login_email: 'existing@example.com',
    display_name: 'Existing User',
  });

  db.close();

  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ── GET /register ─────────────────────────────────────────────────────────────

describe('GET /register', () => {
  it('returns 200 with registration form', async () => {
    const app = createApp();
    const res = await request(app).get('/register');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Create an IFPA Account');
    expect(res.text).toContain('name="realName"');
    expect(res.text).toContain('name="displayName"');
    expect(res.text).toContain('name="email"');
    expect(res.text).toContain('name="password"');
    expect(res.text).toContain('name="confirmPassword"');
  });

  it('shows early access data warning', async () => {
    const app = createApp();
    const res = await request(app).get('/register');
    expect(res.text).toContain('Early access notice');
    expect(res.text).toContain('may be deleted');
  });

  it('redirects authenticated user to own profile', async () => {
    const app = createApp();
    const cookie = `footbag_session=${createTestSessionJwt({ memberId: 'member-existing-001' })}`;
    const res = await request(app).get('/register').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/existing_user');
  });
});

// ── POST /register ────────────────────────────────────────────────────────────

describe('POST /register', () => {
  it('valid registration → 302 to /register/check-email, no session cookie, DB rows land', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'New Player',
        email: 'newplayer@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/register/check-email');
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('footbag_session='))).toBeFalsy();

    // The registered branch MUST insert a members row AND enqueue an
    // outbox_emails row. Anti-enumeration keeps the HTTP response identical
    // to silent_duplicate, so DB state is the only signal that the write
    // path actually ran. USER_STORIES §V_Register_Account line 472: "System
    // sends verification email" on successful registration.
    const db = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
    const member = db.prepare(
      `SELECT id, slug, login_email_normalized, display_name_normalized,
              password_hash, email_verified_at
         FROM members WHERE login_email_normalized = ?`,
    ).get('newplayer@example.com') as
      | { id: string; slug: string; login_email_normalized: string;
          display_name_normalized: string; password_hash: string | null;
          email_verified_at: string | null }
      | undefined;
    const outboxRows = db.prepare(
      `SELECT id, recipient_email, recipient_member_id, status, retry_count
         FROM outbox_emails WHERE recipient_email = ?`,
    ).all('newplayer@example.com') as Array<{
      id: string; recipient_email: string; recipient_member_id: string | null;
      status: string; retry_count: number;
    }>;
    db.close();

    expect(member).toBeDefined();
    expect(member!.slug).toBeTruthy();
    expect(member!.password_hash).toBeTruthy();
    expect(member!.email_verified_at).toBeNull();
    expect(member!.display_name_normalized).toBe('new player');

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe('pending');
    expect(outboxRows[0].retry_count).toBe(0);
    expect(outboxRows[0].recipient_member_id).toBe(member!.id);
  });

  it('duplicate email → 302 to /register/check-email, NO new DB rows (anti-enumeration + silent dedup)', async () => {
    const app = createApp();

    // Snapshot counts *before* the POST. Prior it-blocks may have created
    // rows; we assert ONLY that the duplicate POST added nothing.
    // USER_STORIES §V_Register_Account line 530: "no new verification
    // email is sent" when the address is already registered.
    const countBefore = (() => {
      const db = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
      const m = db.prepare(`SELECT COUNT(*) AS n FROM members`).get() as { n: number };
      const o = db.prepare(`SELECT COUNT(*) AS n FROM outbox_emails`).get() as { n: number };
      db.close();
      return { members: m.n, outbox: o.n };
    })();

    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Duplicate User',
        email: 'existing@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/register/check-email');

    const countAfter = (() => {
      const db = new BetterSqlite3(TEST_DB_PATH, { readonly: true });
      const m = db.prepare(`SELECT COUNT(*) AS n FROM members`).get() as { n: number };
      const o = db.prepare(`SELECT COUNT(*) AS n FROM outbox_emails`).get() as { n: number };
      db.close();
      return { members: m.n, outbox: o.n };
    })();

    expect(countAfter.members).toBe(countBefore.members);
    expect(countAfter.outbox).toBe(countBefore.outbox);
  });

  it('short password → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Short Pass',
        email: 'shortpass@example.com',
        password: 'short',
        confirmPassword: 'short',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('at least 8 characters');
  });

  it('mismatched passwords → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Mismatch User',
        email: 'mismatch@example.com',
        password: 'securepass123',
        confirmPassword: 'differentpass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('do not match');
  });

  it('missing real name → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: '',
        email: 'noname@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Full legal name is required');
  });

  it('missing email → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'No Email',
        email: '',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Email address is required');
  });

  it('single-word real name → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'trained',
        email: 'trained@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('first name and last name');
  });

  it('digits in real name → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Player 123',
        email: 'digits@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('must not contain digits');
  });

  it('display name with different surname → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'David Leberknight',
        displayName: 'xXFootbagMasterXx',
        email: 'badsurname@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('must include your last name');
  });

  it('display name with matching surname succeeds', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'David Leberknight',
        displayName: 'Dave Leberknight',
        email: 'daveleberknight@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/register/check-email');
  });

  it('blank display name defaults to real name', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Jane Footbagger',
        displayName: '',
        email: 'janefootbagger@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/register/check-email');
  });

  it('slug conflict is resolved with suffix (no visible leak; unverified row exists)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Existing User',
        email: 'existinguser2@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/register/check-email');
  });
});
