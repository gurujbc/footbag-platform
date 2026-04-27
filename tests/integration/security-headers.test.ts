/**
 * Security headers contract: helmet middleware applies defensive defaults to
 * every response, including a strict Content-Security-Policy that pins script
 * and style execution to the same origin and forbids inline handlers and
 * framing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';

const { dbPath } = setTestEnv('3066');

let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('Security headers (helmet defaults)', () => {
  it('public route carries the standard helmet headers', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=15552000/);
    expect(res.headers['strict-transport-security']).toMatch(/includeSubDomains/);
    expect(res.headers['strict-transport-security']).not.toMatch(/preload/);
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['origin-agent-cluster']).toBe('?1');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CSP locks scripts, styles, framing, and external sources to the documented allowlist', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    const directives = [
      "default-src 'self'",
      "script-src 'self'",
      "script-src-attr 'none'",
      "style-src 'self'",
      "img-src 'self' data: https://i.ytimg.com",
      "font-src 'self'",
      "connect-src 'self'",
      'frame-src https://www.youtube-nocookie.com',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ];
    for (const directive of directives) {
      expect(csp).toContain(directive);
    }
    // No 'unsafe-inline' / 'unsafe-eval' anywhere.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('health route also carries the helmet headers', async () => {
    const app = createApp();
    const res = await request(app).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});
