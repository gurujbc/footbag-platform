/**
 * Integration tests for session/cookie edge cases under the JWT middleware.
 *
 * Verifies that the auth middleware rejects malformed, tampered, expired,
 * stale-passwordVersion, or orphaned JWT cookies without crashing the app.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';
import { signJwtLocalSync } from '../fixtures/signJwt';

/** Decode a JWT's payload (no verification) for shape assertions. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  const payload = Buffer.from(
    parts[1].replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
  return JSON.parse(payload);
}

/** Extract a Set-Cookie footbag_session value from a supertest response. */
function extractSessionCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('footbag_session='));
  if (!cookie) throw new Error('expected footbag_session Set-Cookie header');
  const match = cookie.match(/^footbag_session=([^;]+)/);
  if (!match) throw new Error('malformed footbag_session cookie');
  return match[1];
}

const { dbPath } = setTestEnv('3061');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const MEMBER_ID   = 'session-test-001';
const MEMBER_SLUG = 'session_test_user';

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, {
    id: MEMBER_ID,
    slug: MEMBER_SLUG,
    display_name: 'Session Test User',
    password_version: 3,
  });
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

const PROTECTED_ROUTE = '/history/claim';

function expectUnauthenticated(res: { status: number; headers: Record<string, string> }): void {
  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('/login');
}

describe('session edge cases — malformed JWT cookies', () => {
  it('garbage cookie value is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', 'footbag_session=garbage');
    expectUnauthenticated(res);
  });

  it('empty cookie value is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', 'footbag_session=');
    expectUnauthenticated(res);
  });

  it('cookie with only two segments is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', 'footbag_session=aaa.bbb');
    expectUnauthenticated(res);
  });

  it('cookie with non-JSON base64 header is treated as unauthenticated', async () => {
    const junk = Buffer.from('not json').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${junk}.${junk}.${junk}`);
    expectUnauthenticated(res);
  });
});

describe('session edge cases — tampered JWTs', () => {
  it('flipped signature byte is rejected', async () => {
    const token = createTestSessionJwt({ memberId: MEMBER_ID, passwordVersion: 3 });
    const parts = token.split('.');
    const sigBytes = Buffer.from(
      parts[2].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    );
    sigBytes[0] ^= 0xff;
    const tamperedSig = sigBytes
      .toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${parts[0]}.${parts[1]}.${tamperedSig}`);
    expectUnauthenticated(res);
  });

  it('modified payload with original signature is rejected', async () => {
    const token = createTestSessionJwt({ memberId: MEMBER_ID, passwordVersion: 3 });
    const parts = token.split('.');
    const hackerPayload = Buffer.from(
      JSON.stringify({ sub: 'hacker-id', role: 'admin', passwordVersion: 3, iat: 0, exp: 9_999_999_999 }),
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${parts[0]}.${hackerPayload}.${parts[2]}`);
    expectUnauthenticated(res);
  });
});

describe('session edge cases — expired JWT', () => {
  it('is rejected', async () => {
    const expiredToken = signJwtLocalSync(
      process.env.JWT_LOCAL_KEYPAIR_PATH!,
      { sub: MEMBER_ID, role: 'member', passwordVersion: 3 },
      { ttlSeconds: -1 },
    );
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${expiredToken}`);
    expectUnauthenticated(res);
  });
});

