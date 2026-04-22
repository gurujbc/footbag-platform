/**
 * Integration tests for production-mode rendering of /register/check-email.
 *
 * Simulates real prod: SES_ADAPTER=live + SES_SANDBOX_MODE=0. No card is
 * rendered (neither the dev table nor the staging warning). This is the
 * permanent contract for what end users see post-SES-production-cutover
 * (IMPLEMENTATION_PLAN.md line 35 unblock condition).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';

const { dbPath } = setTestEnv('3073');

process.env.SES_ADAPTER       = 'live';
process.env.SES_SANDBOX_MODE  = '0';
process.env.SES_FROM_IDENTITY = 'noreply@test.example.com';
process.env.AWS_REGION        = 'us-east-1';

let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('GET /register/check-email — production mode (SES_ADAPTER=live, SES_SANDBOX_MODE=0)', () => {
  it('renders the page but no simulated-email or sandbox-warning card', async () => {
    const app = createApp();
    const res = await request(app).get('/register/check-email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Registration successful!');
    expect(res.text).not.toContain('Simulated email (dev)');
    expect(res.text).not.toContain('Staging: email delivery is restricted');
    expect(res.text).not.toContain('simulator.amazonses.com');
  });

  it('retired /internal/dev-outbox no longer serves the dev view in production mode', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox');
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('Dev Outbox');
  });
});
