/**
 * Router-level auth gate on /internal/*.
 *
 * All routes under /internal inherit `requireAuth` at the router level
 * (see src/routes/internalRoutes.ts). Unauthenticated requests redirect
 * to /login?returnTo=...; authenticated members see 200.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import {
  setTestEnv,
  createTestDb,
  cleanupTestDb,
  importApp,
} from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3116');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const VIEWER_ID = 'viewer-internal-gate';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-internal-gate', display_name: 'Viewer' });
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('/internal/* requires auth', () => {
  it('redirects unauthenticated GET to /login', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^\/login\?returnTo=/);
  });

  it('serves the page when authenticated', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
  });
});
