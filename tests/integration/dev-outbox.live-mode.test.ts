/**
 * Dev-outbox viewer in live mode (SES_ADAPTER=live).
 *
 * Boots the app with SES_ADAPTER=live before src/config/env loads, so the
 * stub singleton is never created. GET /internal/dev-outbox must return 404.
 *
 * Isolated to its own file so the live-mode env override does not leak into
 * other test files' module state. Vitest isolates integration test files per
 * worker thread by default, so env mutations here are contained.
 *
 * No email is actually sent — the gate throws NotFoundError before any SES
 * call, so no AWS credentials are needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3118');

// Override the per-worker stub default from tests/setup-env.ts. Must happen
// before importApp() triggers the first load of src/config/env.
process.env.SES_ADAPTER = 'live';
process.env.SES_FROM_IDENTITY = 'noreply@test.invalid';
process.env.AWS_REGION = 'us-east-1';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const VIEWER_ID = 'viewer-dev-outbox-live';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-dev-outbox-live', display_name: 'Viewer' });
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('GET /internal/dev-outbox (live mode)', () => {
  it('returns 404 when SES_ADAPTER=live', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox').set('Cookie', COOKIE);
    expect(res.status).toBe(404);
  });
});
