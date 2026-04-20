/**
 * Integration tests for DB-backed login.
 *
 * Covers: valid DB credentials, wrong password, unknown email, Footbag Hacky
 * login (login_email='footbag'), and DB member email + Footbag password (no
 * fallthrough — stub path is gone).
 *
 * Uses a separate temp DB so it does not interfere with app.routes.test.ts.
 * Env vars are set before any module import so db.ts opens the test DB.
 * Passwords are hashed at test-setup time via argon2; no hash is stored in git.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { insertMember } from '../fixtures/factories';

const TEST_DB_PATH       = path.join(process.cwd(), 'test-footbag-auth.db');
const TEST_PASSWORD      = 'test-password-123';
const TEST_MEMBER_EMAIL  = 'test-member@example.com';
const FOOTBAG_PASSWORD   = process.env.STUB_PASSWORD!;

// Set env vars BEFORE any module that reads them is imported.
// JWT/SES env vars come from tests/setup-env.ts (per-vitest-worker defaults).
process.env.FOOTBAG_DB_PATH  = TEST_DB_PATH;
process.env.PORT             = '3002';
process.env.NODE_ENV         = 'test';
process.env.LOG_LEVEL        = 'error';
process.env.PUBLIC_BASE_URL  = 'http://localhost:3002';
process.env.SESSION_SECRET   = 'auth-test-secret';

let app: Express.Application;

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type AppModule = typeof import('../../src/app');

beforeAll(async () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'database', 'schema.sql'),
    'utf8',
  );
  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // Hash passwords at setup time — no hashes stored in git.
  const [testMemberHash, footbagHash] = await Promise.all([
    argon2.hash(TEST_PASSWORD),
    argon2.hash(FOOTBAG_PASSWORD),
  ]);

  // Regular verified member with a real email address.
  insertMember(db, {
    id:                'member-auth-test-001',
    slug:              'test_member',
    login_email:       TEST_MEMBER_EMAIL,
    display_name:      'Test Member',
    password_hash:     testMemberHash,
    email_verified_at: '2025-01-01T00:00:00.000Z',
  });

  // Footbag Hacky: login_email='footbag' (non-email identifier, temporary deviation).
  insertMember(db, {
    id:                'member-footbag-hacky',
    slug:              'footbag_hacky',
    login_email:       'footbag',
    display_name:      'Footbag Hacky',
    password_hash:     footbagHash,
    email_verified_at: '2025-01-01T00:00:00.000Z',
  });

  db.close();

  const mod: AppModule = await import('../../src/app');
  app = mod.createApp();
});

afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('POST /login — DB-backed auth', () => {
  it('valid DB credentials → 302 redirect and session cookie set', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: TEST_MEMBER_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(302);
    const cookie = (res.headers['set-cookie'] as string[])?.find((c) => c.startsWith('footbag_session='));
    expect(cookie).toBeTruthy();
  });

  it('Footbag Hacky login (email=footbag) → 302 redirect and session cookie set', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'footbag', password: FOOTBAG_PASSWORD });

    expect(res.status).toBe(302);
    const cookie = (res.headers['set-cookie'] as string[])?.find((c) => c.startsWith('footbag_session='));
    expect(cookie).toBeTruthy();
  });

  it('correct email but wrong password → 200 with error', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: TEST_MEMBER_EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('unknown email → 200 with error', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('real member email + Footbag password → 200 with error (no cross-account fallthrough)', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: TEST_MEMBER_EMAIL, password: FOOTBAG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login rate limit engages after max attempts on the same email/IP', async () => {
    // System-config default: login_rate_limit_max_attempts=10, window=15m.
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/login')
        .type('form')
        .send({ email: TEST_MEMBER_EMAIL, password: 'wrong-password' });
      expect(res.status).toBe(200);
    }
    // 11th attempt should be blocked with 429.
    const blocked = await request(app)
      .post('/login')
      .type('form')
      .send({ email: TEST_MEMBER_EMAIL, password: 'wrong-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('Too many failed login attempts');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
