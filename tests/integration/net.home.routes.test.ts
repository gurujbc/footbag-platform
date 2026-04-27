/**
 * Integration tests for the net landing page.
 *
 * Covers:
 *   GET /net — footbag net portal landing page
 *
 * Verifies:
 *   - 200 response
 *   - Hero with mascot + "What is Footbag Net?" narrative
 *   - Demo video (self-hosted webm/mp4) renders in intro section
 *   - Competition Formats cards (Singles + Doubles) with YouTube embeds
 *   - Explore cards link to real sub-routes (/net/teams, /net/events)
 *   - No stats on the landing: no team/player/event tables
 *   - No forbidden terms: "ranking", "head-to-head", "win/loss"
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

  it('shows Explore cards linking to existing net sub-routes', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Teams');
    expect(res.text).toContain('Events');
    expect(res.text).toContain('href="/net/teams"');
    expect(res.text).toContain('href="/net/events"');
  });

  it('does not show rankings, win/loss, or head-to-head stats', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    const lower = res.text.toLowerCase();
    expect(lower).not.toContain('win/loss');
    expect(lower).not.toContain('ranking');
    expect(lower).not.toContain('head-to-head');
  });

  it('does not render notable team, notable player, or recent event tables', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).not.toContain('Most Wins');
    expect(res.text).not.toContain('Longest Spans');
    expect(res.text).not.toContain('Most Podium Finishes');
    expect(res.text).not.toContain('Longest Active Spans');
    expect(res.text).not.toContain('Most Partner Connections');
    expect(res.text).not.toContain('Recent Events');
    expect(res.text).not.toContain('records-table-wrap');
  });
});

// ---------------------------------------------------------------------------
// Portal landing sections: hero, explainer, demo video, competition formats
// ---------------------------------------------------------------------------

describe('GET /net — portal landing sections', () => {
  it('renders hero with Footbag Net title', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Footbag Net');
  });

  it('renders the net mascot image', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('src="/img/net-mascot.svg"');
    expect(res.text).toContain('hero-with-mascot');
  });

  it('renders the "What is Footbag Net?" explainer', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('What is Footbag Net?');
  });

  it('renders the self-hosted demo video with webm/mp4 sources and poster', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('class="demo-video"');
    expect(res.text).toContain('/media/demo-net.webm');
    expect(res.text).toContain('/media/demo-net.mp4');
    expect(res.text).toContain('/media/demo-net-poster.jpg');
    expect(res.text).toContain('Demonstration of footbag net');
    expect(res.text).toContain('autoplay');
    expect(res.text).toContain('playsinline');
  });

  it('renders Competition Formats with Singles and Doubles cards', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('Competition Formats');
    expect(res.text).toContain('>Singles<');
    expect(res.text).toContain('>Doubles<');
  });

  it('embeds YouTube videos in competition-format cards', async () => {
    const app = createApp();
    const res = await request(app).get('/net');
    expect(res.text).toContain('https://www.youtube-nocookie.com/embed/Rep-1rQbX-o');
    expect(res.text).toContain('https://www.youtube-nocookie.com/embed/lcDP3JGvkP0');
    // Iframe src must satisfy CSP frame-src (youtube-nocookie.com only).
    expect(res.text).not.toMatch(/src="https:\/\/www\.youtube\.com\/embed\//);
  });
});
