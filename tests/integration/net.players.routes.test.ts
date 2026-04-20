/**
 * Integration tests for `/net/players/*` legacy redirects.
 *
 * Per DD §2.4 rule 2, per-person deep-dives belong on the canonical person
 * page at `/history/:personId`, not under sport-scoped namespaces. The old
 * `/net/players/:personId` and `/net/players/:personId/partners/:teamId`
 * routes now 302-redirect to `/history/:personId` to preserve existing
 * inbound links. The player/partner detail content on `/history/*` already
 * covers competition results, career stats by category, and top partnerships;
 * net-specific career highlights (longest partnership, career span) are not
 * ported — deferred as a future enhancement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';

const { dbPath } = setTestEnv('3090');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('/net/players/* legacy redirects (DD §2.4 rule 2)', () => {
  it('GET /net/players/:personId redirects 302 to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/net/players/some-person-id-123');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/some-person-id-123');
  });

  it('GET /net/players/:personId/partners/:teamId redirects 302 to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/net/players/some-person-id-456/partners/team-abc');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/some-person-id-456');
  });
});
