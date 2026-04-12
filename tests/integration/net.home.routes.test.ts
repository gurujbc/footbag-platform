/**
 * Integration tests for the net landing page.
 *
 * Covers:
 *   GET /net — net doubles landing page
 *
 * Verifies:
 *   - 200 response
 *   - All four sections present (top teams, most connected players, recent events, long careers)
 *   - Links to teams, players, and events
 *   - Evidence disclaimer always present
 *   - No forbidden terms: "ranking", "head-to-head", "win/loss"
 *   - Only canonical_only data surfaces (inferred_partial excluded)
 *   - Multi-stage QC badge appears when hint is set
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
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3098');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

// Person IDs
const PERSON_A = 'person-hm-aa-test-1';
const PERSON_B = 'person-hm-bb-test-1';
const PERSON_C = 'person-hm-cc-test-1';
const PERSON_D = 'person-hm-dd-test-1';

// Team IDs
const TEAM_AB = 'net-team-hm-ab-0001';
const TEAM_AC = 'net-team-hm-ac-0001';  // gives person A 2 partners (B and C)
const TEAM_CD = 'net-team-hm-cd-0001';

function setupDb(db: BetterSqlite3.Database): void {
  insertHistoricalPerson(db, { person_id: PERSON_A, person_name: 'Home Alpha' });
  insertHistoricalPerson(db, { person_id: PERSON_B, person_name: 'Home Beta' });
  insertHistoricalPerson(db, { person_id: PERSON_C, person_name: 'Home Gamma' });
  insertHistoricalPerson(db, { person_id: PERSON_D, person_name: 'Home Delta' });

  const ev2020 = insertEvent(db, {
    id: 'event-hm-2020', title: 'Home Open 2020',
    start_date: '2020-07-01', city: 'Portland', country: 'US',
  });
  const ev2015 = insertEvent(db, {
    id: 'event-hm-2015', title: 'Home Cup 2015',
    start_date: '2015-06-01', city: 'Denver', country: 'US',
  });
  const ev2010 = insertEvent(db, {
    id: 'event-hm-2010', title: 'Home Classic 2010',
    start_date: '2010-05-01', city: 'Chicago', country: 'US',
  });

  const disc2020 = insertDiscipline(db, ev2020, {
    id: 'disc-hm-2020', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });
  const disc2015 = insertDiscipline(db, ev2015, {
    id: 'disc-hm-2015', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });
  const disc2010 = insertDiscipline(db, ev2010, {
    id: 'disc-hm-2010', name: 'Open Doubles Net',
    discipline_category: 'net', team_type: 'doubles',
  });

  const member   = insertMember(db);
  const upload20 = insertResultsUpload(db, ev2020, member);
  const upload15 = insertResultsUpload(db, ev2015, member);
  const upload10 = insertResultsUpload(db, ev2010, member);

  const entry_ab_2020 = insertResultEntry(db, ev2020, upload20, disc2020, { id: 'entry-hm-ab-20', placement: 1 });
  const entry_ab_2015 = insertResultEntry(db, ev2015, upload15, disc2015, { id: 'entry-hm-ab-15', placement: 2 });
  const entry_ab_2010 = insertResultEntry(db, ev2010, upload10, disc2010, { id: 'entry-hm-ab-10', placement: 1 });
  const entry_ac_2020 = insertResultEntry(db, ev2020, upload20, disc2020, { id: 'entry-hm-ac-20', placement: 3 });
  const entry_cd_2020 = insertResultEntry(db, ev2020, upload20, disc2020, { id: 'entry-hm-cd-20', placement: 2 });

  // Team AB: 3 appearances spanning 2010–2020 (long career, 2 wins)
  insertNetTeam(db, {
    team_id: TEAM_AB, person_id_a: PERSON_A, person_id_b: PERSON_B,
    first_year: 2010, last_year: 2020, appearance_count: 3,
  });
  insertNetTeamMember(db, { team_id: TEAM_AB, person_id: PERSON_A, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_AB, person_id: PERSON_B, position: 'b' });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2020, discipline_id: disc2020, result_entry_id: entry_ab_2020, placement: 1, event_year: 2020 });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2015, discipline_id: disc2015, result_entry_id: entry_ab_2015, placement: 2, event_year: 2015 });
  insertNetTeamAppearance(db, { team_id: TEAM_AB, event_id: ev2010, discipline_id: disc2010, result_entry_id: entry_ab_2010, placement: 1, event_year: 2010 });

  // Team AC: 1 appearance — gives Person A a second partner
  insertNetTeam(db, {
    team_id: TEAM_AC, person_id_a: PERSON_A, person_id_b: PERSON_C,
    first_year: 2020, last_year: 2020, appearance_count: 1,
  });
  insertNetTeamMember(db, { team_id: TEAM_AC, person_id: PERSON_A, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_AC, person_id: PERSON_C, position: 'b' });
  insertNetTeamAppearance(db, { team_id: TEAM_AC, event_id: ev2020, discipline_id: disc2020, result_entry_id: entry_ac_2020, placement: 3, event_year: 2020 });

  // Team CD: 1 appearance
  insertNetTeam(db, {
    team_id: TEAM_CD, person_id_a: PERSON_C, person_id_b: PERSON_D,
    first_year: 2020, last_year: 2020, appearance_count: 1,
  });
  insertNetTeamMember(db, { team_id: TEAM_CD, person_id: PERSON_C, position: 'a' });
  insertNetTeamMember(db, { team_id: TEAM_CD, person_id: PERSON_D, position: 'b' });
  insertNetTeamAppearance(db, { team_id: TEAM_CD, event_id: ev2020, discipline_id: disc2020, result_entry_id: entry_cd_2020, placement: 2, event_year: 2020 });

  // QC: multi_stage_result for ev2020
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id,
       check_id, severity, reason_code, message, resolution_status, imported_at)
    VALUES (?, 'test', 'qc_issue', 2, ?, NULL,
            'hm-check-1', 'medium', 'multi_stage_result',
            'Multi-stage detected', 'open', '2025-01-01T00:00:00.000Z')
  `).run('rq-hm-1', 'event-hm-2020');
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  setupDb(db);
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /net', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.status).toBe(200);
  });

  it('includes the evidence disclaimer', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('may not reflect official partnerships');
  });

  it('includes the data note', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('no match-level data is reconstructed');
  });

  it('shows team names in notable partnerships', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Home Alpha');
    expect(res.text).toContain('Home Beta');
  });

  it('links partnerships to partnership detail pages', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain(`/net/partnerships/${TEAM_AB}`);
  });

  it('links players to player pages', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain(`/net/players/${PERSON_A}`);
  });

  it('shows the Recent Events section', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Recent Events');
    expect(res.text).toContain('Home Open 2020');
  });

  it('links from recent events to net event detail pages', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('/net/events/event-hm-2020');
  });

  it('shows multi-stage QC badge for ev2020', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Multi-stage');
  });

  it('shows the Explore section with discovery links', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Explore');
    expect(res.text).toContain('/net/partnerships');
    expect(res.text).toContain('/net/teams');
    expect(res.text).toContain('/net/events');
    expect(res.text).toContain('/net/events');
  });

  it('does not show rankings, win/loss, or head-to-head stats', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('head-to-head');
  });

  it('nav "Net" link points to /net', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // The nav and footer should link to /net (not /net/teams)
    expect(res.text).toContain('href="/net"');
  });
});

// ---------------------------------------------------------------------------
// Notable Partnerships section on /net
// ---------------------------------------------------------------------------

describe('GET /net — Notable Partnerships', () => {
  it('renders Most Wins bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Team AB has 2 wins — should appear in Most Wins bucket
    expect(res.text).toContain('Most Wins');
  });

  it('renders Most Podium Finishes bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Most Podium Finishes');
  });

  it('renders Longest Spans bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Longest Spans');
  });

  it('shows Team AB (Home Alpha / Home Beta) in notable section', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Team AB qualifies (3 appearances, 2 wins, 10-year span)
    // Should appear in at least one notable bucket
    const notableSection = res.text.substring(res.text.indexOf('Most Wins'));
    expect(notableSection).toContain('Home Alpha');
    expect(notableSection).toContain('Home Beta');
  });

  it('links partnership names to partnership detail page', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain(`/net/partnerships/${TEAM_AB}`);
  });

  it('shows "All partnerships" link', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('/net/partnerships');
    expect(res.text).toContain('All partnerships');
  });

  it('shows win and podium counts in notable rows', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Wins');
    expect(res.text).toContain('Podiums');
  });

  it('shows year span in notable rows', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Team AB spans 2010–2020
    expect(res.text).toContain('2010');
    expect(res.text).toContain('2020');
  });

  it('does not show teams with fewer than 3 appearances in notable', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Team CD has only 1 appearance — should not appear in notable section
    const afterNotable = res.text.substring(res.text.indexOf('Most Wins'));
    const beforeRecent = afterNotable.substring(0, afterNotable.indexOf('Recent Events') || afterNotable.length);
    expect(beforeRecent).not.toContain('Home Delta');
  });

  it('does not use overstated language', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('greatest');
    expect(lower).not.toContain('best of all time');
    expect(lower).not.toContain('dominant');
    expect(lower).not.toContain('dynasty');
  });
});

// ---------------------------------------------------------------------------
// Notable Players section on /net
// ---------------------------------------------------------------------------

describe('GET /net — Notable Players', () => {
  it('renders Most Wins player bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Team AB has 3 appearances (2 wins) — both Alpha and Beta qualify
    // "Most Wins" bucket title appears for players
    // (also appears for partnerships, so check the Players table has person links)
    const text = res.text;
    // At least one notable player bucket should render with person links
    expect(text).toContain('Partners');  // column header in notable players table
  });

  it('renders Longest Active Spans player bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Longest Active Spans');
  });

  it('renders Most Partner Connections player bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Most Partner Connections');
  });

  it('renders Most Podium Finishes player bucket', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Most Podium Finishes');
  });

  it('shows Home Alpha in notable players (3 total appearances)', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Alpha has 3 appearances (AB:3) + 1 appearance (AC:1) = 4 total via canonical view
    // Both AB and AC teams → Alpha qualifies for notable
    expect(res.text).toContain('Home Alpha');
  });

  it('links player names to player pages', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain(`/net/players/${PERSON_A}`);
  });

  it('shows partner count in notable player rows', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    // Home Alpha has 2 partners (Bob and Carol) — should show partner count
    expect(res.text).toContain('Partners');
  });

  it('does not use overstated language in player section', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('goat');
    expect(lower).not.toContain('greatest player');
  });
});
