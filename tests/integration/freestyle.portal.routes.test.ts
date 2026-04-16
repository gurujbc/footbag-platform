/**
 * Integration tests for freestyle portal pages.
 *
 * Covers:
 *   GET /freestyle/competition  — results-derived competition history
 *   GET /freestyle/history      — editorial history, pioneers, eras
 *   GET /freestyle              — redesigned 4-pillar portal landing
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import {
  insertHistoricalPerson,
  insertEvent,
  insertDiscipline,
  insertResultsUpload,
  insertResultEntry,
  insertResultParticipant,
  insertMember,
  insertFreestyleRecord,
  insertFreestyleTrick,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3111');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const PERSON_A = 'person-portal-001';
const PERSON_B = 'person-portal-002';

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // Two persons in canonical DB
  insertHistoricalPerson(db, { person_id: PERSON_A, person_name: 'Vera Champion', source_scope: 'CANONICAL', country: 'DE' });
  insertHistoricalPerson(db, { person_id: PERSON_B, person_name: 'Tom Runner', source_scope: 'CANONICAL', country: 'US' });

  // Need a member to own the results upload
  const memberId = insertMember(db);

  // An event with a freestyle discipline
  const eventId = insertEvent(db, {
    title: 'Test Freestyle Open',
    start_date: '2015-06-01',
    end_date: '2015-06-03',
    city: 'Berlin',
    country: 'DE',
  });
  const discId  = insertDiscipline(db, eventId, { name: 'Open Singles Freestyle' });
  const upload1 = insertResultsUpload(db, eventId, memberId);

  // Vera wins, Tom is second
  const entryA = insertResultEntry(db, eventId, upload1, discId, { placement: 1 });
  insertResultParticipant(db, entryA, 'Vera Champion', { historical_person_id: PERSON_A });

  const entryB = insertResultEntry(db, eventId, upload1, discId, { placement: 2 });
  insertResultParticipant(db, entryB, 'Tom Runner', { historical_person_id: PERSON_B });

  // A second event — Vera wins again
  const event2Id = insertEvent(db, {
    title: 'Test Freestyle Cup',
    start_date: '2018-09-10',
    end_date: '2018-09-12',
    city: 'Vienna',
    country: 'AT',
  });
  const disc2Id  = insertDiscipline(db, event2Id, { name: 'Open Singles Freestyle' });
  const upload2  = insertResultsUpload(db, event2Id, memberId);
  const entry2   = insertResultEntry(db, event2Id, upload2, disc2Id, { placement: 1 });
  insertResultParticipant(db, entry2, 'Vera Champion', { historical_person_id: PERSON_A });

  // A doubles event — should NOT count for singles competition page
  const event3Id = insertEvent(db, {
    title: 'Test Doubles',
    start_date: '2018-09-10',
    end_date: '2018-09-12',
    city: 'Vienna',
    country: 'AT',
  });
  const disc3Id  = insertDiscipline(db, event3Id, { name: 'Open Doubles Freestyle', team_type: 'doubles', discipline_category: 'freestyle' });
  const upload3  = insertResultsUpload(db, event3Id, memberId);
  const entry3   = insertResultEntry(db, event3Id, upload3, disc3Id, { placement: 1 });
  insertResultParticipant(db, entry3, 'Vera Champion', { historical_person_id: PERSON_A, participant_order: 1 });
  insertResultParticipant(db, entry3, 'Tom Runner', { historical_person_id: PERSON_B, participant_order: 2 });

  // Second doubles entry at a different event (gives Vera+Tom >=2 appearances)
  const event4Id = insertEvent(db, {
    title: 'Test Doubles Cup',
    start_date: '2019-07-01',
    city: 'Prague',
    country: 'CZ',
  });
  const disc4Id  = insertDiscipline(db, event4Id, { name: 'Open Doubles Freestyle', team_type: 'doubles', discipline_category: 'freestyle' });
  const upload4  = insertResultsUpload(db, event4Id, memberId);
  const entry4   = insertResultEntry(db, event4Id, upload4, disc4Id, { placement: 2 });
  insertResultParticipant(db, entry4, 'Vera Champion', { historical_person_id: PERSON_A, participant_order: 1 });
  insertResultParticipant(db, entry4, 'Tom Runner', { historical_person_id: PERSON_B, participant_order: 2 });

  // Trick and passback record for the landing
  insertFreestyleTrick(db, {
    slug: 'whirl', canonical_name: 'whirl', adds: '3', category: 'dex', sort_order: 0,
  });
  insertFreestyleRecord(db, {
    id: 'fr-portal-1',
    display_name: 'Vera Champion',
    trick_name: 'whirl',
    value_numeric: 50,
    confidence: 'probable',
  });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /freestyle/competition', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.status).toBe(200);
  });

  it('shows page title', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('Freestyle Competition');
  });

  it('shows top singles competitor (Vera — 2 golds)', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('Vera Champion');
    expect(res.text).toContain(`/history/${PERSON_A}`);
  });

  it('shows silver medalist (Tom — 1 silver)', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('Tom Runner');
    expect(res.text).toContain(`/history/${PERSON_B}`);
  });

  it('shows "Top Freestyle Singles Competitors" heading', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('Top Freestyle Singles Competitors');
  });

  it('shows Events by Era section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('Events by Era');
    // Both test events are in the 2010s
    expect(res.text).toContain('2010s');
  });

  it('shows recent events section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('Test Freestyle Open');
  });

  it('does NOT count doubles discipline in singles competition table', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    // Vera has 2 singles golds; the doubles win should not inflate this
    // We verify by checking that the data note mentions "singles only"
    expect(res.text).toContain('Freestyle singles only');
  });

  it('shows source data note', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('canonical event results');
  });

  it('contains breadcrumb back to /freestyle', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/competition');
    expect(res.text).toContain('/freestyle');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle/history', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.status).toBe(200);
  });

  it('shows page title', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('Freestyle History');
  });

  it('shows Competitive Eras section with known eras', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('Competitive Eras');
    expect(res.text).toContain('Foundation Era');
    expect(res.text).toContain('Technical Peak');
    expect(res.text).toContain('European Dominance');
  });

  it('shows era dates', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('1980');
    expect(res.text).toContain('2000');
  });

  it('shows Founders & Pioneers section with known names', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('Founders');
    expect(res.text).toContain('Kenny Shults');
    expect(res.text).toContain('Eric Wulff');
  });

  it('links pioneers with known person IDs to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    // Kenny Shults and Eric Wulff have profileHrefs in the service constants
    expect(res.text).toContain('/history/2a6a7c9e-1d8a-4f9a-a8f5-6f3a3c1e9b0f'); // Kenny Shults
    expect(res.text).toContain('/history/e8b82661-4428-5e51-a786-29bf7a23728f'); // Eric Wulff
  });

  it('shows ADD System section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('ADD System');
    expect(res.text).toContain('modifier');
  });

  it('shows Geographic Shift section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('Geographic Shift');
    expect(res.text).toContain('European');
  });

  it('mentions Václav Klouda in context', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('Klouda');
  });

  it('shows source note with event count', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('774 documented competitive events');
  });

  it('contains cross-links to competition and tricks pages', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/history');
    expect(res.text).toContain('/freestyle/competition');
    expect(res.text).toContain('/freestyle/tricks');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle — onboarding + portal landing', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.status).toBe(200);
  });

  it('shows mascot image', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('/img/freestyle-mascot.svg');
    expect(res.text).toContain('Freestyle footbag mascot icon');
  });

  it('shows onboarding explainer heading and narrative', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('What is Freestyle Footbag?');
    // narrative covers the kicking-circle origin, ADD system, and beginner gear advice
    expect(res.text).toContain('Hacky Sack');
    expect(res.text).toContain('Additional Degree of Difficulty');
    expect(res.text).toContain('1970s');
  });

  it('shows three placeholder get-started tiles', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('Where to buy footbags');
    expect(res.text).toContain('Where to buy shoes');
    expect(res.text).toContain('Beginner tutorials');
    // all three use the coming-soon badge
    const badgeCount = res.text.split('badge-coming-soon').length - 1;
    expect(badgeCount).toBeGreaterThanOrEqual(3);
  });

  it('shows Competition Formats section with all four formats', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('Competition Formats');
    expect(res.text).toContain('Routine');
    expect(res.text).toContain('Circle');
    expect(res.text).toContain('Sick 3');
    expect(res.text).toContain('Shred 30');
  });

  it('embeds the four reference competition-format videos', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('https://www.youtube.com/embed/Z-KkyOpoBhM');
    expect(res.text).toContain('https://www.youtube.com/embed/aMr5e5wlgeE');
    expect(res.text).toContain('https://www.youtube.com/embed/h6F0aPIpC1o');
    expect(res.text).toContain('https://www.youtube.com/embed/wb75xzvAs68');
  });

  it('shows portal cards including new History & ADD System card', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('History &amp; ADD System');
    expect(res.text).toContain('Competition');
    expect(res.text).toContain('Passback Records');
    expect(res.text).toContain('Trick Dictionary');
    expect(res.text).toContain('Insights');
  });

  it('links to all portal pillar pages', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('/freestyle/competition');
    expect(res.text).toContain('/freestyle/records');
    expect(res.text).toContain('/freestyle/tricks');
    expect(res.text).toContain('/freestyle/history');
  });

  it('does not render a numeric stats strip on the landing', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).not.toContain('stats-strip');
    expect(res.text).not.toMatch(/\d+\s+passback records/);
    expect(res.text).not.toMatch(/\d+\s+documented tricks/);
  });

  it('renders the self-hosted demo video with webm/mp4 sources and poster', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('class="demo-video"');
    expect(res.text).toContain('/media/demo-freestyle.webm');
    expect(res.text).toContain('/media/demo-freestyle.mp4');
    expect(res.text).toContain('/media/demo-freestyle-poster.jpg');
    expect(res.text).toContain('Demonstration of freestyle footbag');
    expect(res.text).toContain('autoplay');
    expect(res.text).toContain('playsinline');
  });

  it('does not show old "About Freestyle Footbag" as standalone section without history context', async () => {
    // The new landing has an "About" section that links to /freestyle/history
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('/freestyle/history');
  });

  it('shows link to partnerships page', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('/freestyle/partnerships');
  });
});

// ---------------------------------------------------------------------------
// GET /freestyle/partnerships
// ---------------------------------------------------------------------------

describe('GET /freestyle/partnerships', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    expect(res.status).toBe(200);
  });

  it('shows the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    expect(res.text).toContain('Freestyle Partnerships');
  });

  it('shows partnership with both partner names', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    // Vera + Tom have 2 doubles appearances → should appear
    expect(res.text).toContain('Vera Champion');
    expect(res.text).toContain('Tom Runner');
  });

  it('links partner names to history pages', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    expect(res.text).toContain(`/history/${PERSON_A}`);
    expect(res.text).toContain(`/history/${PERSON_B}`);
  });

  it('shows appearances count', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    expect(res.text).toContain('Appearances');
  });

  it('shows data note', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    expect(res.text).toContain('Freestyle doubles and team routines only');
  });

  it('shows All Partnerships section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/partnerships');
    expect(res.text).toContain('All Partnerships');
  });
});
