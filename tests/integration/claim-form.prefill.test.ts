/**
 * Integration tests for the enriched `GET /history/claim` page.
 *
 * Asserts the three additions:
 *   1. identifier input prefilled with member.real_name
 *   2. candidate list rendered when classification is tier3 + candidates exist
 *   3. soft "couldn't confidently match" notice alongside the candidates
 *
 * Also confirms the regression: the form still renders cleanly when the
 * member has no matching candidates (plain page), and the page stays
 * auth-gated.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import {
  insertMember,
  insertHistoricalPerson,
  insertLegacyMember,
  insertNameVariant,
  createTestSessionJwt,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3103');

let createApp: Awaited<ReturnType<typeof importApp>>;

// A member who would classify as tier3/multiple_name_candidates:
// email anchors to a legacy row with HP provenance, but real_name also
// matches a second HP with the same normalized name.
const MEM_MULTI = 'cf-mem-multi';
const HP_MULTI_A = 'cf-hp-multi-a';
const HP_MULTI_B = 'cf-hp-multi-b';

// A member with no matching candidate at all (plain form).
const MEM_PLAIN = 'cf-mem-plain';

// A member with a tier3 classification but zero candidates (plain form,
// no notice). Email anchor with HP provenance, but real_name unrelated.
const MEM_NONAME = 'cf-mem-noname';

beforeAll(async () => {
  const db = createTestDb(dbPath);

  insertLegacyMember(db, { legacy_member_id: 'cf-lm-multi', legacy_email: 'cf-multi@example.com' });
  insertHistoricalPerson(db, {
    person_id: HP_MULTI_A,
    person_name: 'Pat Common',
    legacy_member_id: 'cf-lm-multi',
  });
  insertHistoricalPerson(db, {
    person_id: HP_MULTI_B,
    person_name: 'Pat Common',
  });
  insertMember(db, {
    id: MEM_MULTI,
    slug: 'cf_mem_multi',
    login_email: 'cf-multi@example.com',
    real_name: 'Pat Common',
  });

  insertMember(db, {
    id: MEM_PLAIN,
    slug: 'cf_mem_plain',
    login_email: 'cf-plain@example.com',
    real_name: 'Nobody Matches',
  });

  insertLegacyMember(db, { legacy_member_id: 'cf-lm-noname', legacy_email: 'cf-noname@example.com' });
  insertHistoricalPerson(db, {
    person_id: 'cf-hp-noname',
    person_name: 'Provenance Target',
    legacy_member_id: 'cf-lm-noname',
  });
  insertMember(db, {
    id: MEM_NONAME,
    slug: 'cf_mem_noname',
    login_email: 'cf-noname@example.com',
    real_name: 'Totally Unrelated Name',
  });

  // Unused but present — ensures findAutoLinkCandidates has something to sort
  // through without colliding with fixtures.
  insertNameVariant(db, {
    canonical_normalized: 'pat common',
    variant_normalized:   'pat c',
  });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

function cookieFor(memberId: string): string {
  return `footbag_session=${createTestSessionJwt({ memberId })}`;
}

describe('GET /history/claim — enriched render', () => {
  it('prefills the identifier input with real_name for any authenticated member', async () => {
    const res = await request(createApp())
      .get('/history/claim')
      .set('Cookie', cookieFor(MEM_PLAIN));
    expect(res.status).toBe(200);
    expect(res.text).toContain('value="Nobody Matches"');
  });

  it('shows candidate list + soft notice for a tier3/multi member', async () => {
    const res = await request(createApp())
      .get('/history/claim')
      .set('Cookie', cookieFor(MEM_MULTI));
    expect(res.status).toBe(200);
    expect(res.text).toContain('confidently match your profile');
    expect(res.text).toContain('Pat Common');
    // Candidate links go to the existing HP-claim endpoint — no new route.
    expect(res.text).toContain(`href="/history/${HP_MULTI_A}/claim"`);
    expect(res.text).toContain(`href="/history/${HP_MULTI_B}/claim"`);
  });

  it('does NOT show candidates or notice when the member has no name matches', async () => {
    const res = await request(createApp())
      .get('/history/claim')
      .set('Cookie', cookieFor(MEM_NONAME));
    expect(res.status).toBe(200);
    // Plain render: prefill only, no candidates section, no notice.
    expect(res.text).toContain('value="Totally Unrelated Name"');
    expect(res.text).not.toContain('confidently match your profile');
    expect(res.text).not.toContain('Possible matches based on your name');
  });

  it('unauthenticated request still redirects to /login (auth gate preserved)', async () => {
    const res = await request(createApp()).get('/history/claim');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login(\?.*)?$/);
  });
});
