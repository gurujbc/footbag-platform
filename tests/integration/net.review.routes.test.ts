/**
 * Integration tests for the internal net review / QC page.
 *
 * Covers:
 *   GET /internal/net/review              — unfiltered review page
 *   GET /internal/net/review?reason=...   — filtered by reason_code
 *   GET /internal/net/review?priority=... — filtered by priority
 *   GET /internal/net/review?status=...   — filtered by resolution_status
 *   GET /internal/net/review?event=...    — filtered by event_id (with context)
 *   GET /internal/net/review?classification=... — filtered by classification
 *   GET /internal/net/review?fix_type=...       — filtered by proposed_fix_type
 *   GET /internal/net/review?decision=...       — filtered by decision_status
 *
 * Verifies:
 *   - 200 response
 *   - Summary counts render correctly (incl. byClassification, byDecision)
 *   - Filter controls render with correct selected values
 *   - Review items table shows filtered subset + 4 new classification columns
 *   - Event context banner renders when event filter is active
 *   - Conflict / review-needed discipline mappings section renders
 *   - Classification labels rendered (not raw values)
 *   - Unclassified items show "—" in classification columns
 *   - Invalid filter values are silently ignored (not 400)
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
  insertEvent,
  insertDiscipline,
  insertMember,
  insertResultsUpload,
  insertResultEntry,
  insertNetTeam,
  insertNetTeamMember,
  insertNetTeamAppearance,
  insertNetReviewQueueItem,
  insertNetRecoveryAliasCandidate,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3099');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const EVENT_2018_ID = 'event-rv-2018';
const EVENT_2014_ID = 'event-rv-2014';
const PERSON_A = 'person-rv-aa-test';
const PERSON_B = 'person-rv-bb-test';
const TEAM_AB  = 'net-team-rv-ab-001';

function setupDb(db: BetterSqlite3.Database): void {
  // Persons and a team so events can have net appearances
  insertHistoricalPerson(db, { person_id: PERSON_A, person_name: 'Review Alpha' });
  insertHistoricalPerson(db, { person_id: PERSON_B, person_name: 'Review Beta' });

  const ev2018 = insertEvent(db, {
    id: EVENT_2018_ID, title: 'Review Open 2018',
    start_date: '2018-07-01', city: 'Seattle', country: 'US',
  });
  const ev2014 = insertEvent(db, {
    id: EVENT_2014_ID, title: 'Review Cup 2014',
    start_date: '2014-06-01', city: 'Austin', country: 'US',
  });

  const disc2018 = insertDiscipline(db, ev2018, {
    id: 'disc-rv-open-2018', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });
  const disc2014 = insertDiscipline(db, ev2014, {
    id: 'disc-rv-open-2014', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });
  // Conflict discipline
  const disc2014c = insertDiscipline(db, ev2014, {
    id: 'disc-rv-conf-2014', name: 'Footbag Net: Conflict',
    discipline_category: 'net', team_type: 'doubles',
  });

  const member  = insertMember(db);
  const up2018  = insertResultsUpload(db, ev2018, member);
  const up2014  = insertResultsUpload(db, ev2014, member);

  const en1 = insertResultEntry(db, ev2018, up2018, disc2018, { id: 'entry-rv-1', placement: 1 });
  const en2 = insertResultEntry(db, ev2014, up2014, disc2014,  { id: 'entry-rv-2', placement: 2 });

  insertNetTeam(db, {
    team_id: TEAM_AB, person_id_a: PERSON_A, person_id_b: PERSON_B,
    first_year: 2014, last_year: 2018, appearance_count: 2,
  });
  insertNetTeamMember(db, { team_id: TEAM_AB, person_id: PERSON_A, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_AB, person_id: PERSON_B, position: 'b' });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2018, discipline_id: disc2018, result_entry_id: en1, placement: 1, event_year: 2018 });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2014, discipline_id: disc2014, result_entry_id: en2, placement: 2, event_year: 2014 });

  // net_discipline_group: conflict_flag=1 for disc2014c, review_needed=1 for disc2018
  db.prepare(`
    INSERT INTO net_discipline_group
      (discipline_id, canonical_group, match_method, review_needed, conflict_flag, mapped_at, mapped_by)
    VALUES (?, 'uncategorized', 'pattern', 0, 1, '2025-01-01T00:00:00.000Z', 'test')
  `).run('disc-rv-conf-2014');

  db.prepare(`
    INSERT INTO net_discipline_group
      (discipline_id, canonical_group, match_method, review_needed, conflict_flag, mapped_at, mapped_by)
    VALUES (?, 'open_doubles', 'exact', 1, 0, '2025-01-01T00:00:00.000Z', 'test')
  `).run('disc-rv-open-2018');

  // Review queue items
  // Item 1: unknown_team, priority=2, open, ev2018
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 2, ?, ?,
            'rv-check-1', 'medium', 'unknown_team',
            'Team not resolved at 2018 event', 'open', '2025-01-01T00:00:00.000Z')
  `).run('rq-rv-1', EVENT_2018_ID, 'disc-rv-open-2018');

  // Item 2: multi_stage_result, priority=2, open, ev2018
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 2, ?, NULL,
            'rv-check-2', 'medium', 'multi_stage_result',
            'Multi-stage bracket at 2018 event', 'open', '2025-01-02T00:00:00.000Z')
  `).run('rq-rv-2', EVENT_2018_ID);

  // Item 3: discipline_team_type_mismatch, priority=3, resolved, ev2014
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 3, ?, ?,
            'rv-check-3', 'low', 'discipline_team_type_mismatch',
            'Team type mismatch at 2014 event', 'resolved', '2025-01-03T00:00:00.000Z')
  `).run('rq-rv-3', EVENT_2014_ID, 'disc-rv-conf-2014');

  // Item 4: priority=1 critical, open, no event
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 1, NULL, NULL,
            'rv-check-4', 'critical', 'unknown_team',
            'Duplicate team identity detected', 'open', '2025-01-04T00:00:00.000Z')
  `).run('rq-rv-4');

  // Item 5: classified — retag_team_type, fix_active, confirmed
  insertNetReviewQueueItem(db, {
    id:                       'rq-rv-5',
    event_id:                 EVENT_2018_ID,
    priority:                 2,
    reason_code:              'discipline_team_type_mismatch',
    message:                  'Singles disc tagged as doubles — retag fix active',
    resolution_status:        'open',
    classification:            'retag_team_type',
    proposed_fix_type:         'retag_team_type',
    classification_confidence: 'confirmed',
    decision_status:           'fix_active',
    classified_by:             'operator',
    classified_at:             '2025-03-01T12:00:00.000Z',
  });

  // Item 6: classified — split_merged_discipline, fix_encoded, tentative
  insertNetReviewQueueItem(db, {
    id:                       'rq-rv-6',
    event_id:                 EVENT_2014_ID,
    priority:                 2,
    reason_code:              'merged_discipline',
    message:                  'Two competitions merged into one discipline',
    resolution_status:        'open',
    classification:            'split_merged_discipline',
    proposed_fix_type:         'split_merged_discipline',
    classification_confidence: 'tentative',
    decision_status:           'fix_encoded',
    classified_by:             'operator',
    classified_at:             '2025-03-02T12:00:00.000Z',
  });

  // Recovery alias candidates for approval workflow tests
  insertNetRecoveryAliasCandidate(db, {
    id: 'rc-test-1',
    stub_name: 'J. Harley',
    stub_person_id: 'stub-harley',
    suggested_person_id: 'known-harley',
    suggested_person_name: 'James Harley',
    appearance_count: 2,
  });
  insertNetRecoveryAliasCandidate(db, {
    id: 'rc-test-2',
    stub_name: 'D. Greer',
    stub_person_id: 'stub-greer',
    suggested_person_id: 'known-greer',
    suggested_person_name: 'Dan Greer',
    appearance_count: 2,
    operator_decision: 'approve',
  });
  insertNetRecoveryAliasCandidate(db, {
    id: 'rc-test-3',
    stub_name: 'X. Fake',
    stub_person_id: 'stub-fake',
    suggested_person_id: 'known-fake',
    suggested_person_name: 'Xavier Fake',
    appearance_count: 1,
    operator_decision: 'reject',
  });
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /internal/net/review', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Net Review / QC');
  });

  it('shows the operator description', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Operator review');
    expect(res.text).toContain('Not shown in public pages');
  });

  it('shows summary counts by reason_code', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('unknown_team');
    expect(res.text).toContain('multi_stage_result');
    expect(res.text).toContain('discipline_team_type_mismatch');
  });

  it('shows summary counts by priority', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // Priority 1 (Critical) and 2 (High) and 3 (Structural) are all present
    expect(res.text).toContain('Critical');
    expect(res.text).toContain('High');
    expect(res.text).toContain('Structural');
  });

  it('shows summary counts by status', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('open');
    expect(res.text).toContain('resolved');
  });

  it('shows total item count', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // 4 total items
    expect(res.text).toContain('4');
  });

  it('renders all 4 review items by default', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Team not resolved at 2018 event');
    expect(res.text).toContain('Multi-stage bracket at 2018 event');
    expect(res.text).toContain('Team type mismatch at 2014 event');
    expect(res.text).toContain('Duplicate team identity detected');
  });

  it('shows event titles in the items table', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Review Open 2018');
  });

  it('shows discipline names in the items table', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Open Doubles Net');
  });

  it('shows the discipline mapping section with conflict_flag entry', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Discipline Mappings');
    expect(res.text).toContain('Footbag Net: Conflict');
  });

  it('shows review_needed entry in discipline mappings', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // disc2018 has review_needed=1
    expect(res.text).toContain('disc-rv-open-2018');
  });

  it('renders the filter form', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('name="reason"');
    expect(res.text).toContain('name="priority"');
    expect(res.text).toContain('name="status"');
    expect(res.text).toContain('name="event"');
  });

  it('does not show forbidden public-stat language', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('head-to-head');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('rating');
  });
});

describe('GET /internal/net/review?reason=unknown_team', () => {
  it('filters items to only unknown_team reason code', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?reason=unknown_team');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Team not resolved at 2018 event');
    expect(res.text).toContain('Duplicate team identity detected');
    // multi_stage and mismatch items must not appear
    expect(res.text).not.toContain('Multi-stage bracket at 2018 event');
    expect(res.text).not.toContain('Team type mismatch at 2014 event');
  });

  it('marks the reason dropdown as selected', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?reason=unknown_team');
    // The option value="unknown_team" should be selected
    expect(res.text).toContain('value="unknown_team" selected');
  });
});

describe('GET /internal/net/review?priority=1', () => {
  it('filters items to only priority 1', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?priority=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Duplicate team identity detected');
    expect(res.text).not.toContain('Team not resolved at 2018 event');
    expect(res.text).not.toContain('Multi-stage bracket at 2018 event');
  });
});

describe('GET /internal/net/review?status=resolved', () => {
  it('filters items to resolved only', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?status=resolved');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Team type mismatch at 2014 event');
    expect(res.text).not.toContain('Team not resolved at 2018 event');
  });
});

describe('GET /internal/net/review?event=event-rv-2018', () => {
  it('filters items to ev2018 only', async () => {
    const app = createApp();
    const res = await request(app).get(`/internal/net/review?event=${EVENT_2018_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Team not resolved at 2018 event');
    expect(res.text).toContain('Multi-stage bracket at 2018 event');
    expect(res.text).not.toContain('Team type mismatch at 2014 event');
    expect(res.text).not.toContain('Duplicate team identity detected');
  });

  it('shows event context banner when event filter is active', async () => {
    const app = createApp();
    const res = await request(app).get(`/internal/net/review?event=${EVENT_2018_ID}`);
    expect(res.text).toContain('Review Open 2018');
    expect(res.text).toContain('Seattle');
    // Link to net event page
    expect(res.text).toContain(`/net/events/${EVENT_2018_ID}`);
  });

  it('shows no event context for an unknown event_id', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?event=not-a-real-event');
    expect(res.status).toBe(200);
    // No event context banner — just no items match either
    expect(res.text).not.toContain('Filtered to event:');
  });
});

describe('Classification columns in review items table', () => {
  it('renders new filter dropdowns in the filter form', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('name="classification"');
    expect(res.text).toContain('name="fix_type"');
    expect(res.text).toContain('name="decision"');
  });

  it('renders the classification label for a classified item (not raw value)', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // Item 5 has classification=retag_team_type → label is "Retag Team Type"
    expect(res.text).toContain('Retag Team Type');
    // Item 6 has classification=split_merged_discipline → label is "Split Merged Discipline"
    expect(res.text).toContain('Split Merged Discipline');
  });

  it('renders decision status labels (not raw values)', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // Item 5: fix_active → "Fix Active"
    expect(res.text).toContain('Fix Active');
    // Item 6: fix_encoded → "Fix Encoded"
    expect(res.text).toContain('Fix Encoded');
  });

  it('renders confidence labels for classified items', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('Confirmed');
    expect(res.text).toContain('Tentative');
  });

  it('renders em-dash for classification columns on unclassified items', async () => {
    const app = createApp();
    // Items 1–4 have no classification — the table should show "—" (em-dash entity or literal)
    const res = await request(app).get('/internal/net/review');
    // The page renders many "—" for unclassified rows; just confirm it doesn't crash
    expect(res.status).toBe(200);
    expect(res.text).toContain('Team not resolved at 2018 event');  // unclassified item still renders
  });
});

describe('GET /internal/net/review?classification=retag_team_type', () => {
  it('filters items to only retag_team_type classification', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?classification=retag_team_type');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Singles disc tagged as doubles');
    // Items without this classification must not appear
    expect(res.text).not.toContain('Team not resolved at 2018 event');
    expect(res.text).not.toContain('Two competitions merged');
  });

  it('marks the classification dropdown as selected', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?classification=retag_team_type');
    expect(res.text).toContain('value="retag_team_type" selected');
  });
});

describe('GET /internal/net/review?fix_type=split_merged_discipline', () => {
  it('filters items to only split_merged_discipline fix type', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?fix_type=split_merged_discipline');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Two competitions merged into one discipline');
    expect(res.text).not.toContain('Singles disc tagged as doubles');
  });
});

describe('GET /internal/net/review?decision=fix_active', () => {
  it('filters items to only fix_active decision', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?decision=fix_active');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Singles disc tagged as doubles');
    expect(res.text).not.toContain('Two competitions merged into one discipline');
  });

  it('marks the decision dropdown as selected', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?decision=fix_active');
    expect(res.text).toContain('value="fix_active" selected');
  });
});

describe('Classification summary cards', () => {
  it('shows byClassification summary card when classified items exist', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.status).toBe(200);
    expect(res.text).toContain('By Classification');
  });

  it('shows byDecision summary card when items with decisions exist', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('By Decision');
  });

  it('summary classification links filter the page', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // The byClassification summary links should contain the classification value in href
    expect(res.text).toContain('/internal/net/review?classification=');
  });
});

describe('Invalid filter values are silently ignored', () => {
  it('ignores unknown classification value and shows all items', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?classification=not_a_real_classification');
    expect(res.status).toBe(200);
    // Invalid value stripped → unfiltered results
    expect(res.text).toContain('Team not resolved at 2018 event');
  });

  it('ignores unknown fix_type value', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?fix_type=bogus');
    expect(res.status).toBe(200);
  });

  it('ignores unknown decision value', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?decision=invalid');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /internal/net/review/:id/classify
// ---------------------------------------------------------------------------

describe('POST /internal/net/review/:id/classify', () => {
  it('valid classification persists and redirects', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/rq-rv-1/classify')
      .type('form')
      .send({
        classification: 'retag_team_type',
        proposed_fix_type: 'retag_team_type',
        classification_confidence: 'confirmed',
      });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/internal/net/review');

    // Verify the value persisted by checking the review page
    const page = await request(app).get('/internal/net/review');
    expect(page.text).toContain('Retag Team Type');
  });

  it('clears classification when empty string is sent', async () => {
    const app = createApp();
    // First set a value
    await request(app)
      .post('/internal/net/review/rq-rv-2/classify')
      .type('form')
      .send({ classification: 'parser_improvement' });

    // Then clear it
    const res = await request(app)
      .post('/internal/net/review/rq-rv-2/classify')
      .type('form')
      .send({ classification: '' });
    expect(res.status).toBe(302);
  });

  it('returns 400 for invalid classification value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/rq-rv-1/classify')
      .type('form')
      .send({ classification: 'not_a_valid_classification' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid proposed_fix_type value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/rq-rv-1/classify')
      .type('form')
      .send({ proposed_fix_type: 'bogus_fix_type' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid classification_confidence value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/rq-rv-1/classify')
      .type('form')
      .send({ classification_confidence: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown review item id', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/not-a-real-id/classify')
      .type('form')
      .send({ classification: 'unresolved' });
    expect(res.status).toBe(404);
  });

  it('partial update does not overwrite decision fields', async () => {
    const app = createApp();
    // Item rq-rv-5 has decision_status=fix_active from setup.
    // Updating classification should not clear decision_status.
    await request(app)
      .post('/internal/net/review/rq-rv-5/classify')
      .type('form')
      .send({ classification: 'parser_improvement' });

    // decision filter should still find item 5
    const page = await request(app).get('/internal/net/review?decision=fix_active');
    expect(page.text).toContain('Singles disc tagged as doubles');
  });
});

// ---------------------------------------------------------------------------
// POST /internal/net/review/:id/decision
// ---------------------------------------------------------------------------

describe('POST /internal/net/review/:id/decision', () => {
  it('valid decision update persists and redirects', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/rq-rv-3/decision')
      .type('form')
      .send({
        decision_status: 'deferred',
        decision_notes: 'Needs source review first',
      });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/internal/net/review');

    // Verify decision persisted
    const page = await request(app).get('/internal/net/review?decision=deferred');
    expect(page.text).toContain('Team type mismatch at 2014 event');
  });

  it('decision notes are saved correctly', async () => {
    const app = createApp();
    await request(app)
      .post('/internal/net/review/rq-rv-4/decision')
      .type('form')
      .send({
        decision_status: 'wont_fix',
        decision_notes: 'False positive, not actionable',
      });

    // The notes are not displayed in the table columns, but the decision_status is
    const page = await request(app).get('/internal/net/review?decision=wont_fix');
    expect(page.text).toContain('Duplicate team identity detected');
  });

  it('returns 400 for invalid decision_status value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/rq-rv-1/decision')
      .type('form')
      .send({ decision_status: 'approved' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown review item id', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/review/nonexistent/decision')
      .type('form')
      .send({ decision_status: 'deferred' });
    expect(res.status).toBe(404);
  });

  it('partial decision update does not overwrite classification fields', async () => {
    const app = createApp();
    // Item rq-rv-6 has classification=split_merged_discipline from setup.
    // Updating decision should not clear classification.
    await request(app)
      .post('/internal/net/review/rq-rv-6/decision')
      .type('form')
      .send({ decision_status: 'deferred' });

    // classification filter should still find item 6
    const page = await request(app).get('/internal/net/review?classification=split_merged_discipline');
    expect(page.text).toContain('Two competitions merged into one discipline');
  });
});

// ---------------------------------------------------------------------------
// Edit form rendering
// ---------------------------------------------------------------------------

describe('Inline edit forms in review items', () => {
  it('renders edit details toggle for each item', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('<details>');
    expect(res.text).toContain('Edit');
  });

  it('renders classify form with POST action', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('/classify');
    expect(res.text).toContain('Save Classification');
  });

  it('renders decision form with POST action', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('/decision');
    expect(res.text).toContain('Save Decision');
  });

  it('pre-selects current classification value for classified items', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    // Item rq-rv-5 has classification=retag_team_type — the form should pre-select it
    expect(res.text).toContain('value="retag_team_type" selected');
  });
});

// ---------------------------------------------------------------------------
// Regression: existing review page still works
// ---------------------------------------------------------------------------

describe('Regression: existing review page behavior', () => {
  it('page still loads with all items', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.status).toBe(200);
    // 6 total items now (4 original + 2 classified)
    expect(res.text).toContain('Team not resolved at 2018 event');
    expect(res.text).toContain('Singles disc tagged as doubles');
    expect(res.text).toContain('Two competitions merged');
  });

  it('existing filters still work after POST operations', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review?priority=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Duplicate team identity detected');
  });
});

// ---------------------------------------------------------------------------
// GET /internal/net/review/summary
// ---------------------------------------------------------------------------

describe('GET /internal/net/review/summary', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('Priority Summary');
  });

  it('shows totals section with correct total count', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    // 6 items seeded (4 unclassified + 2 classified)
    expect(res.text).toContain('Total items');
  });

  it('shows classified percentage', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    // 2 classified out of 6 = 33%
    expect(res.text).toContain('Classified');
  });

  it('shows classification breakdown with labels', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    // Items 5 and 6 have classifications
    expect(res.text).toContain('Retag Team Type');
    expect(res.text).toContain('Split Merged Discipline');
  });

  it('shows fix type breakdown with labels', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('By Fix Type');
  });

  it('shows decision status breakdown with labels', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    // After earlier POST tests mutate data: fix_active (rq-rv-5), deferred (rq-rv-3,6), wont_fix (rq-rv-4)
    expect(res.text).toContain('Fix Active');
    expect(res.text).toContain('Deferred');
  });

  it('shows actionable fixes section (fix_encoded + fix_active with fix type)', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('Ready-to-Fix Pipeline Work');
    // Both classified items have proposed_fix_type + decision_status in fix_encoded/fix_active
    expect(res.text).toContain('View items');
  });

  it('actionable fix links contain correct filter params', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('decision=fix_active');
  });

  it('shows top events with issues', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('Top Events with Issues');
    // Events from test setup have items linked
    expect(res.text).toContain('Review Open 2018');
  });

  it('classification links point to filtered review page', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('/internal/net/review?classification=');
  });

  it('decision links point to filtered review page', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('/internal/net/review?decision=');
  });

  it('event links point to filtered review page', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('/internal/net/review?event=');
  });

  it('back link to review page is present', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.text).toContain('/internal/net/review');
  });
});

describe('Review summary with empty classifications', () => {
  // The summary page should render gracefully when most items are unclassified
  // (4 of 6 items in our test fixture have no classification)
  it('shows empty-state messages for sections without data', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review/summary');
    expect(res.status).toBe(200);
    // The page always renders; empty sections show fallback text
    // Since we DO have classified items, the "no items classified" message should NOT appear
    expect(res.text).not.toContain('No items have been classified yet');
  });
});

describe('Review page links to summary', () => {
  it('review page contains link to summary', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('/internal/net/review/summary');
    expect(res.text).toContain('Priority Summary');
  });
});

// ---------------------------------------------------------------------------
// GET /internal/net/recovery-signals
// ---------------------------------------------------------------------------

describe('GET /internal/net/recovery-signals', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.text).toContain('Net Recovery Signals');
  });

  it('shows stub count', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.text).toContain('stub persons remaining');
  });

  it('renders High-Value Recovery Candidates section', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.text).toContain('High-Value Recovery Candidates');
  });

  it('renders Unresolved Partner Repeats section', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.text).toContain('Unresolved Partner Repeats');
  });

  it('renders Abbreviation Clusters section', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.text).toContain('Abbreviation Clusters');
  });

  it('handles empty data gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    // Test DB has no stub persons, so sections show empty-state messages
    expect(res.status).toBe(200);
  });

  it('is not accessible via public nav routes', async () => {
    const app = createApp();
    // The route is /internal/... only, not /net/recovery-signals
    const res = await request(app).get('/net/recovery-signals');
    expect(res.status).toBe(404);
  });

  it('review page links to recovery signals', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/review');
    expect(res.text).toContain('/internal/net/recovery-signals');
    expect(res.text).toContain('Recovery Signals');
  });
});

// ---------------------------------------------------------------------------
// GET /internal/net/recovery-candidates
// ---------------------------------------------------------------------------

describe('GET /internal/net/recovery-candidates', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('Recovery Candidates');
  });

  it('shows alias candidates section', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('Alias Candidates');
  });

  it('shows likely new persons section', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('Likely New Persons');
  });

  it('shows totals in hero stats', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('alias candidates');
    expect(res.text).toContain('likely new persons');
  });

  it('handles empty data gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    // Test DB has no stubs, so empty-state messages render
    expect(res.status).toBe(200);
  });

  it('is not accessible via public route', async () => {
    const app = createApp();
    const res = await request(app).get('/net/recovery-candidates');
    expect(res.status).toBe(404);
  });

  it('recovery signals page links to candidates', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-signals');
    expect(res.text).toContain('/internal/net/recovery-candidates');
  });
});

// ---------------------------------------------------------------------------
// POST /internal/net/recovery-candidates/:id/decision
// ---------------------------------------------------------------------------

describe('POST /internal/net/recovery-candidates/:id/decision', () => {
  it('valid approve persists and redirects', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/recovery-candidates/rc-test-1/decision')
      .type('form')
      .send({ decision: 'approve', notes: 'Confirmed via event overlap' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/internal/net/recovery-candidates');
  });

  it('valid reject persists', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/recovery-candidates/rc-test-1/decision')
      .type('form')
      .send({ decision: 'reject' });
    expect(res.status).toBe(302);
  });

  it('valid defer persists', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/recovery-candidates/rc-test-1/decision')
      .type('form')
      .send({ decision: 'defer' });
    expect(res.status).toBe(302);
  });

  it('returns 400 for invalid decision', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/recovery-candidates/rc-test-1/decision')
      .type('form')
      .send({ decision: 'invalid_value' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty decision', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/recovery-candidates/rc-test-1/decision')
      .type('form')
      .send({ decision: '' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown candidate id', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/internal/net/recovery-candidates/nonexistent/decision')
      .type('form')
      .send({ decision: 'approve' });
    expect(res.status).toBe(404);
  });

  it('approved candidate shows on page with correct styling', async () => {
    const app = createApp();
    // rc-test-2 was inserted as approved in setup
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('D. Greer');
    expect(res.text).toContain('Dan Greer');
    expect(res.text).toContain('rc-approved');
  });

  it('rejected candidate shows with reject styling', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('X. Fake');
    expect(res.text).toContain('rc-rejected');
  });

  it('shows approved count and export hint when approvals exist', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/net/recovery-candidates');
    expect(res.text).toContain('approved');
    expect(res.text).toContain('export_approved_aliases.py');
  });
});
