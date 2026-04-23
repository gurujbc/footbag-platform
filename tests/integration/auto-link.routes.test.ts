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

// Dedicated fixtures for POST /history/auto-link/confirm. Kept separate
// from the read-only verify-routing fixtures so the commit tests can
// mutate members.historical_person_id without breaking other cases.
const LEGACY_ID_PC_T1       = 'legmem-pc-tier1';
const LEGACY_ID_PC_T2       = 'legmem-pc-tier2';
const LEGACY_ID_PC_MISMATCH = 'legmem-pc-mismatch';
const LEGACY_ID_PC_CLAIMED  = 'legmem-pc-claimed';

const HP_PC_T1        = 'hp-pc-tier1';
const HP_PC_T2        = 'hp-pc-tier2';
const HP_PC_MISMATCH  = 'hp-pc-mismatch';
const HP_PC_STRANGER  = 'hp-pc-stranger';   // not the tier1 candidate; used to POST a wrong personId
const HP_PC_CLAIMED   = 'hp-pc-claimed';    // already owned by another member

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

  // ── POST /history/auto-link/confirm fixtures ───────────────────────────
  // Tier 1 commit happy path.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_PC_T1, legacy_email: 'pc-t1@example.com' });
  insertHistoricalPerson(db, {
    person_id:        HP_PC_T1,
    person_name:      'Morgan Pcone',
    legacy_member_id: LEGACY_ID_PC_T1,
  });
  insertMember(db, {
    id: 'mem-pc-t1',
    slug: 'pc_t1',
    login_email: 'pc-t1@example.com',
    real_name: 'Morgan Pcone',
    email_verified_at: null,
  });

  // Tier 2 commit happy path (variant name match via name_variants).
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_PC_T2, legacy_email: 'pc-t2@example.com' });
  insertHistoricalPerson(db, {
    person_id:        HP_PC_T2,
    person_name:      'Chloé Pctwo',
    legacy_member_id: LEGACY_ID_PC_T2,
  });
  insertNameVariant(db, {
    canonical_normalized: 'chloé pctwo',
    variant_normalized:   'chloe pctwo',
  });
  insertMember(db, {
    id: 'mem-pc-t2',
    slug: 'pc_t2',
    login_email: 'pc-t2@example.com',
    real_name: 'Chloe Pctwo',
    email_verified_at: null,
  });

  // personId drift: member is tier1 → HP_PC_MISMATCH, but POSTs a stranger id.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_PC_MISMATCH, legacy_email: 'pc-mm@example.com' });
  insertHistoricalPerson(db, {
    person_id:        HP_PC_MISMATCH,
    person_name:      'Riley Pcmismatch',
    legacy_member_id: LEGACY_ID_PC_MISMATCH,
  });
  insertHistoricalPerson(db, {
    person_id:        HP_PC_STRANGER,
    person_name:      'Totally Unrelated Stranger',
  });
  insertMember(db, {
    id: 'mem-pc-mismatch',
    slug: 'pc_mismatch',
    login_email: 'pc-mm@example.com',
    real_name: 'Riley Pcmismatch',
    email_verified_at: null,
  });

  // ValidationError path: HP is tier1 target for mem-pc-already, but the
  // HP row is already claimed by mem-pc-other. Classifier returns tier1;
  // claimHistoricalPerson throws on the already-claimed check.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_PC_CLAIMED, legacy_email: 'pc-claimed@example.com' });
  insertHistoricalPerson(db, {
    person_id:        HP_PC_CLAIMED,
    person_name:      'Jamie Pcclaimed',
    legacy_member_id: LEGACY_ID_PC_CLAIMED,
  });
  insertMember(db, {
    id: 'mem-pc-other',
    slug: 'pc_other',
    login_email: 'pc-other@example.com',
    real_name: 'Third Party',
  });
  // MemberOverrides has no historical_person_id field, so set it directly
  // to simulate a pre-existing HP claim held by a different member.
  db.prepare('UPDATE members SET historical_person_id = ? WHERE id = ?')
    .run(HP_PC_CLAIMED, 'mem-pc-other');
  insertMember(db, {
    id: 'mem-pc-already',
    slug: 'pc_already',
    login_email: 'pc-claimed@example.com',
    real_name: 'Jamie Pcclaimed',
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
    // "Yes" form POSTs to the one-turn commit endpoint with the personId
    // carried in a hidden input (no GET bounce through /history/:personId/claim).
    expect(res.text).toContain('action="/history/auto-link/confirm"');
    expect(res.text).toContain(`value="${HP_TIER1}"`);
  });

  it('Tier 2 renders the confirm UI naming the canonical HP (diacritic preserved)', async () => {
    const res = await verifyAndFollow('mem-rt-tier2');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alex Martínez');
    expect(res.text).toContain('action="/history/auto-link/confirm"');
    expect(res.text).toContain(`value="${HP_TIER2}"`);
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

describe('POST /history/auto-link/confirm', () => {
  async function verifiedAgent(memberId: string) {
    const token = issueVerifyToken(memberId);
    const agent = request.agent(createApp());
    const v = await agent.get(`/verify/${token}`);
    expect(v.status).toBe(302);
    return agent;
  }

  function memberLink(memberId: string): { hp: string | null; lm: string | null } {
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const row = db.prepare(
      'SELECT historical_person_id AS hp, legacy_member_id AS lm FROM members WHERE id = ?',
    ).get(memberId) as { hp: string | null; lm: string | null } | undefined;
    db.close();
    return row ?? { hp: null, lm: null };
  }

  it('Tier 1 + matching personId commits and redirects to /members/:slug', async () => {
    const agent = await verifiedAgent('mem-pc-t1');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: HP_PC_T1 });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/pc_t1');
    expect(memberLink('mem-pc-t1').hp).toBe(HP_PC_T1);
  });

  it('Tier 2 + matching personId commits and redirects to /members/:slug', async () => {
    const agent = await verifiedAgent('mem-pc-t2');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: HP_PC_T2 });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/pc_t2');
    expect(memberLink('mem-pc-t2').hp).toBe(HP_PC_T2);
  });

  it('classifier now tier3: 302 /history/claim?reason=classification_changed, no commit', async () => {
    const before = memberLink('mem-rt-tier3');
    const agent = await verifiedAgent('mem-rt-tier3');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: 'anything-random' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/claim?reason=classification_changed');
    expect(memberLink('mem-rt-tier3')).toEqual(before);
  });

  it("classifier now 'none': 302 /members/:slug, no commit", async () => {
    const before = memberLink('mem-rt-none');
    const agent = await verifiedAgent('mem-rt-none');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: 'anything-random' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/rt_none');
    expect(memberLink('mem-rt-none')).toEqual(before);
  });

  it('personId mismatch (classifier sees a different tier1 HP): 302 /history/claim?reason=classification_changed, no commit', async () => {
    const before = memberLink('mem-pc-mismatch');
    const agent = await verifiedAgent('mem-pc-mismatch');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: HP_PC_STRANGER });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/history/claim?reason=classification_changed');
    expect(memberLink('mem-pc-mismatch')).toEqual(before);
  });

  it('follow the drift redirect: GET /history/claim?reason=classification_changed renders the explainer', async () => {
    const agent = await verifiedAgent('mem-pc-mismatch');
    const redirect = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: HP_PC_STRANGER });
    expect(redirect.status).toBe(302);

    const rendered = await agent.get(redirect.headers.location);
    expect(rendered.status).toBe(200);
    expect(rendered.text).toContain(
      "We couldn&#x27;t automatically confirm your match. Please review and select your record manually.",
    );
    // Uses the existing form-notice pattern (role="status"), not a new one.
    expect(rendered.text).toContain('class="form-notice"');
  });

  it('tier3 reason-aware message wins over the drift copy when both would apply', async () => {
    // mem-rt-tier3 arrives at /history/claim?reason=classification_changed
    // AND the classifier currently returns tier3/no_hp_for_legacy_account.
    // The more specific tier3 message should render; the generic drift
    // copy should NOT appear.
    const agent = await verifiedAgent('mem-rt-tier3');
    const res = await agent.get('/history/claim?reason=classification_changed');
    expect(res.status).toBe(200);
    expect(res.text).toContain('yet linked to a competition profile');
    expect(res.text).not.toContain('automatically confirm your match');
  });

  it('drift copy does not render without the query param', async () => {
    const agent = await verifiedAgent('mem-rt-none');
    const res = await agent.get('/history/claim');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('automatically confirm your match');
  });

  it('ValidationError (HP already claimed by another member): 422 re-renders confirm with error', async () => {
    const before = memberLink('mem-pc-already');
    const agent = await verifiedAgent('mem-pc-already');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: HP_PC_CLAIMED });
    expect(res.status).toBe(422);
    expect(res.text).toContain('already been claimed');
    // Re-render shows the candidate + the error banner for the shared template.
    expect(res.text).toContain('Jamie Pcclaimed');
    expect(memberLink('mem-pc-already')).toEqual(before);
  });

  it('unauthenticated POST redirects to /login (matches existing auth-gate convention)', async () => {
    const res = await request(createApp())
      .post('/history/auto-link/confirm')
      .type('form')
      .send({ personId: HP_PC_T1 });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login(\?.*)?$/);
  });

  it('missing personId body: 422 re-render with "Invalid claim request" error', async () => {
    const agent = await verifiedAgent('mem-pc-mismatch');
    const res = await agent
      .post('/history/auto-link/confirm')
      .type('form')
      .send({});  // no personId
    expect(res.status).toBe(422);
    expect(res.text).toContain('Invalid claim request');
    expect(memberLink('mem-pc-mismatch').hp).toBeNull();
  });
});
