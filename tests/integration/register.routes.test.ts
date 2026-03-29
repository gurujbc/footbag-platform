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

import { insertMember } from '../fixtures/factories';
import { createSessionCookie } from '../../src/middleware/authStub';

const TEST_DB_PATH = path.join(process.cwd(), `test-register-${Date.now()}.db`);

process.env.FOOTBAG_DB_PATH  = TEST_DB_PATH;
process.env.PORT             = '3004';
process.env.NODE_ENV         = 'test';
process.env.LOG_LEVEL        = 'error';
process.env.PUBLIC_BASE_URL  = 'http://localhost:3004';
process.env.SESSION_SECRET   = 'register-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

const TEST_SECRET = process.env.SESSION_SECRET!;

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
    const cookie = `footbag_session=${createSessionCookie('member-existing-001', 'member', TEST_SECRET, 'Existing User', 'existing_user')}`;
    const res = await request(app).get('/register').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/existing_user');
  });
});

// ── POST /register ────────────────────────────────────────────────────────────

describe('POST /register', () => {
  it('valid registration → 302 redirect + session cookie', async () => {
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
    expect(res.headers.location).toMatch(/^\/members\/new_player/);
    const cookies: string[] = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie']
      : [res.headers['set-cookie']];
    expect(cookies.some((c: string) => c.startsWith('footbag_session='))).toBe(true);
  });

  it('duplicate email → 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Duplicate User',
        email: 'existing@example.com',
        password: 'securepass123',
        confirmPassword: 'securepass123',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('already exists');
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
    expect(res.headers.location).toMatch(/^\/members\/dave_leberknight/);
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
    expect(res.headers.location).toMatch(/^\/members\/jane_footbagger/);
  });

  it('slug conflict is resolved with suffix', async () => {
    const app = createApp();
    // First registration with "Existing User" name (slug 'existing_user' is taken).
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
    // Should get a suffixed slug like existing_user_2.
    expect(res.headers.location).toMatch(/^\/members\/existing_user_\d+/);
  });
});
