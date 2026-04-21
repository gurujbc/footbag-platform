/**
 * Integration tests for the internal net candidates / noise-extraction page.
 *
 * Covers:
 *   GET /internal/net/candidates                  — unfiltered page
 *   GET /internal/net/candidates?status=...       — filtered by review_status
 *   GET /internal/net/candidates?linked=true      — filtered to fully-linked candidates
 *   GET /internal/net/candidates?event=...        — filtered by event_id
 *   GET /internal/net/candidates?source=...       — filtered by source file
 *   GET /internal/net/candidates?min_confidence=  — filtered by confidence threshold
 *   GET /internal/net/candidates?group=event      — grouped by event
 *   GET /internal/net/candidates?group=source     — grouped by source
 *   GET /internal/net/candidates?group=year       — grouped by year
 *
 * Verifies:
 *   - 200 response
 *   - Extraction metrics rendered (totals, confidence buckets)
 *   - Source summary table (clickable filter links)
 *   - Event summary table (clickable filter links)
 *   - Year summary table
 *   - Filter controls render with correct selected values
 *   - Candidate items table shows correct subset
 *   - Confidence classes applied
 *   - Linked candidates show person name links; unlinked show raw names + badge
 *   - Grouping renders group headers
 *   - Empty state renders when no candidates match
 *   - No forbidden public-stat language: "head-to-head", "ranking", "win/loss", "rating"
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
  insertMember,
  createTestSessionJwt,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3100');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const VIEWER_ID = 'viewer-net-candidates';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

function internalGet(app: ReturnType<typeof createApp>, path: string) {
  return request(app).get(path).set('Cookie', COOKIE);
}

const PERSON_C  = 'person-cand-cc-test';
const PERSON_D  = 'person-cand-dd-test';
const EVENT_ID  = 'event-cand-2020';

function setupDb(db: BetterSqlite3.Database): void {
  insertHistoricalPerson(db, { person_id: PERSON_C, person_name: 'Candidate Charlie' });
  insertHistoricalPerson(db, { person_id: PERSON_D, person_name: 'Candidate Delta' });

  // Source 1: OLD_RESULTS.txt — 3 fragments, 2 candidates
  const frag1 = insertNetRawFragment(db, {
    id:            'frag-cand-1',
    source_file:   'OLD_RESULTS.txt',
    raw_text:      'Candidate Charlie defeated Candidate Delta 15-10',
    fragment_type: 'match_result',
    parse_status:  'parsed',
  });
  const frag2 = insertNetRawFragment(db, {
    id:            'frag-cand-2',
    source_file:   'OLD_RESULTS.txt',
    raw_text:      'Unknown Player A beat Unknown Player B',
    fragment_type: 'match_result',
    parse_status:  'parsed',
  });
  const frag3 = insertNetRawFragment(db, {
    id:            'frag-cand-3',
    source_file:   'OLD_RESULTS.txt',
    raw_text:      '1st - Alpha/Beta, 2nd - Gamma/Delta',
    fragment_type: 'placement_block',
    parse_status:  'unparseable',
  });

  // Source 2: EXTRA_SOURCE.txt — 1 fragment, 1 candidate (different source label)
  const frag4 = insertNetRawFragment(db, {
    id:            'frag-cand-4',
    source_file:   'EXTRA_SOURCE.txt',
    raw_text:      'Echo def. Foxtrot 11-6',
    fragment_type: 'match_result',
    parse_status:  'parsed',
  });

  // Candidate 1: fully linked, high confidence (0.90), pending, associated with event, year 2020
  insertNetCandidateMatch(db, {
    candidate_id:       'cand-1',
    fragment_id:        frag1,
    event_id:           EVENT_ID,
    player_a_raw_name:  'Candidate Charlie',
    player_b_raw_name:  'Candidate Delta',
    player_a_person_id: PERSON_C,
    player_b_person_id: PERSON_D,
    raw_text:           'Candidate Charlie defeated Candidate Delta 15-10',
    extracted_score:    '15-10',
    confidence_score:   0.90,
    review_status:      'pending',
    year_hint:          2020,
  });

  // Candidate 2: unlinked, medium confidence (0.75), pending, no event, year 2019
  insertNetCandidateMatch(db, {
    candidate_id:       'cand-2',
    fragment_id:        frag2,
    event_id:           null,
    player_a_raw_name:  'Unknown Player A',
    player_b_raw_name:  'Unknown Player B',
    player_a_person_id: null,
    player_b_person_id: null,
    raw_text:           'Unknown Player A beat Unknown Player B',
    extracted_score:    null,
    confidence_score:   0.75,
    review_status:      'pending',
    year_hint:          2019,
  });

  // Candidate 3: unlinked, accepted, medium confidence (0.75), no event, no year
  insertNetCandidateMatch(db, {
    candidate_id:       'cand-3',
    fragment_id:        frag3,
    event_id:           null,
    player_a_raw_name:  'Alpha',
    player_b_raw_name:  'Beta',
    player_a_person_id: null,
    player_b_person_id: null,
    raw_text:           'Alpha beat Beta',
    extracted_score:    null,
    confidence_score:   0.75,
    review_status:      'accepted',
    year_hint:          null,
  });

  // Candidate 4: unlinked, from EXTRA_SOURCE.txt, high confidence (0.90), pending, year 2019
  insertNetCandidateMatch(db, {
    candidate_id:       'cand-4',
    fragment_id:        frag4,
    event_id:           null,
    player_a_raw_name:  'Echo',
    player_b_raw_name:  'Foxtrot',
    player_a_person_id: null,
    player_b_person_id: null,
    raw_text:           'Echo def. Foxtrot 11-6',
    extracted_score:    '11-6',
    confidence_score:   0.90,
    review_status:      'pending',
    year_hint:          2019,
  });
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-net-candidates', display_name: 'Viewer' });
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('Net Match Candidates');
  });

  it('shows the operator description with evidence class label', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('unresolved_candidate');
    expect(res.text).toContain('Read-only');
  });

  // ── Extraction metrics ─────────────────────────────────────────────────────

  it('shows total fragment and candidate counts', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    // 4 fragments total, 4 candidates total
    expect(res.text).toContain('Total fragments');
    expect(res.text).toContain('Total candidates');
  });

  it('shows promote rate (candidates / fragments)', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    // 4 candidates / 4 fragments = 100%
    expect(res.text).toContain('Promote rate');
    expect(res.text).toContain('100%');
  });

  it('shows linked rate metric', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    // 1 fully linked out of 4 = 25%
    expect(res.text).toContain('Linked rate');
    expect(res.text).toContain('25%');
  });

  it('shows confidence bucket counts', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    // 2 high (cand-1 and cand-4), 2 medium (cand-2 and cand-3)
    expect(res.text).toContain('high');
    expect(res.text).toContain('medium');
  });

  // ── Source summary ─────────────────────────────────────────────────────────

  it('shows source summary section', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('By Source File');
    expect(res.text).toContain('OLD_RESULTS.txt');
    expect(res.text).toContain('EXTRA_SOURCE.txt');
  });

  it('source rows link to filtered view', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('source=OLD_RESULTS.txt');
  });

  // ── Event summary ──────────────────────────────────────────────────────────

  it('shows event summary section when candidates have event_id', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('By Event');
    expect(res.text).toContain(EVENT_ID);
  });

  it('event rows link to filtered view', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain(`event=${EVENT_ID}`);
  });

  // ── Year summary ───────────────────────────────────────────────────────────

  it('shows year summary section', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('By Year');
    expect(res.text).toContain('2019');
    expect(res.text).toContain('2020');
  });

  // ── Candidate items ────────────────────────────────────────────────────────

  it('renders all 4 candidates by default', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).toContain('Unknown Player A beat Unknown Player B');
    expect(res.text).toContain('Alpha beat Beta');
    expect(res.text).toContain('Echo def. Foxtrot 11-6');
  });

  it('shows linked candidate with person name links', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain(`/history/${PERSON_C}`);
    expect(res.text).toContain('Candidate Charlie');
    expect(res.text).toContain(`/history/${PERSON_D}`);
    expect(res.text).toContain('Candidate Delta');
  });

  it('shows unlinked candidate with raw names and unlinked badge', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('Unknown Player A');
    expect(res.text).toContain('Unknown Player B');
    expect(res.text).toContain('unlinked');
  });

  it('renders the filter form with all controls', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    expect(res.text).toContain('name="status"');
    expect(res.text).toContain('name="linked"');
    expect(res.text).toContain('name="event"');
    expect(res.text).toContain('name="source"');
    expect(res.text).toContain('name="min_confidence"');
    expect(res.text).toContain('name="group"');
  });

  it('does not show forbidden public-stat language', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('head-to-head');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('rating');
  });
});

// ---------------------------------------------------------------------------
// Filter: status
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?status=accepted', () => {
  it('filters to only accepted candidates', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?status=accepted');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alpha beat Beta');
    expect(res.text).not.toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).not.toContain('Unknown Player A beat Unknown Player B');
  });

  it('marks the status dropdown as selected', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?status=accepted');
    expect(res.text).toContain('value="accepted" selected');
  });
});

// ---------------------------------------------------------------------------
// Filter: linked_only
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?linked=true', () => {
  it('filters to only fully-linked candidates', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?linked=true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).not.toContain('Unknown Player A beat Unknown Player B');
    expect(res.text).not.toContain('Alpha beat Beta');
    expect(res.text).not.toContain('Echo def. Foxtrot 11-6');
  });

  it('marks the linked filter dropdown as selected', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?linked=true');
    expect(res.text).toContain('value="true" selected');
  });
});

// ---------------------------------------------------------------------------
// Filter: event
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?event=event-cand-2020', () => {
  it('filters to only candidates for that event', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates?event=${EVENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).not.toContain('Unknown Player A beat Unknown Player B');
    expect(res.text).not.toContain('Echo def. Foxtrot 11-6');
  });

  it('populates the event input with the filter value', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/candidates?event=${EVENT_ID}`);
    expect(res.text).toContain(`value="${EVENT_ID}"`);
  });
});

// ---------------------------------------------------------------------------
// Filter: source_file
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?source=EXTRA_SOURCE.txt', () => {
  it('filters to only candidates from that source', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?source=EXTRA_SOURCE.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Echo def. Foxtrot 11-6');
    expect(res.text).not.toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).not.toContain('Unknown Player A beat Unknown Player B');
  });

  it('populates the source input with the filter value', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?source=EXTRA_SOURCE.txt');
    expect(res.text).toContain('value="EXTRA_SOURCE.txt"');
  });
});

// ---------------------------------------------------------------------------
// Filter: min_confidence
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?min_confidence=0.85', () => {
  it('filters to only high-confidence candidates', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?min_confidence=0.85');
    expect(res.status).toBe(200);
    // cand-1 (0.90) and cand-4 (0.90) pass; cand-2 (0.75) and cand-3 (0.75) do not
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).toContain('Echo def. Foxtrot 11-6');
    expect(res.text).not.toContain('Unknown Player A beat Unknown Player B');
    expect(res.text).not.toContain('Alpha beat Beta');
  });

  it('marks the confidence dropdown as selected', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?min_confidence=0.85');
    expect(res.text).toContain('value="0.85" selected');
  });
});

// ---------------------------------------------------------------------------
// Grouping: by event
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?group=event', () => {
  it('returns 200 and shows grouped view with event group header', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?group=event');
    expect(res.status).toBe(200);
    // Should see group label for the event (event-cand-2020 since no event title in test DB)
    expect(res.text).toContain(EVENT_ID);
  });

  it('marks group dropdown as selected', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?group=event');
    expect(res.text).toContain('value="event" selected');
  });

  it('shows candidates within groups', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?group=event');
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
  });
});

// ---------------------------------------------------------------------------
// Grouping: by source
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?group=source', () => {
  it('returns 200 and shows source group headers', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?group=source');
    expect(res.status).toBe(200);
    expect(res.text).toContain('OLD_RESULTS.txt');
    expect(res.text).toContain('EXTRA_SOURCE.txt');
  });
});

// ---------------------------------------------------------------------------
// Grouping: by year
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?group=year', () => {
  it('returns 200 and shows year group headers', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?group=year');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2019');
    expect(res.text).toContain('2020');
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates?status=rejected', () => {
  it('shows empty state when no candidates match', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?status=rejected');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No candidates match the current filter');
  });
});

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------

describe('GET /internal/net/candidates combined filters', () => {
  it('status=pending + linked=true returns only linked pending candidates', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?status=pending&linked=true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).not.toContain('Unknown Player A beat Unknown Player B');
    expect(res.text).not.toContain('Echo def. Foxtrot 11-6');
  });

  it('min_confidence=0.85 + linked=true returns only high-conf linked candidates', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/candidates?min_confidence=0.85&linked=true');
    expect(res.status).toBe(200);
    // Only cand-1 (linked + 0.90 confidence) should appear
    expect(res.text).toContain('Candidate Charlie defeated Candidate Delta 15-10');
    expect(res.text).not.toContain('Echo def. Foxtrot 11-6');  // unlinked
  });
});
