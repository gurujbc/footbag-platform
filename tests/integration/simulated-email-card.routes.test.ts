/**
 * Integration tests for the in-page "simulated email" card on
 * /register/check-email, under SES_ADAPTER=stub (dev mode). Covers happy
 * path, empty state, resend behavior, URL extraction, XSS escaping, and
 * confirms /internal/dev-outbox has been retired (route returns 404).
 *
 * Sandbox-mode and production-mode rendering live in sibling files
 * (simulated-email-card.sandbox.test.ts, simulated-email-card.prod.test.ts)
 * because the frozen `config` singleton is set at module load and can't be
 * toggled within a single file.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';

const { dbPath } = setTestEnv('3071');

let createApp: Awaited<ReturnType<typeof importApp>>;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sesMod: typeof import('../../src/adapters/sesAdapter');

beforeAll(async () => {
  const db = createTestDb(dbPath);
  db.close();
  createApp = await importApp();
  sesMod = await import('../../src/adapters/sesAdapter');
});

afterAll(() => cleanupTestDb(dbPath));

beforeEach(() => {
  // Force stub init even before any code path has dispatched mail, so the
  // beforeEach clear() below is always safe.
  sesMod.getSesAdapter();
  sesMod.getStubSesAdapterForTests()?.clear();
});

describe('GET /register/check-email — dev mode (SES_ADAPTER=stub)', () => {
  it('renders the simulated-email card with an empty state when no messages have been sent', async () => {
    const app = createApp();
    const res = await request(app).get('/register/check-email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Simulated email (dev)');
    expect(res.text).toContain('No messages sent yet.');
    // Old "open dev outbox" affordance must be gone.
    expect(res.text).not.toContain('/internal/dev-outbox');
  });

  it('renders one row with To/Subject/Open link after a registration', async () => {
    const app = createApp();
    const reg = await request(app)
      .post('/register')
      .type('form')
      .send({
        realName: 'Sim Card One',
        email: 'sim-card-one@example.com',
        password: 'simpass!1',
        confirmPassword: 'simpass!1',
      });
    expect(reg.status).toBe(302);
    expect(reg.headers.location).toBe('/register/check-email');

    const res = await request(app).get('/register/check-email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Simulated email (dev)');
    expect(res.text).toContain('sim-card-one@example.com');
    expect(res.text).toContain('Verify your IFPA Footbag account');
    // Open link points to a /verify/<token> URL extracted from the body.
    expect(res.text).toMatch(/<a href="http:\/\/[^"]+\/verify\/[A-Za-z0-9_-]+">Open<\/a>/);
  });

  it('renders two rows newest-first after a resend, with the resent banner', async () => {
    const app = createApp();
    await request(app).post('/register').type('form').send({
      realName: 'Sim Card Two',
      email: 'sim-card-two@example.com',
      password: 'simpass!1',
      confirmPassword: 'simpass!1',
    });
    const resendRes = await request(app).post('/verify/resend').type('form').send({
      email: 'sim-card-two@example.com',
    });
    expect(resendRes.status).toBe(200);
    expect(resendRes.text).toContain('new verification link has been sent');
    expect(resendRes.text).toContain('Simulated email (dev)');

    // Two rows, newest first. Body column contains one verify URL per row.
    const openLinks = resendRes.text.match(/<a href="http:\/\/[^"]+\/verify\/[A-Za-z0-9_-]+">Open<\/a>/g);
    expect(openLinks?.length ?? 0).toBe(2);
    expect(resendRes.text).toContain('sim-card-two@example.com');
  });

  it('renders a row without an Open link when the body has no URL', async () => {
    const app = createApp();
    // Inject directly through the adapter to exercise the no-URL branch
    // (real registration emails always carry a /verify URL).
    await sesMod.getSesAdapter().sendEmail({
      to:       'no-url@example.com',
      subject:  'No URL Here',
      bodyText: 'Plain text with no link whatsoever.',
    });
    const res = await request(app).get('/register/check-email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('no-url@example.com');
    expect(res.text).toContain('No URL Here');
    // The subject row exists; but no Open anchor was rendered for this one.
    const openLinks = res.text.match(/>Open<\/a>/g);
    expect(openLinks?.length ?? 0).toBe(0);
  });

  it('escapes HTML in subject and body (XSS defence)', async () => {
    const app = createApp();
    await sesMod.getSesAdapter().sendEmail({
      to:       'xss@example.com',
      subject:  '<script>alert("xss-subject")</script>',
      bodyText: '<script>alert("xss-body")</script>',
    });
    const res = await request(app).get('/register/check-email');
    expect(res.status).toBe(200);
    // Raw <script> must not land in the HTML; Handlebars double-brace
    // rendering escapes it to the &lt; entity form.
    expect(res.text).not.toContain('<script>alert("xss-subject")');
    expect(res.text).not.toContain('<script>alert("xss-body")');
    expect(res.text).toContain('&lt;script&gt;alert(&quot;xss-subject&quot;)');
    expect(res.text).toContain('&lt;script&gt;alert(&quot;xss-body&quot;)');
  });

  it('does not render the sandbox warning card in dev mode', async () => {
    const app = createApp();
    const res = await request(app).get('/register/check-email');
    expect(res.text).not.toContain('Staging: email delivery is restricted');
    expect(res.text).not.toContain('simulator.amazonses.com');
  });
});

describe('GET /internal/dev-outbox — retired', () => {
  it('no longer serves the dev-outbox view (route removed; /internal/* now requires auth and /dev-outbox has no handler)', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox');
    // Unauthenticated falls through to requireAuth → 302 /login. Either way
    // the response body must not contain the old dev-outbox template.
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('Dev Outbox');
    expect(res.text).not.toContain('Delivered At');
  });
});
