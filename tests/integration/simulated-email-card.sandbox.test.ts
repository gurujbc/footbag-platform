/**
 * Integration tests for the sandbox-mode card on /register/check-email.
 *
 * Simulates staging runtime: SES_ADAPTER=live + SES_SANDBOX_MODE=1. In this
 * mode the page must render the staging-warning card naming the SES
 * mailbox-simulator addresses and the tester-allow-list contact. The stub
 * message table must NOT render (live adapter has no in-memory buffer).
 *
 * The live SES client is never invoked because we never send in this file —
 * only GET /register/check-email. The live adapter is instantiated at first
 * `getSesAdapter()` call (wired from config) but no SendEmail command is
 * ever issued, so no AWS network call happens.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';

const { dbPath } = setTestEnv('3072');

// Override the worker-default SES wiring BEFORE any src/ import loads the
// frozen config singleton. importApp() inside beforeAll then reads these.
process.env.SES_ADAPTER       = 'live';
process.env.SES_SANDBOX_MODE  = '1';
process.env.SES_FROM_IDENTITY = 'noreply@test.example.com';
process.env.AWS_REGION        = 'us-east-1';

let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('GET /register/check-email — sandbox mode (SES_ADAPTER=live, SES_SANDBOX_MODE=1)', () => {
  it('renders the staging-warning card with contact email and simulator addresses', async () => {
    const app = createApp();
    const res = await request(app).get('/register/check-email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Staging: SES sandbox');
    expect(res.text).toContain('Ask Dave to be added');
    expect(res.text).not.toContain('@gmail.com');
    expect(res.text).not.toContain('mailto:');
    expect(res.text).not.toContain('@simulator.amazonses.com');
  });

  it('does not render the dev stub-message table', async () => {
    const app = createApp();
    const res = await request(app).get('/register/check-email');
    expect(res.text).not.toContain('Simulated email (dev)');
    expect(res.text).not.toContain('No messages sent yet.');
  });

  it('retired /internal/dev-outbox no longer serves the dev view in sandbox mode', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox');
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('Dev Outbox');
  });
});
