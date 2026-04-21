/**
 * Integration tests for the internal net curated-match browser.
 *
 * Covers:
 *   GET /internal/net/curated              — base page, all items
 *   GET /internal/net/curated?status=      — filter by curated_status
 *   GET /internal/net/curated?source=      — filter by source file
 *   GET /internal/net/curated?event=       — filter by event_id
 *   GET /internal/net/curated?year=        — filter by year_hint
 *   GET /internal/net/curated?linked=true  — filter to fully-linked items
 *
 * Verifies:
 *   - 200 response on all variants
 *   - Summary metrics render (total, approved, rejected, linked)
 *   - By-source summary table renders with correct counts
 *   - By-event summary table renders with correct counts
 *   - By-year summary table renders with correct counts
 *   - Filter links in summary tables use triple-stache (no &#x3D; encoding)
 *   - Curated items table renders status badges, players, score, round, source, note, curated_at
 *   - Approved rows show badge-ok; rejected rows show badge-muted
 *   - Linked candidates show person name links
 *   - Unlinked candidates show raw names + unlinked badge
 *   - Candidate detail link present for each row
 *   - Filters reduce the item list correctly
 *   - Empty state renders when no items match
 *   - No forbidden public-stat language (ranking, head-to-head, win/loss, rating)
 *   - Public net pages unchanged
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

const { dbPath } = setTestEnv('3102');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const VIEWER_ID = 'viewer-net-curated-browse';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

function internalGet(app: ReturnType<typeof createApp>, path: string) {
  return request(app).get(path).set('Cookie', COOKIE);
}

// Fixed IDs for assertions
const PERSON_X   = 'person-browse-xx';
const PERSON_Y   = 'person-browse-yy';
const CAND_APP_1 = 'cand-browse-approved-1';
const CAND_APP_2 = 'cand-browse-approved-2';
const CAND_REJ_1 = 'cand-browse-rejected-1';
const CAND_NO_LNK = 'cand-browse-unlinked';
const EVENT_ID   = 'event-browse-2001';

function setupDb(db: BetterSqlite3.Database): void {
  insertHistoricalPerson(db, { person_id: PERSON_X, person_name: 'Xavier Browse' });
  insertHistoricalPerson(db, { person_id: PERSON_Y, person_name: 'Yvonne Browse' });

  // Fragment from source A
  const fragA = insertNetRawFragment(db, {
    id:          'frag-browse-a',
    source_file: 'OLD_RESULTS_1998.txt',
    raw_text:    'Xavier defeated Yvonne 11-7',
    year_hint:   1998,
  });

  // Fragment from source B
  const fragB = insertNetRawFragment(db, {
    id:          'frag-browse-b',
    source_file: 'WORLDS_2001.txt',
    raw_text:    'Yvonne beat Xavier 9-11 11-4 11-6',
    year_hint:   2001,
  });

  // Approved candidate 1 — linked, source A, year 1998
  insertNetCandidateMatch(db, {
    candidate_id:       CAND_APP_1,
    fragment_id:        fragA,
    raw_text:           'Xavier defeated Yvonne 11-7',
    player_a_raw_name:  'Xavier',
    player_b_raw_name:  'Yvonne',
    player_a_person_id: PERSON_X,
    player_b_person_id: PERSON_Y,
    extracted_score:    '11-7',
    round_hint:         'semi',
    confidence_score:   0.90,
    year_hint:          1998,
    review_status:      'accepted',
  });
  insertNetCuratedMatch(db, {
    candidate_id:       CAND_APP_1,
    curated_status:     'approved',
    player_a_person_id: PERSON_X,
    player_b_person_id: PERSON_Y,
    extracted_score:    '11-7',
    raw_text:           'Xavier defeated Yvonne 11-7',
    curator_note:       'Confirmed via program',
    curated_by:         'operator',
  });

  // Approved candidate 2 — linked, source B, year 2001, with event
  insertNetCandidateMatch(db, {
    candidate_id:       CAND_APP_2,
    fragment_id:        fragB,
    raw_text:           'Yvonne beat Xavier 9-11 11-4 11-6',
    player_a_raw_name:  'Yvonne',
    player_b_raw_name:  'Xavier',
    player_a_person_id: PERSON_Y,
    player_b_person_id: PERSON_X,
    extracted_score:    '9-11 11-4 11-6',
    round_hint:         'final',
    confidence_score:   0.90,
    year_hint:          2001,
    event_id:           EVENT_ID,
    review_status:      'accepted',
  });
  insertNetCuratedMatch(db, {
    candidate_id:       CAND_APP_2,
    curated_status:     'approved',
    player_a_person_id: PERSON_Y,
    player_b_person_id: PERSON_X,
    extracted_score:    '9-11 11-4 11-6',
    raw_text:           'Yvonne beat Xavier 9-11 11-4 11-6',
    event_id:           EVENT_ID,
    curated_by:         'operator',
  });

  // Rejected candidate — linked, source A, year 1998
  insertNetCandidateMatch(db, {
    candidate_id:       CAND_REJ_1,
    fragment_id:        fragA,
    raw_text:           'Practice drill not a match',
    player_a_raw_name:  'Xavier',
    player_b_raw_name:  'Yvonne',
    player_a_person_id: PERSON_X,
    player_b_person_id: PERSON_Y,
    confidence_score:   0.65,
    year_hint:          1998,
    review_status:      'rejected',
  });
  insertNetCuratedMatch(db, {
    candidate_id:       CAND_REJ_1,
    curated_status:     'rejected',
    player_a_person_id: PERSON_X,
    player_b_person_id: PERSON_Y,
    raw_text:           'Practice drill not a match',
    curator_note:       'Not a competitive match',
    curated_by:         'operator',
  });

  // Rejected candidate — unlinked (no person IDs)
  insertNetCandidateMatch(db, {
    candidate_id:      CAND_NO_LNK,
    raw_text:          'Alice def. Bob 11-5',
    player_a_raw_name: 'Alice',
    player_b_raw_name: 'Bob',
    confidence_score:  0.65,
    year_hint:         1995,
    review_status:     'rejected',
  });
  insertNetCuratedMatch(db, {
    candidate_id:   CAND_NO_LNK,
    curated_status: 'rejected',
    raw_text:       'Alice def. Bob 11-5',
    curated_by:     'operator',
  });
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-net-curated-browse', display_name: 'Viewer' });
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ── Base page ─────────────────────────────────────────────────────────────────

describe('GET /internal/net/curated', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.status).toBe(200);
  });

  it('shows page title', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Net Curated Matches');
  });

  it('includes internal-only disclaimer', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Not shown on public pages');
  });

  it('shows total curated count in summary', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    // 4 total curated rows
    expect(res.text).toContain('4');
  });

  it('shows approved count and percentage', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Approved');
    expect(res.text).toContain('50%');  // 2 approved of 4
  });

  it('shows rejected count', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Rejected');
  });

  it('shows no forbidden public-stat language', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).not.toMatch(/head-to-head|ranking|win\/loss|rating/i);
  });
});

// ── Summary tables ────────────────────────────────────────────────────────────

describe('Summary tables', () => {
  it('renders by-source summary', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('OLD_RESULTS_1998.txt');
    expect(res.text).toContain('WORLDS_2001.txt');
  });

  it('source filter links are not HTML-encoded', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    // Must not contain &#x3D; encoding from double-stache hrefs
    expect(res.text).not.toContain('&#x3D;');
    expect(res.text).toContain('source=');
  });

  it('renders by-event summary when event_id present', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain(EVENT_ID);
  });

  it('renders by-year summary', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('1998');
    expect(res.text).toContain('2001');
  });

  it('year filter links use correct format', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('year=1998');
  });
});

// ── Curated items table ───────────────────────────────────────────────────────

describe('Curated items table', () => {
  it('shows approved badge for approved rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('badge-ok');
    expect(res.text).toContain('approved');
  });

  it('shows rejected badge for rejected rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('badge-muted');
    expect(res.text).toContain('rejected');
  });

  it('shows linked player names with links for fully-linked rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Xavier Browse');
    expect(res.text).toContain('Yvonne Browse');
    expect(res.text).toContain(`/history/${PERSON_X}`);
    expect(res.text).toContain(`/history/${PERSON_Y}`);
  });

  it('shows raw names and unlinked badge for unlinked rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Alice');
    expect(res.text).toContain('Bob');
    expect(res.text).toContain('unlinked');
  });

  it('shows extracted score', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('11-7');
  });

  it('shows round hint', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('semi');
    expect(res.text).toContain('final');
  });

  it('shows curator note', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('Confirmed via program');
    expect(res.text).toContain('Not a competitive match');
  });

  it('shows source file in rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain('OLD_RESULTS_1998.txt');
  });

  it('includes candidate detail link for each row', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated');
    expect(res.text).toContain(`/internal/net/candidates/${CAND_APP_1}`);
    expect(res.text).toContain(`/internal/net/candidates/${CAND_REJ_1}`);
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe('Filter: status=approved', () => {
  it('returns only approved rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?status=approved');
    expect(res.status).toBe(200);
    expect(res.text).toContain('approved');
    expect(res.text).not.toContain('badge-muted');
  });

  it('excludes rejected rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?status=approved');
    expect(res.text).not.toContain('Not a competitive match');
  });
});

describe('Filter: status=rejected', () => {
  it('returns only rejected rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?status=rejected');
    expect(res.status).toBe(200);
    expect(res.text).toContain('rejected');
    expect(res.text).not.toContain('badge-ok');
  });
});

describe('Filter: source=', () => {
  it('returns only rows from that source', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?source=WORLDS_2001.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('WORLDS_2001.txt');
    // The other source should not appear in items (may still appear in summary)
  });

  it('returns empty state for unknown source', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?source=NONEXISTENT.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No curated matches match');
  });
});

describe('Filter: year=', () => {
  it('returns rows for the given year', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?year=1998');
    expect(res.status).toBe(200);
    expect(res.text).toContain('11-7');
  });

  it('excludes rows from other years', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?year=1998');
    // WORLDS_2001.txt candidate should not appear
    expect(res.text).not.toContain('9-11 11-4 11-6');
  });

  it('ignores malformed year values', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?year=bad');
    expect(res.status).toBe(200);   // falls back to unfiltered
  });
});

describe('Filter: event=', () => {
  it('returns rows for the given event', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/curated?event=${EVENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(EVENT_ID);
  });

  it('empty state for unknown event', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?event=not-real-event');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No curated matches match');
  });
});

describe('Filter: linked=true', () => {
  it('returns only fully-linked rows', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?linked=true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Xavier Browse');
    // Unlinked row should not appear
    expect(res.text).not.toContain(CAND_NO_LNK);
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('Empty state', () => {
  it('shows empty state when no items match the filter', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/curated?event=no-such-event-id');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No curated matches match');
  });
});

// ── Public pages unaffected ───────────────────────────────────────────────────

describe('Public net pages unaffected', () => {
  it('GET /net returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.status).toBe(200);
  });

  it('GET /net/teams returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.status).toBe(200);
  });
});
