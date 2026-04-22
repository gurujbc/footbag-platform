/**
 * Integration tests for the historical-person direct claim flow (scenarios D
 * and E of the identity model). Covers:
 *   GET  /history/:personId/claim          — confirm page + eligibility gates
 *   POST /history/:personId/claim/confirm  — execute claim, with surname
 *                                            reconciliation and transitive
 *                                            legacy_members claim when HP
 *                                            has a legacy_member_id back-link.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import {
  insertMember,
  insertLegacyMember,
  insertHistoricalPerson,
  createTestSessionJwt,
} from '../fixtures/factories';

const TEST_DB_PATH = path.join(process.cwd(), `test-claim-hp-${Date.now()}.db`);

process.env.FOOTBAG_DB_PATH = TEST_DB_PATH;
process.env.PORT            = '3097';
process.env.NODE_ENV        = 'test';
process.env.LOG_LEVEL       = 'error';
process.env.PUBLIC_BASE_URL = 'http://localhost:3097';
process.env.SESSION_SECRET  = 'claim-hp-test-secret';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

let testDb: BetterSqlite3.Database;

// Member real-names use "Leberknight" surname so the surname-reconciliation
// checks against HPs carrying the same surname pass.
const CLAIMER_ID   = 'hpc-claimer';
const CLAIMER_SLUG = 'hpc_claimer';
const CLAIMER_NAME = 'David Leberknight';

const OTHER_ID     = 'hpc-other';
const OTHER_SLUG   = 'hpc_other';
const OTHER_NAME   = 'Unrelated Smith';

// HP with no legacy_member_id back-link (scenario D).
const HP_NO_LEGACY = 'hp-d-scenario-001';

// HP with legacy_member_id back-link, legacy_members row is unclaimed (scenario E).
const HP_WITH_LM   = 'hp-e-scenario-001';
const LM_FOR_HP_E  = 'LM-E-001';

// Already-claimed-by-another HP, for adversarial testing.
const HP_TAKEN     = 'hp-taken-001';
const HP_TAKEN_OWNER_ID = 'hpc-takenowner';

// HP with a legacy_member that has been claimed by someone else.
const HP_LM_TAKEN  = 'hp-lm-taken-001';
const LM_TAKEN     = 'LM-TAKEN-001';
const LM_TAKEN_OWNER_ID = 'hpc-lmtakenowner';

function claimerCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: CLAIMER_ID })}`;
}
function otherCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: OTHER_ID })}`;
}

beforeAll(async () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  testDb = new BetterSqlite3(TEST_DB_PATH);
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(schema);

  insertMember(testDb, { id: CLAIMER_ID, slug: CLAIMER_SLUG,
    real_name: CLAIMER_NAME, display_name: CLAIMER_NAME,
    login_email: 'hpc-claimer@example.com', country: null });
  insertMember(testDb, { id: OTHER_ID, slug: OTHER_SLUG,
    real_name: OTHER_NAME, display_name: OTHER_NAME,
    login_email: 'hpc-other@example.com' });

  // Scenario D: HP-only, no legacy_member.
  insertHistoricalPerson(testDb, {
    person_id: HP_NO_LEGACY,
    person_name: 'David Leberknight',
    legacy_member_id: null,
    country: 'NZ',
    hof_member: 1,
    hof_induction_year: 2005,
    bap_member: 0,
    first_year: 1988,
  });

  // Scenario E: HP + legacy_member both exist but not linked to a member yet.
  insertLegacyMember(testDb, {
    legacy_member_id: LM_FOR_HP_E,
    real_name: 'David Leberknight', display_name: 'David Leberknight',
    city: 'Wellington', region: null, country: null,
    is_hof: 0, is_bap: 0, legacy_email: 'e@oldsite.test',
  });
  insertHistoricalPerson(testDb, {
    person_id: HP_WITH_LM,
    person_name: 'David Leberknight',
    legacy_member_id: LM_FOR_HP_E,
    country: 'NZ',
    hof_member: 1, hof_induction_year: 2005,
    bap_member: 1,
    first_year: 1988,
  });

  // HP already owned by a different member (partial UNIQUE will block re-claim).
  insertMember(testDb, { id: HP_TAKEN_OWNER_ID, slug: 'hpc_takenowner',
    real_name: 'David Leberknight', display_name: 'David Leberknight',
    login_email: 'hpc-takenowner@example.com' });
  insertHistoricalPerson(testDb, {
    person_id: HP_TAKEN,
    person_name: 'David Leberknight',
    legacy_member_id: null,
    country: 'NZ',
    hof_member: 0, bap_member: 0,
  });
  testDb.prepare(
    `UPDATE members SET historical_person_id = ?, updated_at = '2025-01-01T00:00:00.000Z', updated_by = 'test', version = version + 1 WHERE id = ?`,
  ).run(HP_TAKEN, HP_TAKEN_OWNER_ID);

  // HP whose legacy_member is already claimed by someone else.
  insertLegacyMember(testDb, {
    legacy_member_id: LM_TAKEN,
    real_name: 'David Leberknight', display_name: 'David Leberknight',
  });
  insertMember(testDb, { id: LM_TAKEN_OWNER_ID, slug: 'hpc_lmtakenowner',
    real_name: 'David Leberknight', display_name: 'David Leberknight',
    login_email: 'hpc-lmtakenowner@example.com',
    legacy_member_id: LM_TAKEN,
  });
  testDb.prepare(
    `UPDATE legacy_members SET claimed_by_member_id = ?, claimed_at = '2025-01-01T00:00:00.000Z', version = version + 1 WHERE legacy_member_id = ?`,
  ).run(LM_TAKEN_OWNER_ID, LM_TAKEN);
  insertHistoricalPerson(testDb, {
    person_id: HP_LM_TAKEN,
    person_name: 'David Leberknight',
    legacy_member_id: LM_TAKEN,
    country: 'NZ', hof_member: 0, bap_member: 0,
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

// ── GET /history/:personId/claim ─────────────────────────────────────────────

describe('GET /history/:personId/claim', () => {
  it('unauthenticated -> 302 to /login with returnTo', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${HP_NO_LEGACY}/claim`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('authenticated, surname match, unclaimed HP (scenario D) -> 200 with confirm form', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${HP_NO_LEGACY}/claim`).set('Cookie', claimerCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('David Leberknight');
    expect(res.text).toContain('link the record');
    expect(res.text).toContain('NZ'); // country surfaced
  });

  it('authenticated, surname mismatch -> 422 with mismatch error', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${HP_NO_LEGACY}/claim`).set('Cookie', otherCookie());
    expect(res.status).toBe(422);
    expect(res.text).toContain('does not match');
  });

  it('HP already claimed by another member -> 422', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${HP_TAKEN}/claim`).set('Cookie', claimerCookie());
    expect(res.status).toBe(422);
    expect(res.text).toContain('already been claimed');
  });

  it('HP tied to a legacy_member claimed by someone else -> 422', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${HP_LM_TAKEN}/claim`).set('Cookie', claimerCookie());
    expect(res.status).toBe(422);
    expect(res.text).toContain('legacy account');
  });

  it('unknown HP -> 302 redirect to /history/:id (which will 404)', async () => {
    const app = createApp();
    const res = await request(app).get('/history/does-not-exist/claim').set('Cookie', claimerCookie());
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/history/does-not-exist');
  });
});

// ── POST /history/:personId/claim/confirm ────────────────────────────────────

describe('POST /history/:personId/claim/confirm — scenario D (HP-only)', () => {
  it('successful HP-only claim sets historical_person_id and merges HP fields', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/history/${HP_NO_LEGACY}/claim/confirm`)
      .set('Cookie', claimerCookie()).type('form').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/members/${CLAIMER_SLUG}`);

    const row = testDb.prepare(
      `SELECT historical_person_id, legacy_member_id, country, is_hof, is_bap,
              hof_inducted_year, first_competition_year
       FROM members WHERE id = ?`,
    ).get(CLAIMER_ID) as {
      historical_person_id: string | null;
      legacy_member_id: string | null;
      country: string | null;
      is_hof: number;
      is_bap: number;
      hof_inducted_year: number | null;
      first_competition_year: number | null;
    };
    expect(row.historical_person_id).toBe(HP_NO_LEGACY);
    expect(row.legacy_member_id).toBeNull();
    expect(row.country).toBe('NZ');
    expect(row.is_hof).toBe(1);
    expect(row.hof_inducted_year).toBe(2005);
    expect(row.first_competition_year).toBe(1988);
  });

  it('claimer cannot claim a second HP once linked', async () => {
    // CLAIMER already linked from the previous test; a second HP claim must fail.
    const secondHp = 'hp-second-for-claimer';
    insertHistoricalPerson(testDb, {
      person_id: secondHp, person_name: 'David Leberknight',
      hof_member: 0, bap_member: 0,
    });
    const app = createApp();
    const res = await request(app)
      .post(`/history/${secondHp}/claim/confirm`)
      .set('Cookie', claimerCookie()).type('form').send({});
    expect(res.status).toBe(422);
    expect(res.text).toContain('already linked');
  });
});

describe('POST /history/:personId/claim/confirm — scenario E (HP + unclaimed legacy)', () => {
  it('transitive legacy_members claim: HP claim also marks legacy row claimed', async () => {
    const scenarioEClaimerId = insertMember(testDb, {
      slug: 'scenario_e', real_name: 'David Leberknight', display_name: 'David Leberknight',
      login_email: 'scenario-e@example.com', country: null,
    });
    const scenarioECookie = `footbag_session=${createTestSessionJwt({ memberId: scenarioEClaimerId })}`;

    const app = createApp();
    const res = await request(app)
      .post(`/history/${HP_WITH_LM}/claim/confirm`)
      .set('Cookie', scenarioECookie).type('form').send({});
    expect(res.status).toBe(302);

    const memberRow = testDb.prepare(
      'SELECT historical_person_id, legacy_member_id, country, is_hof, is_bap FROM members WHERE id = ?',
    ).get(scenarioEClaimerId) as {
      historical_person_id: string | null;
      legacy_member_id: string | null;
      country: string | null;
      is_hof: number;
      is_bap: number;
    };
    expect(memberRow.historical_person_id).toBe(HP_WITH_LM);
    expect(memberRow.legacy_member_id).toBe(LM_FOR_HP_E);
    expect(memberRow.country).toBe('NZ');
    expect(memberRow.is_hof).toBe(1);
    expect(memberRow.is_bap).toBe(1);

    const lmRow = testDb.prepare(
      'SELECT claimed_by_member_id, claimed_at FROM legacy_members WHERE legacy_member_id = ?',
    ).get(LM_FOR_HP_E) as { claimed_by_member_id: string | null; claimed_at: string | null };
    expect(lmRow.claimed_by_member_id).toBe(scenarioEClaimerId);
    expect(lmRow.claimed_at).toBeTruthy();
  });
});

// ── Adversarial ──────────────────────────────────────────────────────────────

describe('POST /history/:personId/claim/confirm — adversarial', () => {
  it('second claim on the same HP is rejected by partial UNIQUE index', async () => {
    // CLAIMER already owns HP_NO_LEGACY from earlier. A fresh member with
    // matching surname attempts a second claim.
    const secondClaimerId = insertMember(testDb, {
      slug: 'hpc_second', real_name: 'Jamie Leberknight', display_name: 'Jamie Leberknight',
      login_email: 'hpc-second@example.com',
    });
    const secondCookie = `footbag_session=${createTestSessionJwt({ memberId: secondClaimerId })}`;
    const app = createApp();
    const res = await request(app)
      .post(`/history/${HP_NO_LEGACY}/claim/confirm`)
      .set('Cookie', secondCookie).type('form').send({});
    expect(res.status).toBe(422);
    expect(res.text).toContain('already been claimed');
  });

  it('surname-mismatch member cannot POST-confirm even if they bypass the form', async () => {
    const surnameMismatchHp = 'hp-surname-mismatch-adv';
    insertHistoricalPerson(testDb, {
      person_id: surnameMismatchHp, person_name: 'Brenda Xavier',
      hof_member: 1, bap_member: 0,
    });
    const app = createApp();
    const res = await request(app)
      .post(`/history/${surnameMismatchHp}/claim/confirm`)
      .set('Cookie', otherCookie()).type('form').send({});
    expect(res.status).toBe(422);
    expect(res.text).toContain('does not match');
  });
});
