/**
 * Integration tests for public net team routes.
 *
 * Covers:
 *   GET /net/teams              — team list
 *   GET /net/teams/:teamId      — team detail
 *
 * Verifies:
 *   - 200 for valid routes, 404 for unknown teamId
 *   - Evidence disclaimer always present
 *   - Teams ordered by appearance_count DESC
 *   - Team name and partner names visible
 *   - Year grouping on detail page
 *   - conflict_flag=1 renders raw discipline name instead of canonical group label
 *   - Appearances with evidence_class != 'canonical_only' do NOT appear
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
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3095');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

// IDs used across tests
const TEAM_1_ID = 'net-team-test-0001';
const TEAM_2_ID = 'net-team-test-0002';
const PERSON_A1 = 'person-net-aa-test-1';   // a < b lexicographically
const PERSON_B1 = 'person-net-bb-test-1';
const PERSON_A2 = 'person-net-aa-test-2';
const PERSON_B2 = 'person-net-bb-test-2';

function setupDb(db: BetterSqlite3.Database): void {
  // Historical persons for team 1 (2 appearances) and team 2 (1 appearance)
  insertHistoricalPerson(db, { person_id: PERSON_A1, person_name: 'Alice Net' });
  insertHistoricalPerson(db, { person_id: PERSON_B1, person_name: 'Bob Net' });
  insertHistoricalPerson(db, { person_id: PERSON_A2, person_name: 'Carol Net' });
  insertHistoricalPerson(db, { person_id: PERSON_B2, person_name: 'Dave Net' });

  // Events — each has an explicit canonical-pattern tag_normalized so that
  // href assertions can verify the canonical /events/event_{year}_{slug} shape.
  const tag1 = insertTag(db, { tag_normalized: '#event_2010_net_open' });
  const tag2 = insertTag(db, { tag_normalized: '#event_2015_net_open' });
  const tag3 = insertTag(db, { tag_normalized: '#event_2012_european_net' });
  const event1 = insertEvent(db, { id: 'event-net-test-2010', hashtag_tag_id: tag1, title: 'Net Open 2010',      start_date: '2010-07-01', city: 'Chicago', country: 'US' });
  const event2 = insertEvent(db, { id: 'event-net-test-2015', hashtag_tag_id: tag2, title: 'Net Open 2015',      start_date: '2015-07-01', city: 'Denver',  country: 'US' });
  const event3 = insertEvent(db, { id: 'event-net-test-2012', hashtag_tag_id: tag3, title: 'European Net 2012',  start_date: '2012-06-01', city: 'Berlin',  country: 'DE' });

  // Disciplines
  const disc1 = insertDiscipline(db, event1, { id: 'disc-net-test-open-2010', name: 'Open Doubles Net', discipline_category: 'net', team_type: 'doubles' });
  const disc2 = insertDiscipline(db, event2, { id: 'disc-net-test-open-2015', name: 'Open Doubles Net', discipline_category: 'net', team_type: 'doubles' });
  const disc3 = insertDiscipline(db, event3, { id: 'disc-net-test-conflict-2012', name: 'Footbag Net: Singles', discipline_category: 'net', team_type: 'doubles' });

  // net_discipline_group entries for division filter tests
  db.prepare(`
    INSERT INTO net_discipline_group
      (discipline_id, canonical_group, match_method, review_needed, conflict_flag, mapped_at, mapped_by)
    VALUES (?, 'open_doubles', 'exact', 0, 0, '2025-01-01T00:00:00.000Z', 'test')
  `).run('disc-net-test-open-2010');
  db.prepare(`
    INSERT INTO net_discipline_group
      (discipline_id, canonical_group, match_method, review_needed, conflict_flag, mapped_at, mapped_by)
    VALUES (?, 'open_doubles', 'exact', 0, 0, '2025-01-01T00:00:00.000Z', 'test')
  `).run('disc-net-test-open-2015');
  // conflict_flag test (disc3)
  db.prepare(`
    INSERT INTO net_discipline_group
      (discipline_id, canonical_group, match_method, review_needed, conflict_flag, mapped_at, mapped_by)
    VALUES (?, 'uncategorized', 'pattern', 1, 1, '2025-01-01T00:00:00.000Z', 'test')
  `).run('disc-net-test-conflict-2012');

  // Need result_entries for FK in net_team_appearance
  // Use a member + upload to satisfy the FK chain (results_upload_id is nullable, pass null directly)
  const member = insertMember(db);
  const upload1 = insertResultsUpload(db, event1, member);
  const upload2 = insertResultsUpload(db, event2, member);
  const upload3 = insertResultsUpload(db, event3, member);

  const entry1 = insertResultEntry(db, event1, upload1, disc1, { id: 'entry-net-test-01', placement: 1 });
  const entry2 = insertResultEntry(db, event2, upload2, disc2, { id: 'entry-net-test-02', placement: 2 });
  insertResultEntry(db, event1, upload1, disc1, { id: 'entry-net-test-03', placement: 3 });
  const entry4 = insertResultEntry(db, event3, upload3, disc3, { id: 'entry-net-test-04', placement: 1 });
  // Entry for inferred_partial test (team 1 at event 3 — should be hidden)
  const entry5 = insertResultEntry(db, event3, upload3, disc3, { id: 'entry-net-test-05', placement: 2 });

  // Team 1: Alice + Bob — 2 canonical_only appearances + 1 inferred_partial (should be hidden)
  insertNetTeam(db, {
    team_id:          TEAM_1_ID,
    person_id_a:      PERSON_A1,
    person_id_b:      PERSON_B1,
    first_year:       2010,
    last_year:        2015,
    appearance_count: 2,
  });
  insertNetTeamMember(db, { team_id: TEAM_1_ID, person_id: PERSON_A1, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_1_ID, person_id: PERSON_B1, position: 'b' });

  insertNetTeamAppearance(db, { team_id: TEAM_1_ID, event_id: event1, discipline_id: disc1, result_entry_id: entry1, placement: 1, event_year: 2010 });
  insertNetTeamAppearance(db, { team_id: TEAM_1_ID, event_id: event2, discipline_id: disc2, result_entry_id: entry2, placement: 2, event_year: 2015 });
  // inferred_partial appearance — must NOT appear in public output
  insertNetTeamAppearance(db, { team_id: TEAM_1_ID, event_id: event3, discipline_id: disc3, result_entry_id: entry5, placement: 2, event_year: 2012, evidence_class: 'inferred_partial' });

  // Team 2: Carol + Dave — 1 canonical_only appearance (conflict_flag=1 discipline)
  insertNetTeam(db, {
    team_id:          TEAM_2_ID,
    person_id_a:      PERSON_A2,
    person_id_b:      PERSON_B2,
    first_year:       2012,
    last_year:        2012,
    appearance_count: 1,
  });
  insertNetTeamMember(db, { team_id: TEAM_2_ID, person_id: PERSON_A2, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_2_ID, person_id: PERSON_B2, position: 'b' });

  insertNetTeamAppearance(db, { team_id: TEAM_2_ID, event_id: event3, discipline_id: disc3, result_entry_id: entry4, placement: 1, event_year: 2012 });
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------
// GET /net/teams
// ---------------------------------------------------------------------------

describe('GET /net/teams', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('Net Teams');
  });

  it('includes the evidence disclaimer', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('algorithmically constructed');
  });

  it('shows both teams (Alice/Bob and Carol/Dave)', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('Alice Net');
    expect(res.text).toContain('Bob Net');
    expect(res.text).toContain('Carol Net');
    expect(res.text).toContain('Dave Net');
  });

  it('orders teams by appearance_count descending (team1 before team2)', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    const posTeam1 = res.text.indexOf('Alice Net');
    const posTeam2 = res.text.indexOf('Carol Net');
    expect(posTeam1).toBeGreaterThan(-1);
    expect(posTeam2).toBeGreaterThan(-1);
    expect(posTeam1).toBeLessThan(posTeam2);
  });

  it('shows win and podium columns', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('Wins');
    expect(res.text).toContain('Podiums');
  });

  it('shows year span for multi-year teams', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    // Team 1: first_year=2010, last_year=2015
    expect(res.text).toContain('2010');
    expect(res.text).toContain('2015');
  });

  it('links team rows to the canonical team detail at /net/teams/:teamId', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain(`/net/teams/${TEAM_1_ID}`);
  });

  it('does not include inferred_partial appearances in counts', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    // Team 1 has 2 canonical + 1 inferred_partial. Only 2 should count.
    expect(res.text).toContain('Alice Net');
    const matches = res.text.match(/<td class="col-num">(\d+)<\/td>/g) || [];
    // First col-num in the row = appearance count = 2
    expect(matches[0]).toContain('2');
  });

  it('shows total teams count', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('2 teams shown');
  });

  it('shows division filter dropdown', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('name="division"');
    expect(res.text).toContain('All divisions');
  });

  it('shows open_doubles in division options', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    expect(res.text).toContain('open_doubles');
  });

  it('does not contain forbidden stat language', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('head-to-head');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('rating');
  });
});

describe('GET /net/teams?division=open_doubles', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=open_doubles');
    expect(res.status).toBe(200);
  });

  it('shows division in page title', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=open_doubles');
    expect(res.text).toContain('Open Doubles');
  });

  it('shows team 1 (which plays in open doubles)', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=open_doubles');
    expect(res.text).toContain('Alice Net');
  });

  it('marks the selected division as selected in dropdown', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=open_doubles');
    expect(res.text).toContain('value="open_doubles" selected');
  });

  it('shows clear filter link when division is active', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=open_doubles');
    expect(res.text).toContain('Clear');
  });

  it('returns empty for a division with no teams', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=masters_doubles');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No teams found');
  });

  it('ignores unknown division values gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=not_real');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No teams found');
  });
});

describe('GET /net/teams?q=Alice', () => {
  it('returns 200 and shows matching team', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?q=Alice');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alice Net');
  });

  it('does not show non-matching teams', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?q=Nonexistent');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No teams found');
  });

  it('shows search input with current value', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?q=Alice');
    expect(res.text).toContain('value="Alice"');
  });

  it('ignores search queries shorter than 2 characters', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?q=A');
    expect(res.status).toBe(200);
    // Short query ignored → shows default results
    expect(res.text).toContain('Alice Net');
  });

  it('combines division and search filters', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams?division=open_doubles&q=Alice');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alice Net');
  });
});

// ---------------------------------------------------------------------------
// GET /net/teams/:teamId
// ---------------------------------------------------------------------------

describe('GET /net/teams/:teamId', () => {
  it('returns 200 for valid team', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.status).toBe(200);
  });

  it('shows both partner names in title', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain('Alice Net');
    expect(res.text).toContain('Bob Net');
  });

  it('shows summary stats', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    // Team 1: 2 canonical appearances (placement 1 + placement 2)
    expect(res.text).toContain('2 appearances');
    expect(res.text).toContain('1 wins');
    expect(res.text).toContain('2 podiums');
  });

  it('shows competitive timeline', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain('Competitive Timeline');
    expect(res.text).toContain('Net Open 2010');
    expect(res.text).toContain('Net Open 2015');
  });

  it('orders timeline by year ascending', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    const idx2010 = res.text.indexOf('Net Open 2010');
    const idx2015 = res.text.indexOf('Net Open 2015');
    expect(idx2010).toBeGreaterThan(0);
    expect(idx2015).toBeGreaterThan(idx2010);
  });

  it('renders a Competition History section grouped by year, descending', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain('Competition History');
    const pos2015 = res.text.indexOf('year-heading">2015');
    const pos2010 = res.text.indexOf('year-heading">2010');
    expect(pos2015).toBeGreaterThan(-1);
    expect(pos2010).toBeGreaterThan(-1);
    expect(pos2015).toBeLessThan(pos2010);
  });

  it('renders raw discipline name when conflict_flag=1', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_2_ID}`);
    // disc3 has conflict_flag=1; raw name is 'Footbag Net: Singles'
    expect(res.text).toContain('Footbag Net: Singles');
  });

  it('shows placement labels (1st, 2nd)', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain('1st');
    expect(res.text).toContain('2nd');
  });

  it('links event names to canonical /events/event_{year}_{slug} pages', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toMatch(/\/events\/event_\d{4}_[a-z0-9_]+/);
    expect(res.text).toContain('/events/event_2010_net_open');
    expect(res.text).toContain('/events/event_2015_net_open');
  });

  it('links player names to history pages via personHref', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain(`/history/${PERSON_A1}`);
    expect(res.text).toContain(`/history/${PERSON_B1}`);
  });

  it('includes evidence disclaimer', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain('algorithmically constructed');
  });

  it('excludes inferred_partial appearances from timeline and summary', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    // Team 1 has 2 canonical + 1 inferred_partial. Should show 2 appearances.
    expect(res.text).toContain('2 appearances');
    // European Net 2012 was the inferred_partial event — should NOT appear
    expect(res.text).not.toContain('European Net 2012');
  });

  it('returns 404 for unknown team', async () => {
    const app = createApp();
    const res = await request(app).get('/net/teams/not-a-real-team');
    expect(res.status).toBe(404);
  });

  it('shows breadcrumb back to teams list', async () => {
    const app = createApp();
    const res = await request(app).get(`/net/teams/${TEAM_1_ID}`);
    expect(res.text).toContain('/net/teams');
    expect(res.text).toContain('Teams');
  });
});
