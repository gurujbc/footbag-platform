/**
 * Integration tests for the Phase 3B verification-time auto-link confirmation
 * flow. Covers the routing decisions made in authController.getVerify and
 * the read-only GET /history/auto-link page.
 *
 * Tier 1 / Tier 2 classifications route to the new confirmation UI.
 * Tier 3 continues to the existing /history/claim manual lookup form.
 * tier: 'none' continues to the existing dashboard redirect.
 *
 * Also asserts the PRE-confirmation no-write invariant: neither /verify
 * nor GET /history/auto-link creates any link on the member row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import {
  insertMember,
  insertHistoricalPerson,
  insertLegacyMember,
  insertNameVariant,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3101');

let createApp: Awaited<ReturnType<typeof importApp>>;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let tokenSvc: typeof import('../../src/services/accountTokenService');

// Fixture IDs.
const LEGACY_ID_TIER1  = 'legmem-rt-tier1';
const LEGACY_ID_TIER2  = 'legmem-rt-tier2';
const LEGACY_ID_TIER3  = 'legmem-rt-tier3';

const HP_TIER1 = 'hp-rt-tier1';
const HP_TIER2 = 'hp-rt-tier2';

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // Tier 1: exact name match via HP provenance.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_TIER1, legacy_email: 'rt-tier1@example.com' });
  insertHistoricalPerson(db, {
    person_id:         HP_TIER1,
    person_name:       'Jordan Alpha',
    legacy_member_id:  LEGACY_ID_TIER1,
  });
  insertMember(db, {
    id: 'mem-rt-tier1',
    slug: 'rt_tier1',
    login_email: 'rt-tier1@example.com',
    real_name: 'Jordan Alpha',
    email_verified_at: null,
  });

  // Tier 2: variant name match via name_variants.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_TIER2, legacy_email: 'rt-tier2@example.com' });
  insertHistoricalPerson(db, {
    person_id:         HP_TIER2,
    person_name:       'Alex Martínez',
    legacy_member_id:  LEGACY_ID_TIER2,
  });
  insertNameVariant(db, {
    canonical_normalized: 'alex martínez',
    variant_normalized:   'alex martinez',
  });
  insertMember(db, {
    id: 'mem-rt-tier2',
    slug: 'rt_tier2',
    login_email: 'rt-tier2@example.com',
    real_name: 'Alex Martinez',
    email_verified_at: null,
  });

  // Tier 3: email match but no HP provenance — falls through to /history/claim.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_TIER3, legacy_email: 'rt-tier3@example.com' });
  insertMember(db, {
    id: 'mem-rt-tier3',
    slug: 'rt_tier3',
    login_email: 'rt-tier3@example.com',
    real_name: 'Riley Gamma',
    email_verified_at: null,
  });

  // none: no legacy_members row matches this email.
  insertMember(db, {
    id: 'mem-rt-none',
    slug: 'rt_none',
    login_email: 'rt-none@example.com',
    real_name: 'Solo Member',
    email_verified_at: null,
  });

  db.close();
  createApp = await importApp();
  tokenSvc = await import('../../src/services/accountTokenService');
});

afterAll(() => cleanupTestDb(dbPath));

function issueVerifyToken(memberId: string): string {
  return tokenSvc.accountTokenService.issueToken({
    memberId,
    tokenType: 'email_verify',
    ttlHours: 24,
  }).rawToken;
}

function linkageCounts() {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const n = (sql: string) =>
    (db.prepare(sql).get() as { n: number }).n;
  const counts = {
    claimedHp: n('SELECT COUNT(*) AS n FROM members WHERE historical_person_id IS NOT NULL'),
    claimedLm: n('SELECT COUNT(*) AS n FROM members WHERE legacy_member_id IS NOT NULL'),
    legacyClaimedBy: n('SELECT COUNT(*) AS n FROM legacy_members WHERE claimed_by_member_id IS NOT NULL'),
  };
  db.close();
  return counts;
}

describe('verify → auto-link routing', () => {
  it('Tier 1 verify redirects to /history/auto-link', async () => {
    const token = issueVerifyToken('mem-rt-tier1');
    const res = await request(createApp()).get(`/verify/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/auto-link');
  });

  it('Tier 2 verify redirects to /history/auto-link', async () => {
    const token = issueVerifyToken('mem-rt-tier2');
    const res = await request(createApp()).get(`/verify/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/auto-link');
  });

  it('Tier 3 verify continues to the existing manual /history/claim path', async () => {
    const token = issueVerifyToken('mem-rt-tier3');
    const res = await request(createApp()).get(`/verify/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/claim');
  });

  it("tier: 'none' verify continues to the existing /members/:slug dashboard", async () => {
    const token = issueVerifyToken('mem-rt-none');
    const res = await request(createApp()).get(`/verify/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/rt_none');
  });
});

describe('GET /history/auto-link', () => {
  async function verifyAndFollow(memberId: string) {
    const token = issueVerifyToken(memberId);
    const agent = request.agent(createApp());
    const verifyRes = await agent.get(`/verify/${token}`);
    expect(verifyRes.status).toBe(302);
    return agent.get('/history/auto-link');
  }

  it('Tier 1 renders the confirm UI naming the candidate HP', async () => {
    const res = await verifyAndFollow('mem-rt-tier1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Jordan Alpha');
    expect(res.text).toContain('We found a match');
    // Confirm link points at the existing HP claim endpoint.
    expect(res.text).toContain(`action="/history/${HP_TIER1}/claim"`);
  });

  it('Tier 2 renders the confirm UI naming the canonical HP (diacritic preserved)', async () => {
    const res = await verifyAndFollow('mem-rt-tier2');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alex Martínez');
    expect(res.text).toContain(`action="/history/${HP_TIER2}/claim"`);
  });

  it('redirects to /login when unauthenticated', async () => {
    const res = await request(createApp()).get('/history/auto-link');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login(\?.*)?$/);
  });

  it('falls through to /history/claim when classification is no longer tier1/tier2', async () => {
    // Tier 3 member who somehow reaches /history/auto-link (e.g. bookmark).
    const token = issueVerifyToken('mem-rt-tier3');
    const agent = request.agent(createApp());
    await agent.get(`/verify/${token}`);
    const res = await agent.get('/history/auto-link');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/claim');
  });
});

describe('no writes before user confirmation', () => {
  it('no member or legacy_member row gains a link from verify + auto-link render alone', async () => {
    const before = linkageCounts();

    // Exercise every path. None of these click the "Yes" button, so no claim
    // is committed anywhere.
    for (const memberId of [
      'mem-rt-tier1',
      'mem-rt-tier2',
      'mem-rt-tier3',
      'mem-rt-none',
    ]) {
      const token = issueVerifyToken(memberId);
      const agent = request.agent(createApp());
      await agent.get(`/verify/${token}`);
      // Follow whatever /history/auto-link renders without clicking confirm.
      await agent.get('/history/auto-link');
    }

    const after = linkageCounts();
    expect(after).toEqual(before);
  });
});
