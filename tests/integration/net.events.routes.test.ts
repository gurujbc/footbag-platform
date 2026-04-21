/**
 * Integration tests for net event routes.
 *
 * Covers:
 *   GET /net/events                       — public event list
 *   GET /internal/net/events/:eventId     — QC reviewer event detail
 *
 * Verifies:
 *   - 200 for valid routes, 404 for unknown eventId
 *   - Evidence disclaimer always present
 *   - Events ordered by start_date DESC
 *   - Events without net appearances do NOT appear in the list
 *   - Event detail shows discipline grouping, placement labels, player links
 *   - QC hints: multi_stage_hint badge, unknown_team excluded count notice
 *   - inferred_partial appearances do NOT appear
 *   - No rankings, win/loss, or head-to-head stats appear
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
  insertTag,
  insertDiscipline,
  insertMember,
  insertResultsUpload,
  insertResultEntry,
  insertNetTeam,
  insertNetTeamMember,
  insertNetTeamAppearance,
  createTestSessionJwt,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3097');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const VIEWER_ID = 'viewer-net-events';
const COOKIE = `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;

function internalGet(app: ReturnType<typeof createApp>, path: string) {
  return request(app).get(path).set('Cookie', COOKIE);
}

// Person IDs
const PERSON_A = 'person-evt-aa-test-1';
const PERSON_B = 'person-evt-bb-test-1';
const PERSON_C = 'person-evt-cc-test-1';
const PERSON_D = 'person-evt-dd-test-1';

// Event IDs — use legacy format (no event_ prefix) matching canonical pipeline
const EVENT_2015_ID = 'event-net-ev-2015';
const EVENT_2012_ID = 'event-net-ev-2012';
const EVENT_2010_ID = 'event-net-ev-2010';  // no net appearances → must NOT appear in list
const EVENT_2008_ID = 'event-net-ev-2008';  // only inferred_partial appearances → must NOT appear in list or detail

// Team IDs
const TEAM_AB = 'net-team-ev-ab-0001';
const TEAM_CD = 'net-team-ev-cd-0001';

function setupDb(db: BetterSqlite3.Database): void {
  // Persons
  insertHistoricalPerson(db, { person_id: PERSON_A, person_name: 'Eve Alpha' });
  insertHistoricalPerson(db, { person_id: PERSON_B, person_name: 'Eve Beta' });
  insertHistoricalPerson(db, { person_id: PERSON_C, person_name: 'Eve Gamma' });
  insertHistoricalPerson(db, { person_id: PERSON_D, person_name: 'Eve Delta' });

  // Events — each has an explicit canonical-pattern tag_normalized so that
  // href assertions can verify the canonical /events/event_{year}_{slug} shape.
  const tag2015 = insertTag(db, { tag_normalized: '#event_2015_net_worlds' });
  const tag2012 = insertTag(db, { tag_normalized: '#event_2012_net_open' });
  const tag2010 = insertTag(db, { tag_normalized: '#event_2010_no_net' });
  const tag2008 = insertTag(db, { tag_normalized: '#event_2008_inferred_only' });
  const ev2015 = insertEvent(db, {
    id: EVENT_2015_ID, hashtag_tag_id: tag2015, title: 'Net Worlds 2015',
    start_date: '2015-08-01', city: 'Portland', country: 'US',
  });
  const ev2012 = insertEvent(db, {
    id: EVENT_2012_ID, hashtag_tag_id: tag2012, title: 'Net Open 2012',
    start_date: '2012-06-15', city: 'Berlin', country: 'DE',
  });
  const ev2010 = insertEvent(db, {
    id: EVENT_2010_ID, hashtag_tag_id: tag2010, title: 'No Net 2010',
    start_date: '2010-05-01', city: 'Chicago', country: 'US',
  });
  const ev2008 = insertEvent(db, {
    id: EVENT_2008_ID, hashtag_tag_id: tag2008, title: 'Inferred Only 2008',
    start_date: '2008-03-01', city: 'Denver', country: 'US',
  });

  // Disciplines
  const disc2015a = insertDiscipline(db, ev2015, {
    id: 'disc-ev-open-2015', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });
  const disc2015b = insertDiscipline(db, ev2015, {
    id: 'disc-ev-womens-2015', name: "Women's Doubles Net",
    discipline_category: 'net', team_type: 'doubles',
  });
  const disc2012 = insertDiscipline(db, ev2012, {
    id: 'disc-ev-open-2012', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });
  // disc2012_conflict: has conflict_flag=1 in net_discipline_group
  const disc2012_conflict = insertDiscipline(db, ev2012, {
    id: 'disc-ev-conflict-2012', name: 'Footbag Net: Mixed',
    discipline_category: 'net', team_type: 'doubles',
  });
  const disc2008 = insertDiscipline(db, ev2008, {
    id: 'disc-ev-infer-2008', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });

  // Register conflict_flag discipline
  db.prepare(`
    INSERT INTO net_discipline_group
      (discipline_id, canonical_group, match_method, review_needed, conflict_flag, mapped_at, mapped_by)
    VALUES (?, 'mixed_doubles', 'pattern', 1, 1, '2025-01-01T00:00:00.000Z', 'test')
  `).run('disc-ev-conflict-2012');

  // FK chain
  const member   = insertMember(db);
  const upload15 = insertResultsUpload(db, ev2015, member);
  const upload12 = insertResultsUpload(db, ev2012, member);
  const upload08 = insertResultsUpload(db, ev2008, member);

  const entry_ab_2015_open   = insertResultEntry(db, ev2015, upload15, disc2015a, { id: 'entry-ev-ab-15a', placement: 1 });
  const entry_cd_2015_open   = insertResultEntry(db, ev2015, upload15, disc2015a, { id: 'entry-ev-cd-15a', placement: 2 });
  const entry_ab_2015_womens = insertResultEntry(db, ev2015, upload15, disc2015b, { id: 'entry-ev-ab-15b', placement: 1 });
  const entry_ab_2012_open   = insertResultEntry(db, ev2012, upload12, disc2012,  { id: 'entry-ev-ab-12',  placement: 3 });
  const entry_cd_2012_conf   = insertResultEntry(db, ev2012, upload12, disc2012_conflict, { id: 'entry-ev-cd-12c', placement: 1 });
  // inferred_partial — placed at ev2008 (separate event) to avoid UNIQUE (team_id, event_id, discipline_id)
  const entry_ab_2008_infer  = insertResultEntry(db, ev2008, upload08, disc2008, { id: 'entry-ev-ab-inf', placement: 1 });

  // Team AB: Eve Alpha + Eve Beta
  insertNetTeam(db, {
    team_id: TEAM_AB, person_id_a: PERSON_A, person_id_b: PERSON_B,
    first_year: 2012, last_year: 2015, appearance_count: 3,
  });
  insertNetTeamMember(db, { team_id: TEAM_AB, person_id: PERSON_A, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_AB, person_id: PERSON_B, position: 'b' });

  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2015, discipline_id: disc2015a, result_entry_id: entry_ab_2015_open,   placement: 1, event_year: 2015 });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2015, discipline_id: disc2015b, result_entry_id: entry_ab_2015_womens, placement: 1, event_year: 2015 });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2012, discipline_id: disc2012,  result_entry_id: entry_ab_2012_open,   placement: 3, event_year: 2012 });
  // inferred_partial at ev2008 — must NOT cause ev2008 to appear in /net/events or /internal/net/events/:eventId
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2008, discipline_id: disc2008, result_entry_id: entry_ab_2008_infer, placement: 1, event_year: 2008, evidence_class: 'inferred_partial' });

  // Team CD: Eve Gamma + Eve Delta
  insertNetTeam(db, {
    team_id: TEAM_CD, person_id_a: PERSON_C, person_id_b: PERSON_D,
    first_year: 2015, last_year: 2015, appearance_count: 2,
  });
  insertNetTeamMember(db, { team_id: TEAM_CD, person_id: PERSON_C, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_CD, person_id: PERSON_D, position: 'b' });

  insertNetTeamAppearance(db, { team_id: TEAM_CD, event_id: ev2015, discipline_id: disc2015a,      result_entry_id: entry_cd_2015_open, placement: 2, event_year: 2015 });
  insertNetTeamAppearance(db, { team_id: TEAM_CD, event_id: ev2012, discipline_id: disc2012_conflict, result_entry_id: entry_cd_2012_conf, placement: 1, event_year: 2012 });

  // QC review items
  // multi_stage_result hint for ev2015
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 2, ?, NULL,
            'test-check-1', 'medium', 'multi_stage_result',
            'Multi-stage bracket detected', 'open', '2025-01-01T00:00:00.000Z')
  `).run('rq-ev-multi-1', EVENT_2015_ID);

  // unknown_team items for ev2012 (2 excluded results)
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 2, ?, ?,
            'test-check-2', 'medium', 'unknown_team',
            'Team not resolved', 'open', '2025-01-01T00:00:00.000Z')
  `).run('rq-ev-unk-1', EVENT_2012_ID, 'disc-ev-open-2012');

  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 2, ?, ?,
            'test-check-3', 'medium', 'unknown_team',
            'Team not resolved', 'open', '2025-01-01T00:00:00.000Z')
  `).run('rq-ev-unk-2', EVENT_2012_ID, 'disc-ev-open-2012');
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: VIEWER_ID, slug: 'viewer-net-events', display_name: 'Viewer' });
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /net/events', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.status).toBe(200);
  });

  it('includes the evidence disclaimer', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).toContain('may not reflect official partnerships');
  });

  it('shows events that have net appearances', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).toContain('Net Worlds 2015');
    expect(res.text).toContain('Net Open 2012');
  });

  it('does NOT show events with no net appearances', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).not.toContain('No Net 2010');
  });

  it('orders events by start_date descending (2015 before 2012)', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    const pos2015 = res.text.indexOf('Net Worlds 2015');
    const pos2012 = res.text.indexOf('Net Open 2012');
    expect(pos2015).toBeGreaterThan(-1);
    expect(pos2012).toBeGreaterThan(-1);
    expect(pos2015).toBeLessThan(pos2012);
  });

  it('links to canonical /events/event_{year}_{slug} pages (public list does not expose internal QC route)', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).toContain('/events/event_2015_net_worlds');
    expect(res.text).toContain('/events/event_2012_net_open');
    // Public list never links to the internal QC reviewer view
    expect(res.text).not.toContain('/internal/net/events/');
  });

  it('shows multi-stage QC badge for ev2015', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).toContain('Multi-stage');
  });

  it('shows unknown_team excluded count for ev2012', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).toContain('2 unlinked');
  });

  it('does not show rankings, win/loss, or head-to-head stats', async () => {
    const app = createApp();
    const res = await request(app).get('/net/events');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('head-to-head');
    expect(lower).not.toContain('rating');
  });
});

// ---------------------------------------------------------------------------

describe('GET /internal/net/events/:eventId (QC reviewer view)', () => {
  it('returns 200 for a valid event', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown eventId', async () => {
    const app = createApp();
    const res = await internalGet(app, '/internal/net/events/not-a-real-event');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an event with no canonical net appearances', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2010_ID}`);
    expect(res.status).toBe(404);
  });

  it('shows the event title', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    expect(res.text).toContain('Net Worlds 2015');
  });

  it('includes the evidence disclaimer', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    expect(res.text).toContain('may not reflect official partnerships');
  });

  it('groups results by discipline', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    // Both disciplines at ev2015 should be present (raw names: no net_discipline_group mapping in test data)
    // Handlebars HTML-escapes apostrophes as &#x27; in double-curly expressions
    expect(res.text).toContain('Open Doubles Net');
    expect(res.text).toContain('Women&#x27;s Doubles Net');
  });

  it('shows player names with links', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    expect(res.text).toContain('Eve Alpha');
    expect(res.text).toContain('Eve Beta');
    expect(res.text).toContain(`/history/${PERSON_A}`);
    expect(res.text).toContain(`/history/${PERSON_B}`);
  });

  it('shows placement labels', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    expect(res.text).toContain('1st');
    expect(res.text).toContain('2nd');
  });

  it('shows multi-stage notice on ev2015', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    expect(res.text).toContain('Multi-stage results');
  });

  it('shows unknown_team excluded notice on ev2012', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2012_ID}`);
    expect(res.text).toContain('2 result(s) not shown');
  });

  it('renders raw discipline name when conflict_flag=1', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2012_ID}`);
    // disc2012_conflict has conflict_flag=1; raw name is 'Footbag Net: Mixed'
    expect(res.text).toContain('Footbag Net: Mixed');
  });

  it('does NOT show events with only inferred_partial appearances', async () => {
    // ev2008 has only one appearance for TEAM_AB and it is inferred_partial.
    // The canonical view filters it out, so ev2008 must not appear in the list.
    const app = createApp();
    const res = await request(app).get('/net/events');
    expect(res.text).not.toContain('Inferred Only 2008');
  });

  it('returns 404 for an event that exists but has only inferred_partial appearances', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2008_ID}`);
    expect(res.status).toBe(404);
  });

  it('does not show rankings, win/loss, or head-to-head stats', async () => {
    const app = createApp();
    const res = await internalGet(app, `/internal/net/events/${EVENT_2015_ID}`);
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('head-to-head');
  });
});
