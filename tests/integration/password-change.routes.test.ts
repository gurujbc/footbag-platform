/**
 * Integration tests for GET/POST /members/:slug/edit/password.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3064');

let createApp: Awaited<ReturnType<typeof importApp>>;

const OWN_ID   = 'pw-own-001';
const OWN_SLUG = 'pw_owner';
const OWN_EMAIL = 'pw-owner@example.com';
const OLD_PASSWORD = 'OldPassword!1';
const NEW_PASSWORD = 'NewPassword!2';

function ownCookie(passwordVersion = 1): string {
  return `footbag_session=${createTestSessionJwt({ memberId: OWN_ID, passwordVersion })}`;
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  const hash = await argon2.hash(OLD_PASSWORD);
  insertMember(db, {
    id: OWN_ID,
    slug: OWN_SLUG,
    login_email: OWN_EMAIL,
    display_name: 'Pw Owner',
    password_hash: hash,
  });
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('GET /members/:slug/edit/password', () => {
  it('unauthenticated → 302 to /login', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${OWN_SLUG}/edit/password`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('own profile → 200 with form', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="oldPassword"');
    expect(res.text).toContain('name="newPassword"');
    expect(res.text).toContain('name="confirmPassword"');
  });

  it("another member's password page → 404", async () => {
    const app = createApp();
    // Use a JWT for the real owner but request someone else's slug.
    const res = await request(app)
      .get(`/members/some_other/edit/password`)
      .set('Cookie', ownCookie());
    expect(res.status).toBe(404);
  });
});

describe('POST /members/:slug/edit/password', () => {
  it('valid change → 200 with success, reissues session cookie', async () => {
    // Reset DB state for this test: restore OLD_PASSWORD hash & password_version=1.
    const hash = await argon2.hash(OLD_PASSWORD);
    const db = new BetterSqlite3(dbPath);
    db.prepare('UPDATE members SET password_hash=?, password_version=1 WHERE id=?')
      .run(hash, OWN_ID);
    db.close();

    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie(1))
      .type('form')
      .send({
        oldPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Your password has been changed');
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('footbag_session='))).toBe(true);

    // Verify DB state: password_version incremented.
    const db2 = new BetterSqlite3(dbPath, { readonly: true });
    const row = db2.prepare('SELECT password_version FROM members WHERE id=?')
      .get(OWN_ID) as { password_version: number };
    db2.close();
    expect(row.password_version).toBe(2);
  });

  it('wrong old password → 422', async () => {
    // Ensure baseline: restore to password_version=1 with OLD_PASSWORD.
    const hash = await argon2.hash(OLD_PASSWORD);
    const db = new BetterSqlite3(dbPath);
    db.prepare('UPDATE members SET password_hash=?, password_version=1 WHERE id=?')
      .run(hash, OWN_ID);
    db.close();

    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie(1))
      .type('form')
      .send({
        oldPassword: 'wrong-password',
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Current password is incorrect');
  });

  it('mismatched new passwords → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie(1))
      .type('form')
      .send({
        oldPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: 'different',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('do not match');
  });

  it('short new password → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie(1))
      .type('form')
      .send({
        oldPassword: OLD_PASSWORD,
        newPassword: 'short',
        confirmPassword: 'short',
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain('at least 8 characters');
  });

  it('stale JWT (pre-change passwordVersion) is rejected by middleware → 302', async () => {
    // Restore DB to password_version=1, old password hash so we can change it.
    const hash = await argon2.hash(OLD_PASSWORD);
    const db = new BetterSqlite3(dbPath);
    db.prepare('UPDATE members SET password_hash=?, password_version=1 WHERE id=?')
      .run(hash, OWN_ID);
    db.close();

    const app = createApp();
    // Change the password — server increments pwv to 2.
    const first = await request(app)
      .post(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie(1))
      .type('form')
      .send({
        oldPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect(first.status).toBe(200);

    // A stale cookie still carrying pwv=1 is rejected on a subsequent request.
    const stale = await request(app)
      .get(`/members/${OWN_SLUG}/edit/password`)
      .set('Cookie', ownCookie(1));
    expect(stale.status).toBe(302);
    expect(stale.headers.location).toContain('/login');
  });
});