describe('session edge cases — stale passwordVersion', () => {
  it('JWT issued against an older passwordVersion is rejected', async () => {
    // Member row was inserted with password_version=3; a JWT claiming 2 is stale.
    const staleToken = createTestSessionJwt({ memberId: MEMBER_ID, passwordVersion: 2 });
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${staleToken}`);
    expectUnauthenticated(res);
  });
});

describe('session edge cases — unknown sub', () => {
  it('cryptographically valid JWT for a non-existent member is rejected', async () => {
    const orphanToken = createTestSessionJwt({ memberId: 'ghost-id', passwordVersion: 1 });
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${orphanToken}`);
    expectUnauthenticated(res);
  });

  it('does not cause a 500 on a public member-detail route either', async () => {
    const orphanToken = createTestSessionJwt({ memberId: 'ghost-id', passwordVersion: 1 });
    const app = createApp();
    // /members/:memberKey is publicly routable; the orphan JWT makes the
    // request effectively unauthenticated, so the controller returns 404 for
    // the unknown slug (the important thing is no 500).
    const res = await request(app)
      .get('/members/ghost_user')
      .set('Cookie', `footbag_session=${orphanToken}`);
    expect(res.status).toBe(404);
  });
});

describe('session edge cases — authz role is derived from DB, not JWT claims', () => {
  // Regression guard: a JWT carrying `role: 'admin'` for a user whose
  // `members.is_admin = 0` must NOT resolve to role='admin' in the session.
  // The auth middleware must read `is_admin` from the current DB row.
  // Observable via the password-change re-issue flow, which uses
  // `req.user.role` to mint the new cookie.

  const NON_ADMIN_ID   = 'role-nonadmin-001';
  const NON_ADMIN_SLUG = 'role_nonadmin';
  const ADMIN_ID       = 'role-admin-001';
  const ADMIN_SLUG     = 'role_admin';
  const OLD_PASSWORD   = 'OldPassword!1';
  const NEW_PASSWORD   = 'NewPassword!2';

  beforeAll(async () => {
    const db = new BetterSqlite3(dbPath);
    const hash = await argon2.hash(OLD_PASSWORD);
    insertMember(db, {
      id: NON_ADMIN_ID,
      slug: NON_ADMIN_SLUG,
      login_email: 'role-nonadmin@example.com',
      display_name: 'Role Non-Admin',
      password_hash: hash,
      is_admin: 0,
      password_version: 1,
    });
    insertMember(db, {
      id: ADMIN_ID,
      slug: ADMIN_SLUG,
      login_email: 'role-admin@example.com',
      display_name: 'Role Admin',
      password_hash: hash,
      is_admin: 1,
      password_version: 1,
    });
    db.close();
  });

  it('non-admin user with a JWT claiming role=admin resolves to role=member', async () => {
    const stolenAdminToken = createTestSessionJwt({
      memberId: NON_ADMIN_ID,
      role: 'admin',
      passwordVersion: 1,
    });
    const app = createApp();
    const res = await request(app)
      .post(`/members/${NON_ADMIN_SLUG}/edit/password`)
      .set('Cookie', `footbag_session=${stolenAdminToken}`)
      .type('form')
      .send({
        oldPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect(res.status).toBe(200);
    const reissued = extractSessionCookie(res);
    const payload = decodeJwtPayload(reissued);
    expect(payload.role).toBe('member');
    expect(payload.sub).toBe(NON_ADMIN_ID);
  });

  it('admin user with a JWT claiming role=member resolves to role=admin', async () => {
    // Reset the admin's password_hash since the previous test may have
    // bumped password_version for them if ordering drifted.
    const hash = await argon2.hash(OLD_PASSWORD);
    const db = new BetterSqlite3(dbPath);
    db.prepare('UPDATE members SET password_hash=?, password_version=1 WHERE id=?')
      .run(hash, ADMIN_ID);
    db.close();

    const downgradedToken = createTestSessionJwt({
      memberId: ADMIN_ID,
      role: 'member',
      passwordVersion: 1,
    });
    const app = createApp();
    const res = await request(app)
      .post(`/members/${ADMIN_SLUG}/edit/password`)
      .set('Cookie', `footbag_session=${downgradedToken}`)
      .type('form')
      .send({
        oldPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect(res.status).toBe(200);
    const reissued = extractSessionCookie(res);
    const payload = decodeJwtPayload(reissued);
    expect(payload.role).toBe('admin');
    expect(payload.sub).toBe(ADMIN_ID);
  });
});
