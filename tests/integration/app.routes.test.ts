/**
 * Integration tests for all public app routes.
 * Covers: health, home, clubs, hof, events (list/year/detail), login, logout,
 * auth redirects, members index, and members detail.
 *
 * Strategy: set FOOTBAG_DB_PATH to a temp file before any module import so
 * that db.ts opens the test database. beforeAll builds the schema and inserts
 * test data via factories. afterAll removes the temp DB and WAL sidecars.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import {
  insertMember,
  insertTag,
  insertEvent,
  insertDiscipline,
  insertResultsUpload,
  insertResultEntry,
  insertResultParticipant,
  insertHistoricalPerson,
} from '../fixtures/factories';

// ── Event keys (derived from tag_normalized, minus the leading #) ──────────────
const SPRING_CLASSIC_KEY = 'event_2026_spring_classic';
const BEAVER_OPEN_KEY    = 'event_2025_beaver_open';
const QUIET_OPEN_KEY     = 'event_2025_quiet_open';
const DRAFT_EVENT_KEY    = 'event_2026_draft_event';

// ── Person IDs for /members routes ────────────────────────────────────────────
const ALICE_ID = 'person-alice-001';
const BOB_ID   = 'person-bob-001';

const TEST_DB_PATH = path.join(process.cwd(), 'test-footbag.db');

// Set env vars BEFORE any module that reads them is imported.
process.env.FOOTBAG_DB_PATH  = TEST_DB_PATH;
process.env.PORT             = '3001';
process.env.NODE_ENV         = 'test';
process.env.LOG_LEVEL        = 'error';
process.env.PUBLIC_BASE_URL  = 'http://localhost:3001';
process.env.SESSION_SECRET   = 'test-secret-for-integration-tests';

// Dynamic import after env is set so db.ts picks up TEST_DB_PATH.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;
import { createSessionCookie } from '../../src/middleware/authStub';

const TEST_SESSION_SECRET = process.env.SESSION_SECRET!;
function validAuthCookie(): string {
  return `footbag_session=${createSessionCookie('test-user', 'admin', TEST_SESSION_SECRET)}`;
}

function buildTestDatabase(): void {
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'database', 'schema.sql'),
    'utf8',
  );

  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // FK stub: required by event_results_uploads
  const memberId = insertMember(db);

  // Historical persons for /members routes
  insertHistoricalPerson(db, {
    person_id:       ALICE_ID,
    person_name:     'Alice Footbag',
    country:         'US',
    event_count:     1,
    placement_count: 1,
  });
  insertHistoricalPerson(db, {
    person_id:       BOB_ID,
    person_name:     'Bob Hackysack',
    country:         'CA',
    event_count:     1,
    placement_count: 2,
  });

  // ── Upcoming published event (no results) ──────────────────────────────────
  const springTagId = insertTag(db, {
    tag_normalized: `#${SPRING_CLASSIC_KEY}`,
    tag_display:    '#Event_2026_Spring_Classic',
  });
  insertEvent(db, {
    hashtag_tag_id: springTagId,
    title:          '2026 Spring Classic',
    status:         'published',
    start_date:     '2026-06-15',
    end_date:       '2026-06-17',
    city:           'Portland',
    country:        'US',
  });

  // ── Completed event with results ───────────────────────────────────────────
  const beaverTagId = insertTag(db, {
    tag_normalized: `#${BEAVER_OPEN_KEY}`,
    tag_display:    '#Event_2025_Beaver_Open',
  });
  const beaverEventId = insertEvent(db, {
    hashtag_tag_id:        beaverTagId,
    title:                 '2025 Beaver Open',
    status:                'completed',
    start_date:            '2025-07-10',
    end_date:              '2025-07-12',
    city:                  'Corvallis',
    country:               'US',
    registration_status:   'closed',
  });
  const freestyleDiscId = insertDiscipline(db, beaverEventId, {
    name:                 'Freestyle',
    discipline_category:  'freestyle',
    sort_order:           1,
  });
  const shred30DiscId = insertDiscipline(db, beaverEventId, {
    name:                 'Shred30',
    discipline_category:  'freestyle',
    sort_order:           2,
  });
  const uploadId = insertResultsUpload(db, beaverEventId, memberId);

  // Freestyle: Alice #1, Bob #2
  const aliceFreestyleEntryId = insertResultEntry(db, beaverEventId, uploadId, freestyleDiscId, { placement: 1 });
  insertResultParticipant(db, aliceFreestyleEntryId, 'Alice Footbag', { participant_order: 1, historical_person_id: ALICE_ID });

  const bobFreestyleEntryId = insertResultEntry(db, beaverEventId, uploadId, freestyleDiscId, { placement: 2 });
  insertResultParticipant(db, bobFreestyleEntryId, 'Bob Hackysack', { participant_order: 1, historical_person_id: BOB_ID });

  // Shred30: Bob #1
  const bobShredEntryId = insertResultEntry(db, beaverEventId, uploadId, shred30DiscId, { placement: 1 });
  insertResultParticipant(db, bobShredEntryId, 'Bob Hackysack', { participant_order: 1, historical_person_id: BOB_ID });

  // ── Completed event without results ───────────────────────────────────────
  const quietTagId = insertTag(db, {
    tag_normalized: `#${QUIET_OPEN_KEY}`,
    tag_display:    '#Event_2025_Quiet_Open',
  });
  insertEvent(db, {
    hashtag_tag_id:      quietTagId,
    title:               '2025 Quiet Open',
    status:              'completed',
    start_date:          '2025-09-05',
    end_date:            '2025-09-07',
    city:                'Eugene',
    country:             'US',
    registration_status: 'closed',
  });

  // ── Draft event — must never appear publicly ───────────────────────────────
  const draftTagId = insertTag(db, {
    tag_normalized: `#${DRAFT_EVENT_KEY}`,
    tag_display:    '#Event_2026_Draft_Event',
  });
  insertEvent(db, {
    hashtag_tag_id: draftTagId,
    title:          '2026 Draft Event',
    status:         'draft',
    start_date:     '2026-08-01',
    end_date:       '2026-08-03',
  });

  db.close();
}

beforeAll(async () => {
  buildTestDatabase();
  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  for (const f of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

// ── Health routes ──────────────────────────────────────────────────────────────

describe('GET /health/live', () => {
  it('returns 200 with ok:true', async () => {
    const app = createApp();
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, check: 'live' });
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when database is reachable', async () => {
    const app = createApp();
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, check: 'ready' });
  });
});

// ── Events landing ─────────────────────────────────────────────────────────────

describe('GET /events', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
  });

  it('includes upcoming published event title', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).toContain('2026 Spring Classic');
  });

  it('includes upcoming event city', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).toContain('Portland');
  });

  it('includes archive year link for 2025 (completed events)', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).toContain('/events/year/2025');
  });

  it('does not expose draft events', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).not.toContain('2026 Draft Event');
  });

  it('does not show completed events in the upcoming section', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    // Completed events live in the archive, not upcoming
    expect(res.text).not.toContain('href="/events/event_2025_beaver_open"');
  });
});

// ── Events year archive ────────────────────────────────────────────────────────

describe('GET /events/year/:year', () => {
  it('returns 200 for a year with events', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/2025');
    expect(res.status).toBe(200);
  });

  it('shows all completed events for the requested year', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/2025');
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('2025 Quiet Open');
  });

  it('shows event city for year-archive events', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/2025');
    expect(res.text).toContain('Corvallis');
  });

  it('does not expose draft events in year archive', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/2026');
    expect(res.text).not.toContain('2026 Draft Event');
  });

  it('returns 200 for a valid year with no events (empty state)', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/1999');
    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-numeric year param', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/notayear');
    expect(res.status).toBe(404);
  });

  it('returns 404 for year 0 (out of valid range)', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/0');
    expect(res.status).toBe(404);
  });

  it('returns 404 for year 10000 (out of valid range)', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/10000');
    expect(res.status).toBe(404);
  });
});

// ── Single event page ──────────────────────────────────────────────────────────

describe('GET /events/:eventKey', () => {
  it('returns 200 for event with results', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.status).toBe(200);
  });

  it('shows event title on detail page', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.text).toContain('2025 Beaver Open');
  });

  it('shows event city on detail page', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.text).toContain('Corvallis');
  });

  it('shows discipline name on detail page', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.text).toContain('Freestyle');
  });

  it('shows result placements and participant names', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.text).toContain('Alice Footbag');
    expect(res.text).toContain('Bob Hackysack');
  });

  it('shows multiple disciplines when event has them', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.text).toContain('Freestyle');
    expect(res.text).toContain('Shred30');
  });

  it('returns 200 for event without results and shows no-results message', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${QUIET_OPEN_KEY}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('2025 Quiet Open');
    expect(res.text).toContain('Results are not yet available');
  });

  it('returns 200 for upcoming published event', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${SPRING_CLASSIC_KEY}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('2026 Spring Classic');
  });

  it('upcoming event shows no-results message', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${SPRING_CLASSIC_KEY}`);
    expect(res.text).toContain('Results are not yet available');
  });

  it('returns 404 for a draft event', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${DRAFT_EVENT_KEY}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-existent event key', async () => {
    const app = createApp();
    const res = await request(app).get('/events/event_9999_does_not_exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an invalid key format (no event_ prefix)', async () => {
    const app = createApp();
    const res = await request(app).get('/events/not-a-valid-key');
    expect(res.status).toBe(404);
  });

  it('does not route /events/year/2025 as an eventKey', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/2025');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2025');
  });
});

// ── Home page ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('features an upcoming published event', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('2026 Spring Classic');
  });

  it('does not expose draft events', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).not.toContain('2026 Draft Event');
  });

  it('includes navigation links to events, clubs, and hof', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('href="/events"');
    expect(res.text).toContain('href="/clubs"');
    expect(res.text).toContain('href="/hof"');
  });
});

// ── Clubs placeholder ──────────────────────────────────────────────────────────

describe('GET /clubs', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.status).toBe(200);
  });

  it('includes coming soon content', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).toContain('coming soon');
  });

  it('includes navigation links to home and events', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).toContain('href="/"');
    expect(res.text).toContain('href="/events"');
  });
});

// ── HoF landing ────────────────────────────────────────────────────────────────

describe('GET /hof', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.status).toBe(200);
  });

  it('includes Hall of Fame heading', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('Hall of Fame');
  });

  it('includes coming-soon notice for inductee profiles', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('coming soon');
  });

  it('includes HoF nav link', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('href="/hof"');
  });

  it('includes navigation links to home and events', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('href="/"');
    expect(res.text).toContain('href="/events"');
  });

  it('renders all editorial content sections', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('A Bit of History');
    expect(res.text).toContain('The Mike Marshall Award');
    expect(res.text).toContain('Inductees');
  });
});

// ── Auth: login page ───────────────────────────────────────────────────────────

describe('GET /login', () => {
  it('returns 200 with login form for unauthenticated visitor', async () => {
    const app = createApp();
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<form');
    expect(res.text).toContain('name="username"');
    expect(res.text).toContain('name="password"');
  });

  it('redirects authenticated visitor to /members', async () => {
    const app = createApp();
    const res = await request(app).get('/login').set('Cookie', validAuthCookie());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members');
  });
});

// ── Auth: POST /login ──────────────────────────────────────────────────────────

describe('POST /login', () => {
  it('redirects to /members and sets session cookie on valid credentials', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send('username=footbag&password=Footbag!')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members');
    const cookies: string[] = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie']
      : [res.headers['set-cookie']];
    expect(cookies.some((c: string) => c.startsWith('footbag_session='))).toBe(true);
  });

  it('returns 200 with error message on wrong password', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send('username=footbag&password=wrongpassword')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid username or password');
  });

  it('returns 200 with error message on unknown username', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send('username=nobody&password=Footbag!')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid username or password');
  });
});

// ── Auth: POST /logout ─────────────────────────────────────────────────────────

describe('POST /logout', () => {
  it('clears the session cookie and redirects to /', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/logout')
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookies: string[] = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie']
      : [res.headers['set-cookie'] ?? ''];
    const sessionCookie = cookies.find((c: string) => c.startsWith('footbag_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

// ── Members: index ─────────────────────────────────────────────────────────────

describe('GET /members', () => {
  it('redirects unauthenticated visitor to /login', async () => {
    const app = createApp();
    const res = await request(app).get('/members');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('returns 200 for authenticated visitor', async () => {
    const app = createApp();
    const res = await request(app).get('/members').set('Cookie', validAuthCookie());
    expect(res.status).toBe(200);
  });

  it('lists all members by name', async () => {
    const app = createApp();
    const res = await request(app).get('/members').set('Cookie', validAuthCookie());
    expect(res.text).toContain('Alice Footbag');
    expect(res.text).toContain('Bob Hackysack');
  });

  it('includes links to individual member detail pages', async () => {
    const app = createApp();
    const res = await request(app).get('/members').set('Cookie', validAuthCookie());
    expect(res.text).toContain(`href="/members/${ALICE_ID}"`);
    expect(res.text).toContain(`href="/members/${BOB_ID}"`);
  });

  it('rejects a tampered session cookie with a redirect to /login', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members')
      .set('Cookie', 'footbag_session=invalidsignature.tampered');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

// ── Members: detail page ──────────────────────────────────────────────────────

describe('GET /members/:personId', () => {
  it('redirects unauthenticated visitor to /login', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${ALICE_ID}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('returns 200 for authenticated visitor viewing existing member', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${ALICE_ID}`)
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(200);
  });

  it('shows member name on detail page', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${ALICE_ID}`)
      .set('Cookie', validAuthCookie());
    expect(res.text).toContain('Alice Footbag');
  });

  it('shows member country on detail page', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${ALICE_ID}`)
      .set('Cookie', validAuthCookie());
    expect(res.text).toContain('US');
  });

  it("shows Alice's event result at 2025 Beaver Open", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${ALICE_ID}`)
      .set('Cookie', validAuthCookie());
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('Freestyle');
  });

  it("shows Bob's multiple results including Shred30 win", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${BOB_ID}`)
      .set('Cookie', validAuthCookie());
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('Freestyle');
    expect(res.text).toContain('Shred30');
  });

  it('returns 404 for authenticated visitor viewing non-existent member', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members/person-does-not-exist')
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(404);
  });
});
