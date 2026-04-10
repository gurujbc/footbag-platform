/**
 * Integration tests for session/cookie edge cases.
 *
 * Verifies that the auth middleware correctly rejects malformed, tampered,
 * or incomplete session cookies without crashing the application.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHmac } from 'crypto';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember } from '../fixtures/factories';

const { dbPath, sessionSecret } = setTestEnv('3061');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const MEMBER_SLUG = 'session_test_user';

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: 'session-test-001', slug: MEMBER_SLUG, display_name: 'Session Test User' });
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

/** Helper: protected route that requires auth (redirects 302 if unauthenticated). */
const PROTECTED_ROUTE = '/history/claim';

function expectUnauthenticated(res: { status: number; headers: Record<string, string> }): void {
  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('/login');
}

describe('session edge cases — malformed cookies', () => {
  it('garbage cookie value (not base64.sig format) is treated as unauthenticated', async () => {
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

  it('cookie with no dot separator is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', 'footbag_session=nodothere');
    expectUnauthenticated(res);
  });

  it('non-JSON base64 payload is treated as unauthenticated', async () => {
    const payload = Buffer.from('not json at all').toString('base64');
    const sig = createHmac('sha256', sessionSecret).update(payload).digest('base64');
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${payload}.${sig}`);
    expectUnauthenticated(res);
  });
});

describe('session edge cases — tampered cookies', () => {
  it('wrong HMAC signature is treated as unauthenticated', async () => {
    const payload = Buffer.from(JSON.stringify({
      userId: 'session-test-001', role: 'member', slug: MEMBER_SLUG,
    })).toString('base64');
    const wrongSig = createHmac('sha256', 'wrong-secret').update(payload).digest('base64');
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${payload}.${wrongSig}`);
    expectUnauthenticated(res);
  });

  it('tampered payload (modified userId) with original signature is rejected', async () => {
    const originalPayload = Buffer.from(JSON.stringify({
      userId: 'session-test-001', role: 'member', slug: MEMBER_SLUG,
    })).toString('base64');
    const sig = createHmac('sha256', sessionSecret).update(originalPayload).digest('base64');
    // Tamper: change userId in a new payload but reuse old signature
    const tamperedPayload = Buffer.from(JSON.stringify({
      userId: 'hacker-id', role: 'admin', slug: 'hacker',
    })).toString('base64');
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `footbag_session=${tamperedPayload}.${sig}`);
    expectUnauthenticated(res);
  });
});

describe('session edge cases — incomplete payloads', () => {
  function signedCookie(obj: Record<string, unknown>): string {
    const payload = Buffer.from(JSON.stringify(obj)).toString('base64');
    const sig = createHmac('sha256', sessionSecret).update(payload).digest('base64');
    return `footbag_session=${payload}.${sig}`;
  }

  it('missing userId is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', signedCookie({ role: 'member', slug: MEMBER_SLUG }));
    expectUnauthenticated(res);
  });

  it('missing role is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', signedCookie({ userId: 'session-test-001', slug: MEMBER_SLUG }));
    expectUnauthenticated(res);
  });

  it('userId as number instead of string is treated as unauthenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set('Cookie', signedCookie({ userId: 123, role: 'member', slug: MEMBER_SLUG }));
    expectUnauthenticated(res);
  });
});

describe('session edge cases — non-existent member', () => {
  it('valid cookie with non-existent member slug returns 404 for member route', async () => {
    const payload = Buffer.from(JSON.stringify({
      userId: 'nonexistent-id', role: 'member', displayName: 'Ghost', slug: 'ghost_user',
    })).toString('base64');
    const sig = createHmac('sha256', sessionSecret).update(payload).digest('base64');
    const app = createApp();
    // This is authenticated (cookie is valid) but the member doesn't exist in DB
    const res = await request(app)
      .get('/members/ghost_user')
      .set('Cookie', `footbag_session=${payload}.${sig}`);
    expect(res.status).toBe(404);
  });

  it('valid cookie with non-existent member does not cause 500', async () => {
    const payload = Buffer.from(JSON.stringify({
      userId: 'nonexistent-id', role: 'member', displayName: 'Ghost', slug: 'ghost_user',
    })).toString('base64');
    const sig = createHmac('sha256', sessionSecret).update(payload).digest('base64');
    const app = createApp();
    const res = await request(app)
      .get('/members/ghost_user/edit')
      .set('Cookie', `footbag_session=${payload}.${sig}`);
    // Should be 404 (not own profile because slug doesn't match), not 500
    expect(res.status).toBe(404);
  });
});
