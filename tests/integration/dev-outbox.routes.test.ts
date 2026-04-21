/**
 * Integration tests for the dev-only outbox viewer at /internal/dev-outbox.
 *
 * The viewer reads StubSesAdapter's in-memory sentMessages so a localhost
 * developer can complete activation / email-verification flows without
 * bypassing the adapter seam. Live-mode (SES_ADAPTER=live) behaviour is
 * covered in dev-outbox.live-mode.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3117');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let sesMod: typeof import('../../src/adapters/sesAdapter');

const VIEWER_ID = 'viewer-dev-outbox';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-dev-outbox', display_name: 'Viewer' });
  db.close();
  createApp = await importApp();
  sesMod = await import('../../src/adapters/sesAdapter');
  // Force the stub singleton to exist for the whole file.
  sesMod.getSesAdapter();
});

afterAll(() => cleanupTestDb(dbPath));

beforeEach(() => {
  sesMod.getStubSesAdapterForTests()?.clear();
});

async function sendStub(to: string, subject: string, bodyText: string): Promise<void> {
  await sesMod.getSesAdapter().sendEmail({ to, subject, bodyText });
}

describe('GET /internal/dev-outbox (stub mode)', () => {
  it('returns 200 and renders a sent message', async () => {
    await sendStub('user@example.com', 'Welcome', 'Visit https://example.com/verify/abc to finish.');
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('user@example.com');
    expect(res.text).toContain('Welcome');
    expect(res.text).toContain('Visit https://example.com/verify/abc to finish.');
    expect(res.text).toContain('https://example.com/verify/abc');
  });

  it('renders the empty-state block when no messages have been sent', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No messages sent yet.');
  });

  it('redirects unauthenticated requests to /login', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^\/login\?returnTo=/);
  });

  it('escapes HTML in subject and body (XSS safety)', async () => {
    await sendStub('xss@example.com', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>');
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    // Handlebars escapes < > = " ' & — assert the tag-opener is escaped and no raw tag slipped through.
    expect(res.text).toContain('&lt;img src');
    expect(res.text).not.toContain('<img src=x onerror');
  });

  it('shows newest messages first', async () => {
    await sendStub('a@example.com', 'First Subject Line', 'body one');
    await sendStub('b@example.com', 'Second Subject Line', 'body two');
    await sendStub('c@example.com', 'Third Subject Line', 'body three');
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    const idxFirst  = res.text.indexOf('First Subject Line');
    const idxSecond = res.text.indexOf('Second Subject Line');
    const idxThird  = res.text.indexOf('Third Subject Line');
    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxSecond).toBeGreaterThan(-1);
    expect(idxThird).toBeGreaterThan(-1);
    // Third (most recent) should appear before Second, and Second before First.
    expect(idxThird).toBeLessThan(idxSecond);
    expect(idxSecond).toBeLessThan(idxFirst);
  });

  it('renders the total message count in the hero stats', async () => {
    await sendStub('x@example.com', 'msg one', 'body');
    await sendStub('y@example.com', 'msg two', 'body');
    const app = createApp();
    const res = await request(app).get('/internal/dev-outbox').set('Cookie', COOKIE);
    expect(res.text).toContain('2 message(s)');
  });
});
