/**
 * Integration tests for legacy account claim routes (three-table design per DD §2.4).
 *
 * Covers:
 *   GET  /history/claim          — claim lookup form (auth required)
 *   POST /history/claim          — legacy identifier lookup
 *   POST /history/claim/confirm  — execute atomic merge against legacy_members
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { insertMember, insertLegacyMember, insertHistoricalPerson, createTestSessionJwt } from '../fixtures/factories';

const TEST_DB_PATH = path.join(process.cwd(), `test-claim-${Date.now()}.db`);

// JWT/SES env vars come from tests/setup-env.ts (per-vitest-worker defaults).
process.env.FOOTBAG_DB_PATH = TEST_DB_PATH;
process.env.PORT            = '3099';
process.env.NODE_ENV        = 'test';
process.env.LOG_LEVEL       = 'error';
process.env.PUBLIC_BASE_URL = 'http://localhost:3099';
process.env.SESSION_SECRET  = 'claim-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

const CLAIMER_ID   = 'claim-test-claimer';
const CLAIMER_SLUG = 'claim_tester';
const OTHER_ID     = 'claim-test-other';
const OTHER_SLUG   = 'other_tester';

// Legacy account with NO corresponding HP — claim just links legacy_member_id.
const LEGACY_NO_HP = 'LM-12345';

// Legacy account WITH a corresponding historical_person — claim also sets members.historical_person_id.
const LEGACY_WITH_HP  = '99999';
const HP_PERSON_ID    = 'hp-claim-test-001';

function claimerCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: CLAIMER_ID })}`;
}

function otherCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: OTHER_ID })}`;
}

let testDb: BetterSqlite3.Database;

beforeAll(async () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  testDb = new BetterSqlite3(TEST_DB_PATH);
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(schema);

  insertMember(testDb, { id: CLAIMER_ID, slug: CLAIMER_SLUG, display_name: 'Claim Tester', login_email: 'claimer@example.com' });
  insertMember(testDb, { id: OTHER_ID, slug: OTHER_SLUG, display_name: 'Other Tester', login_email: 'other@example.com' });

  insertLegacyMember(testDb, {
    legacy_member_id: LEGACY_NO_HP,
    real_name: 'Legacy Player',
    display_name: 'Legacy Player',
    legacy_user_id: 'legacyuser',
    legacy_email: 'legacy@oldsite.com',
    bio: 'Legacy bio text',
    city: 'Portland',
    country: 'US',
    is_hof: 1,
    is_bap: 0,
  });

  insertHistoricalPerson(testDb, {
    person_id: HP_PERSON_ID,
    person_name: 'Historical Claimant',
    legacy_member_id: LEGACY_WITH_HP,
    country: 'NZ',
    hof_member: 1,
    bap_member: 0,
  });
  insertLegacyMember(testDb, {
    legacy_member_id: LEGACY_WITH_HP,
    real_name: 'Historical Claimant',
    display_name: 'Historical Claimant',
    country: 'NZ',
    is_hof: 1,
    is_bap: 0,
  });

  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  testDb.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ── GET /history/claim ────────────────────────────────────────────────────────

describe('GET /history/claim — claim form', () => {
  it('unauthenticated -> 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app).get('/history/claim');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?returnTo=%2Fhistory%2Fclaim');
  });

  it('authenticated -> 200 with form', async () => {
    const app = createApp();
    const res = await request(app).get('/history/claim').set('Cookie', claimerCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Legacy identifier');
  });
});

// ── POST /history/claim — lookup ──────────────────────────────────────────────

describe('POST /history/claim — lookup', () => {
  it('empty identifier -> 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim').set('Cookie', claimerCookie()).type('form').send({ identifier: '' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Please enter a legacy identifier');
  });

  it('valid match by legacy_email -> 200 with confirmation', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim').set('Cookie', claimerCookie()).type('form')
      .send({ identifier: 'legacy@oldsite.com' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Legacy Player');
    expect(res.text).toContain('Confirm');
  });

  it('valid match by legacy_member_id -> 200 with confirmation', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim').set('Cookie', claimerCookie()).type('form').send({ identifier: LEGACY_NO_HP });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Legacy Player');
  });

  it('valid match by legacy_user_id -> 200 with confirmation', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim').set('Cookie', claimerCookie()).type('form').send({ identifier: 'legacyuser' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Legacy Player');
  });

  it('no match -> 200 with "not found" message', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim').set('Cookie', claimerCookie()).type('form').send({ identifier: 'nonexistent@nowhere.com' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('No matching legacy record');
  });

  it('whitespace-only identifier -> 422', async () => {
    const freshId = insertMember(testDb, { slug: 'ws_tester', display_name: 'WS Tester', login_email: 'wstester@example.com' });
    const app = createApp();
    const res = await request(app)
      .post('/history/claim').set('Cookie', `footbag_session=${createTestSessionJwt({ memberId: freshId })}`)
      .type('form').send({ identifier: '   ' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Please enter a legacy identifier');
  });
});

// ── POST /history/claim/confirm — merge (no HP match) ────────────────────────

describe('POST /history/claim/confirm — merge (no HP match)', () => {
  it('successful merge -> 302 to profile; legacy_members row marked claimed (not deleted); HP FK stays NULL', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', claimerCookie())
      .type('form').send({ legacyMemberId: LEGACY_NO_HP });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/members/${CLAIMER_SLUG}`);

    const claimer = testDb.prepare(
      'SELECT legacy_member_id, historical_person_id, bio, city, is_hof, is_bap FROM members WHERE id = ?',
    ).get(CLAIMER_ID) as {
      legacy_member_id: string | null; historical_person_id: string | null;
      bio: string; city: string | null; is_hof: number; is_bap: number;
    };
    expect(claimer.legacy_member_id).toBe(LEGACY_NO_HP);
    expect(claimer.historical_person_id).toBeNull(); // no HP matches LEGACY_NO_HP.
    expect(claimer.is_hof).toBe(1);

    const legacy = testDb.prepare(
      'SELECT claimed_by_member_id, claimed_at FROM legacy_members WHERE legacy_member_id = ?',
    ).get(LEGACY_NO_HP) as { claimed_by_member_id: string | null; claimed_at: string | null };
    expect(legacy.claimed_by_member_id).toBe(CLAIMER_ID);
    expect(legacy.claimed_at).toBeTruthy();

    // Row is NOT deleted — three-table design keeps legacy_members permanent.
    const stillExists = testDb.prepare('SELECT 1 AS ok FROM legacy_members WHERE legacy_member_id = ?').get(LEGACY_NO_HP);
    expect(stillExists).toBeTruthy();
  });

  it('requesting member already claimed -> 422 with error', async () => {
    // CLAIMER is now already claimed from the previous test.
    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', claimerCookie())
      .type('form').send({ legacyMemberId: 'some-other-id' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('already linked');
  });

  it('non-existent legacy_member_id -> 422 with error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', otherCookie())
      .type('form').send({ legacyMemberId: 'does-not-exist' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('no longer available');
  });

  it('missing legacyMemberId -> 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', otherCookie()).type('form').send({});
    expect(res.status).toBe(422);
    expect(res.text).toContain('Invalid claim request');
  });

  it('empty legacyMemberId -> 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', otherCookie())
      .type('form').send({ legacyMemberId: '' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Invalid claim request');
  });
});

// ── POST /history/claim/confirm — merge (HP match exists) ────────────────────

describe('POST /history/claim/confirm — merge (HP match)', () => {
  it('successful claim sets members.historical_person_id from the matching HP', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', otherCookie())
      .type('form').send({ legacyMemberId: LEGACY_WITH_HP });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/members/${OTHER_SLUG}`);

    const member = testDb.prepare(
      'SELECT legacy_member_id, historical_person_id, is_hof FROM members WHERE id = ?',
    ).get(OTHER_ID) as { legacy_member_id: string | null; historical_person_id: string | null; is_hof: number };
    expect(member.legacy_member_id).toBe(LEGACY_WITH_HP);
    expect(member.historical_person_id).toBe(HP_PERSON_ID);
    expect(member.is_hof).toBe(1);
  });
});

// ── Merge field semantics ─────────────────────────────────────────────────────

describe('merge field semantics', () => {
  const MERGE_CLAIMER_ID    = 'merge-test-claimer';
  const MERGE_CLAIMER_SLUG  = 'merge_tester';
  const MERGE_LEGACY_ID     = 'LM-MERGE';

  function mergeCookie(): string {
    return `footbag_session=${createTestSessionJwt({ memberId: MERGE_CLAIMER_ID })}`;
  }

  it('fill-if-empty rules and OR semantics', async () => {
    insertMember(testDb, {
      id: MERGE_CLAIMER_ID, slug: MERGE_CLAIMER_SLUG,
      display_name: 'Merge Tester', login_email: 'mergetester@example.com',
      city: 'Denver', country: 'US',
    });
    insertLegacyMember(testDb, {
      legacy_member_id: MERGE_LEGACY_ID,
      real_name: 'Old Player', display_name: 'Old Player',
      bio: 'Legacy bio', city: 'Portland', region: 'OR', country: 'CA',
      is_hof: 0, is_bap: 1,
    });

    const app = createApp();
    const res = await request(app)
      .post('/history/claim/confirm').set('Cookie', mergeCookie())
      .type('form').send({ legacyMemberId: MERGE_LEGACY_ID });
    expect(res.status).toBe(302);

    const row = testDb.prepare(
      'SELECT legacy_member_id, bio, city, region, country, is_hof, is_bap FROM members WHERE id = ?',
    ).get(MERGE_CLAIMER_ID) as {
      legacy_member_id: string | null; bio: string;
      city: string | null; region: string | null; country: string | null;
      is_hof: number; is_bap: number;
    };

    expect(row.legacy_member_id).toBe(MERGE_LEGACY_ID);
    expect(row.bio).toBe('Legacy bio');      // member bio defaulted to '', filled from legacy.
    expect(row.city).toBe('Denver');         // member had 'Denver' (non-empty), not overwritten.
    expect(row.region).toBe('OR');           // member had NULL, filled from legacy.
    expect(row.country).toBe('US');          // member had 'US', not overwritten.
    expect(row.is_bap).toBe(1);              // OR semantics, legacy had 1.
    expect(row.is_hof).toBe(0);              // both 0.
  });
});

// ── Adversarial / race cases ──────────────────────────────────────────────────

describe('POST /history/claim/confirm — adversarial', () => {
  it('second claim on same legacy_members row is rejected', async () => {
    const raceLegacyId = 'LM-RACE';
    insertLegacyMember(testDb, {
      legacy_member_id: raceLegacyId, real_name: 'Race Target',
    });

    const firstId  = insertMember(testDb, { slug: 'race_first',  display_name: 'Race First',  login_email: 'racefirst@example.com' });
    const secondId = insertMember(testDb, { slug: 'race_second', display_name: 'Race Second', login_email: 'racesecond@example.com' });

    const firstCookie  = `footbag_session=${createTestSessionJwt({ memberId: firstId })}`;
    const secondCookie = `footbag_session=${createTestSessionJwt({ memberId: secondId })}`;

    const app = createApp();
    const res1 = await request(app)
      .post('/history/claim/confirm').set('Cookie', firstCookie)
      .type('form').send({ legacyMemberId: raceLegacyId });
    expect(res1.status).toBe(302);

    const res2 = await request(app)
      .post('/history/claim/confirm').set('Cookie', secondCookie)
      .type('form').send({ legacyMemberId: raceLegacyId });
    expect(res2.status).toBe(422);
    expect(res2.text).toContain('already been claimed');
  });
});
