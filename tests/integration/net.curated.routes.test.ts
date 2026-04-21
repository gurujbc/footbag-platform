/**
 * Integration tests for the net candidate → curated promotion workflow.
 *
 * Covers:
 *   GET  /internal/net/candidates/:candidateId         — detail page
 *   POST /internal/net/candidates/:candidateId/approve — approve action
 *   POST /internal/net/candidates/:candidateId/reject  — reject action
 *
 * Verifies:
 *   - 200 on GET detail for existing candidate
 *   - 404 on GET detail for unknown candidateId
 *   - Detail page shows all provenance fields (raw text, confidence, players, event, source)
 *   - Detail page shows curate forms when not yet curated
 *   - Approve POST creates net_curated_match row + updates review_status = 'accepted'
 *   - Approve POST redirects to detail page (303 or 302)
 *   - Reject POST creates net_curated_match row + updates review_status = 'rejected'
 *   - Reject POST redirects to detail page
 *   - Double-approve returns 409
 *   - Double-reject returns 409
 *   - After curation, detail page shows curated banner and hides action forms
 *   - Note is stored in curated record
 *   - Approve/reject on unknown candidate returns 404
 *   - Public pages (/net, /net/teams) are unaffected
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';

import {
  setTestEnv,
  createTestDb,
  cleanupTestDb,
  importApp,
} from '../fixtures/testDb';
import {
  insertHistoricalPerson,
  insertNetRawFragment,
  insertNetCandidateMatch,
  insertNetCuratedMatch,
  insertMember,
  createTestSessionJwt,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3101');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const VIEWER_ID = 'viewer-net-curated';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

function internalGet(app: ReturnType<typeof createApp>, path: string) {
  return request(app).get(path).set('Cookie', COOKIE);
}
function internalPost(app: ReturnType<typeof createApp>, path: string) {
  return request(app).post(path).set('Cookie', COOKIE);
}

const PERSON_A   = 'person-curated-aa-test';
const PERSON_B   = 'person-curated-bb-test';
const CAND_BASIC = 'cand-curated-basic';
const CAND_LINKED = 'cand-curated-linked';
const CAND_PRE_APPROVED = 'cand-curated-pre-approved';
const CAND_PRE_REJECTED = 'cand-curated-pre-rejected';

function setupDb(db: BetterSqlite3.Database): void {
  insertHistoricalPerson(db, { person_id: PERSON_A, person_name: 'Alice Curated' });
  insertHistoricalPerson(db, { person_id: PERSON_B, person_name: 'Bob Curated' });

  // Fragment for linked candidate
  const fragId = insertNetRawFragment(db, {
    id:          'frag-curated-1',
    source_file: 'CURATED_TEST.txt',
    raw_text:    'Alice defeated Bob 11-7',
    year_hint:   2005,
  });

  // Basic unlinked candidate
  insertNetCandidateMatch(db, {
    candidate_id:    CAND_BASIC,
    fragment_id:     fragId,
    raw_text:        'Alice defeated Bob 11-7',
    player_a_raw_name: 'Alice',
    player_b_raw_name: 'Bob',
    confidence_score: 0.90,
    year_hint:       2005,
    review_status:   'pending',
  });

  // Fully linked candidate
  insertNetCandidateMatch(db, {
    candidate_id:       CAND_LINKED,
    fragment_id:        fragId,
    raw_text:           'Alice defeated Bob 11-7 in the final',
    player_a_raw_name:  'Alice',
    player_b_raw_name:  'Bob',
    player_a_person_id: PERSON_A,
    player_b_person_id: PERSON_B,
    extracted_score:    '11-7',
    round_hint:         'final',
    confidence_score:   0.90,
    year_hint:          2005,
    review_status:      'pending',
  });

  // Pre-approved candidate (for double-approve test)
  insertNetCandidateMatch(db, {
    candidate_id:    CAND_PRE_APPROVED,
    raw_text:        'Carol beat Dave 9-11 7-11',
    confidence_score: 0.75,
    review_status:   'accepted',
  });
  insertNetCuratedMatch(db, {
    candidate_id:   CAND_PRE_APPROVED,
    curated_status: 'approved',
    raw_text:       'Carol beat Dave 9-11 7-11',
    curated_by:     'operator',
  });

  // Pre-rejected candidate (for double-reject test)
  insertNetCandidateMatch(db, {
    candidate_id:    CAND_PRE_REJECTED,
    raw_text:        'Eve vs Frank 11-4',
    confidence_score: 0.65,
    review_status:   'rejected',
  });
  insertNetCuratedMatch(db, {
    candidate_id:   CAND_PRE_REJECTED,
    curated_status: 'rejected',
    raw_text:       'Eve vs Frank 11-4',
    curator_note:   'Too ambiguous',
    curated_by:     'operator',
  });
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-net-curated', display_name: 'Viewer' });
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ── GET detail page ────────────────────────────────────────────────────────────

describe('GET /internal/net/candidates/:candidateId', () => {
  it('returns 200 for an existing candidate', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown candidate', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates/not-a-real-id');
    expect(res.status).toBe(404);
  });

  it('shows the candidate raw text', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('Alice defeated Bob 11-7');
  });

  it('shows confidence label and score', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('high');
    expect(res.text).toContain('0.9');
  });

  it('shows source file', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('CURATED_TEST.txt');
  });

  it('shows unlinked badge when players are not linked', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('unlinked');
  });

  it('shows player links when candidate is fully linked', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_LINKED}`);
    expect(res.text).toContain('Alice Curated');
    expect(res.text).toContain('Bob Curated');
    expect(res.text).toContain(`/history/${PERSON_A}`);
    expect(res.text).toContain(`/history/${PERSON_B}`);
  });

  it('shows extracted score and round hint for linked candidate', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_LINKED}`);
    expect(res.text).toContain('11-7');
    expect(res.text).toContain('final');
  });

  it('shows year hint', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('2005');
  });

  it('shows approve and reject forms when not yet curated', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('/approve');
    expect(res.text).toContain('/reject');
    expect(res.text).toContain('Approve');
    expect(res.text).toContain('Reject');
  });

  it('shows curated banner for pre-approved candidate and hides action forms', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_PRE_APPROVED}`);
    expect(res.text).toContain('Approved');
    expect(res.text).toContain('already been curated');
    // Forms should not appear
    expect(res.text).not.toContain('action="/internal/net/candidates');
  });

  it('shows curated banner for pre-rejected candidate with note', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_PRE_REJECTED}`);
    expect(res.text).toContain('Rejected');
    expect(res.text).toContain('Too ambiguous');
  });

  it('includes back link to candidates list', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates/${CAND_BASIC}`);
    expect(res.text).toContain('/internal/net/candidates');
  });
});

// ── POST approve ──────────────────────────────────────────────────────────────

describe('POST /internal/net/candidates/:candidateId/approve', () => {
  it('redirects to detail page after approval', async () => {
    const app = createApp();
    const res = await internalPost(app, `/internal/net/candidates/${CAND_BASIC}/approve`)
      .type('form')
      .send({ note: '' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(CAND_BASIC);
  });

  it('creates a net_curated_match row with approved status', async () => {
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare(
      `SELECT curated_status, curated_by FROM net_curated_match WHERE candidate_id = ?`
    ).get(CAND_BASIC) as { curated_status: string; curated_by: string } | undefined;
    db.close();
    expect(row).toBeDefined();
    expect(row!.curated_status).toBe('approved');
    expect(row!.curated_by).toBe('operator');
  });

  it('sets candidate review_status to accepted', async () => {
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare(
      `SELECT review_status FROM net_candidate_match WHERE candidate_id = ?`
    ).get(CAND_BASIC) as { review_status: string } | undefined;
    db.close();
    expect(row?.review_status).toBe('accepted');
  });

  it('stores curator note when provided', async () => {
    // Use CAND_LINKED for this test (fresh candidate, no prior curation)
    const app = createApp();
    await internalPost(app, `/internal/net/candidates/${CAND_LINKED}/approve`)
      .type('form')
      .send({ note: 'Verified from video footage' });

    const db = new BetterSqlite3(dbPath);
    const row = db.prepare(
      `SELECT curator_note FROM net_curated_match WHERE candidate_id = ?`
    ).get(CAND_LINKED) as { curator_note: string | null } | undefined;
    db.close();
    expect(row?.curator_note).toBe('Verified from video footage');
  });

  it('returns 409 on double-approve', async () => {
    const app = createApp();
    const res = await internalPost(app, `/internal/net/candidates/${CAND_PRE_APPROVED}/approve`)
      .type('form')
      .send({});
    expect(res.status).toBe(409);
  });

  it('returns 404 for unknown candidate', async () => {
    const app = createApp();
    const res = await internalPost(app, '/internal/net/candidates/does-not-exist/approve')
      .type('form')
      .send({});
    expect(res.status).toBe(404);
  });
});

// ── POST reject ───────────────────────────────────────────────────────────────

describe('POST /internal/net/candidates/:candidateId/reject', () => {
  // Use a fresh candidate created only for rejection testing
  const CAND_FOR_REJECT = 'cand-curated-for-reject';

  beforeAll(() => {
    const db = new BetterSqlite3(dbPath);
    insertNetCandidateMatch(db, {
      candidate_id:    CAND_FOR_REJECT,
      raw_text:        'Grace vs Hank 7-11',
      confidence_score: 0.65,
      review_status:   'pending',
    });
    db.close();
  });

  it('redirects to detail page after rejection', async () => {
    const app = createApp();
    const res = await internalPost(app, `/internal/net/candidates/${CAND_FOR_REJECT}/reject`)
      .type('form')
      .send({ note: 'Noise line not a match' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain(CAND_FOR_REJECT);
  });

  it('creates a net_curated_match row with rejected status', async () => {
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare(
      `SELECT curated_status, curator_note FROM net_curated_match WHERE candidate_id = ?`
    ).get(CAND_FOR_REJECT) as { curated_status: string; curator_note: string | null } | undefined;
    db.close();
    expect(row?.curated_status).toBe('rejected');
    expect(row?.curator_note).toBe('Noise line not a match');
  });

  it('sets candidate review_status to rejected', async () => {
    const db = new BetterSqlite3(dbPath);
    const row = db.prepare(
      `SELECT review_status FROM net_candidate_match WHERE candidate_id = ?`
    ).get(CAND_FOR_REJECT) as { review_status: string } | undefined;
    db.close();
    expect(row?.review_status).toBe('rejected');
  });

  it('returns 409 on double-reject', async () => {
    const app = createApp();
    const res = await internalPost(app, `/internal/net/candidates/${CAND_PRE_REJECTED}/reject`)
      .type('form')
      .send({});
    expect(res.status).toBe(409);
  });

  it('returns 404 for unknown candidate', async () => {
    const app = createApp();
    const res = await internalPost(app, '/internal/net/candidates/ghost-candidate/reject')
      .type('form')
      .send({});
    expect(res.status).toBe(404);
  });
});

// ── Public pages unaffected ───────────────────────────────────────────────────

describe('Public net pages unaffected by curated data', () => {
  it('GET /net returns 200 without win/loss or ranking language', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/win\/loss|head-to-head|ranking|rating/i);
  });
});
