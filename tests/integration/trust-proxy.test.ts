/**
 * Trust-proxy contract: Express must honor X-Forwarded-For only from peers
 * inside the configured trust set, and ignore it from peers outside.
 *
 * Background (DD §3.2 + DD §6.2 + production trust chain):
 *   - In prod, nginx (peer to Express on the docker bridge) populates XFF
 *     with the real client IP after CloudFront's X-Origin-Verify gate has
 *     authenticated the request as having traversed the CDN.
 *   - Express's trust-proxy is set to the named-range string
 *     'loopback, linklocal, uniquelocal' so any private/loopback peer is
 *     trusted to supply XFF. The docker bridge always falls inside
 *     uniquelocal (172.16.0.0/12).
 *   - The structural property (private peer) replaces the brittle integer
 *     hop-count form. If a sidecar is added inside the trust boundary the
 *     contract still holds.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

function makeApp(trustProxy: number | boolean | string): express.Application {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/whoami', (req, res) => {
    res.json({ ip: req.ip, ips: req.ips });
  });
  return app;
}

describe('Express trust-proxy from a loopback peer (Supertest)', () => {
  const SPOOFED_XFF = '203.0.113.7';

  it('trust proxy = 0: XFF is ignored, req.ip is the peer IP', async () => {
    const app = makeApp(0);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', SPOOFED_XFF);
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('::ffff:127.0.0.1');
    expect(res.body.ips).toEqual([]);
  });

  it("trust proxy = 'loopback, linklocal, uniquelocal' (prod default): loopback peer is trusted, XFF is honored", async () => {
    const app = makeApp('loopback, linklocal, uniquelocal');
    const res = await request(app).get('/whoami').set('X-Forwarded-For', SPOOFED_XFF);
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe(SPOOFED_XFF);
    expect(res.body.ips).toEqual([SPOOFED_XFF]);
  });

  it("trust proxy = 'uniquelocal' (excludes loopback): loopback peer is NOT trusted, XFF is ignored", async () => {
    const app = makeApp('uniquelocal');
    const res = await request(app).get('/whoami').set('X-Forwarded-For', SPOOFED_XFF);
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('::ffff:127.0.0.1');
    expect(res.body.ips).toEqual([]);
  });

  it('multiple XFF entries: req.ip is the rightmost untrusted (server-outward walk)', async () => {
    const app = makeApp('loopback, linklocal, uniquelocal');
    const res = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', '198.51.100.5, 203.0.113.7');
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('203.0.113.7');
    expect(res.body.ips).toEqual(['203.0.113.7']);
  });

  it('different XFF values produce different req.ip (login-throttle keys diverge)', async () => {
    const app = makeApp('loopback, linklocal, uniquelocal');
    const a = await request(app).get('/whoami').set('X-Forwarded-For', '198.51.100.5');
    const b = await request(app).get('/whoami').set('X-Forwarded-For', '198.51.100.6');
    expect(a.body.ip).toBe('198.51.100.5');
    expect(b.body.ip).toBe('198.51.100.6');
  });
});

describe('Express trust-proxy resolver rejects public peers (compiled trust fn)', () => {
  // Supertest peers from loopback, so no test from this harness can simulate a
  // public-IP peer. Instead, exercise the compiled trust function Express
  // stores at `app.get('trust proxy fn')` directly, with crafted addresses.
  // This catches a regression where the named-range trust string is accidentally
  // broadened to all peers (e.g. `true` or `'all'`), which would otherwise pass
  // the integration tests above unchanged because Supertest peers are loopback.
  it("named-range trust function: public IPs are NOT trusted, private/loopback ARE", () => {
    const app = makeApp('loopback, linklocal, uniquelocal');
    const trust = app.get('trust proxy fn') as (addr: string, hop: number) => boolean;

    // Public IPs (TEST-NET-2 and TEST-NET-3 ranges) must be rejected.
    expect(trust('203.0.113.7', 0)).toBe(false);
    expect(trust('198.51.100.5', 0)).toBe(false);

    // Loopback, link-local, RFC1918 must be accepted.
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('169.254.0.1', 0)).toBe(true);
    expect(trust('10.0.0.1', 0)).toBe(true);
    expect(trust('172.20.0.1', 0)).toBe(true);  // docker bridge default lives here
    expect(trust('192.168.1.1', 0)).toBe(true);
  });

  it("trust = true (broaden-to-all regression): public IPs are accepted (this is the trap)", () => {
    const app = makeApp(true);
    const trust = app.get('trust proxy fn') as (addr: string, hop: number) => boolean;
    // Documenting the regression shape: if trust gets accidentally widened to
    // `true`, public peers would be honored. The named-range default above is
    // the defense.
    expect(trust('203.0.113.7', 0)).toBe(true);
  });
});

describe("Express resolves req.protocol from X-Forwarded-Proto when peer is trusted", () => {
  // CloudFront strips X-Forwarded-Proto and substitutes CloudFront-Forwarded-Proto;
  // nginx maps that back to X-Forwarded-Proto for the upstream Express. This
  // test covers the Express end of the chain: when a trusted peer (named-range)
  // sends X-Forwarded-Proto: https, req.protocol must resolve to 'https' so
  // the secure-cookie middleware (cookie-session, helmet HSTS preconditions,
  // and any code that sets `Secure` on its own cookies) takes the prod path.
  function makeProtocolApp(trustProxy: number | boolean | string): express.Application {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.get('/probe', (req, res) => {
      res.json({ protocol: req.protocol, secure: req.secure });
    });
    return app;
  }

  it("named-range trust + X-Forwarded-Proto: https from loopback → req.protocol === 'https'", async () => {
    const app = makeProtocolApp('loopback, linklocal, uniquelocal');
    const res = await request(app).get('/probe').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
    expect(res.body.protocol).toBe('https');
    expect(res.body.secure).toBe(true);
  });

  it("trust = 0: X-Forwarded-Proto is ignored, req.protocol === 'http'", async () => {
    const app = makeProtocolApp(0);
    const res = await request(app).get('/probe').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
    expect(res.body.protocol).toBe('http');
    expect(res.body.secure).toBe(false);
  });

  it("named-range trust without X-Forwarded-Proto: req.protocol falls back to socket scheme ('http' for Supertest)", async () => {
    const app = makeProtocolApp('loopback, linklocal, uniquelocal');
    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
    expect(res.body.protocol).toBe('http');
  });
});
