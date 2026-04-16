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
import argon2 from 'argon2';
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
  insertClub,
} from '../fixtures/factories';

// ── Event keys (derived from tag_normalized, minus the leading #) ──────────────
const SPRING_CLASSIC_KEY = 'event_2026_spring_classic';
const BEAVER_OPEN_KEY    = 'event_2025_beaver_open';
const QUIET_OPEN_KEY     = 'event_2025_quiet_open';
const DRAFT_EVENT_KEY    = 'event_2026_draft_event';

// ── Person IDs for /history routes ───────────────────────────────────────────
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

async function buildTestDatabase(): Promise<void> {
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'database', 'schema.sql'),
    'utf8',
  );

  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // Footbag Hacky: test member with login_email='footbag' (non-email identifier).
  // Password comes from STUB_PASSWORD env var; hashed at test-setup time, never stored in git.
  const footbagHash = await argon2.hash(process.env.STUB_PASSWORD ?? 'Footbag!');
  insertMember(db, {
    id:                'member-footbag-hacky',
    slug:              'footbag_hacky',
    login_email:       'footbag',
    display_name:      'Footbag Hacky',
    password_hash:     footbagHash,
    email_verified_at: '2025-01-01T00:00:00.000Z',
  });

  // FK stub: required by event_results_uploads
  const memberId = insertMember(db);

  // Historical persons for /history routes
  insertHistoricalPerson(db, {
    person_id:       ALICE_ID,
    person_name:     'Alice Footbag',
    country:         'US',
    event_count:     1,
    placement_count: 1,
    hof_member:    1,
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

  // ── Clubs ──────────────────────────────────────────────────────────────────
  // USA club with region
  insertClub(db, {
    id:      'club-portland-001',
    name:    'Rose City Footbag',
    city:    'Portland',
    region:  'Oregon',
    country: 'USA',
    hashtag_tag_id: insertTag(db, {
      tag_normalized: '#club_rose_city',
      tag_display:    '#club_rose_city',
      standard_type:  'club',
    }),
  });
  // USA club with region, different state
  insertClub(db, {
    id:      'club-boston-001',
    name:    'Boston Hackers',
    city:    'Boston',
    region:  'Massachusetts',
    country: 'USA',
    hashtag_tag_id: insertTag(db, {
      tag_normalized: '#club_boston_hackers',
      tag_display:    '#club_boston_hackers',
      standard_type:  'club',
    }),
  });
  // International club, no region
  insertClub(db, {
    id:      'club-helsinki-001',
    name:    'Helsinki Footbag',
    city:    'Helsinki',
    region:  null,
    country: 'Finland',
    external_url: 'https://example.com/helsinki',
    hashtag_tag_id: insertTag(db, {
      tag_normalized: '#club_helsinki',
      tag_display:    '#club_helsinki',
      standard_type:  'club',
    }),
  });
  // Archived club — must NOT appear in public listing
  insertClub(db, {
    id:      'club-archived-001',
    name:    'Old Defunct Club',
    city:    'Nowhere',
    country: 'USA',
    status:  'archived',
    hashtag_tag_id: insertTag(db, {
      tag_normalized: '#club_old_defunct',
      tag_display:    '#club_old_defunct',
      standard_type:  'club',
    }),
  });

  db.close();
}

beforeAll(async () => {
  await buildTestDatabase();
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

  it('returns JSON content-type', async () => {
    const app = createApp();
    const res = await request(app).get('/health/live');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('is accessible without authentication', async () => {
    const app = createApp();
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when database is reachable', async () => {
    const app = createApp();
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, check: 'ready' });
  });

  it('returns JSON content-type', async () => {
    const app = createApp();
    const res = await request(app).get('/health/ready');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('includes checks.database.isReady in response body', async () => {
    const app = createApp();
    const res = await request(app).get('/health/ready');
    expect(res.body).toMatchObject({
      checks: { database: { isReady: true } },
    });
  });

  it('is accessible without authentication', async () => {
    const app = createApp();
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
  });
});

// ── Events landing ─────────────────────────────────────────────────────────────

describe('GET /events', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
  });

  // Upcoming-events region intentionally omitted from /events while only the
  // featured promo (Worlds 2026) is highlighted. See IMPLEMENTATION_PLAN.md
  // known deviation. The data path (eventService.listPublicUpcomingEvents)
  // remains intact and is exercised via getPublicEventsLandingPage shape.
  it('does not currently render the upcoming-events region', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).not.toContain('2026 Spring Classic');
    expect(res.text).not.toContain('Portland');
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

  it('links participants to /history/ not /members/', async () => {
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.text).toContain(`/history/${ALICE_ID}`);
    expect(res.text).toContain(`/history/${BOB_ID}`);
    expect(res.text).not.toContain(`/members/${ALICE_ID}`);
    expect(res.text).not.toContain(`/members/${BOB_ID}`);
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

  it('shows the sparse-data notice on an event with fewer than 3 disciplines or 10 placements', async () => {
    // Beaver Open has 2 disciplines and 3 placements — qualifies as sparse.
    const app = createApp();
    const res = await request(app).get(`/events/${BEAVER_OPEN_KEY}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("We know the data from this event is incomplete but we're showing what we have anyway.");
  });

  it('does not show the sparse-data notice when the event has no results', async () => {
    // Quiet Open has no results; sparse notice is suppressed in favor of the no-results message.
    const app = createApp();
    const res = await request(app).get(`/events/${QUIET_OPEN_KEY}`);
    expect(res.text).not.toContain("We know the data from this event is incomplete");
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

  it('includes section cards for Events, Clubs, and Members', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('href="/events"');
    expect(res.text).toContain('href="/clubs"');
    expect(res.text).toContain('href="/members"');
  });

  it('shows Media Gallery as coming soon', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('Media Gallery');
    expect(res.text).toContain('card-coming-soon');
    expect(res.text).not.toContain('href="/media"');
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

// ── Clubs index ────────────────────────────────────────────────────────────────

describe('GET /clubs', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.status).toBe(200);
  });

  it('shows country names', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).toContain('USA');
    expect(res.text).toContain('Finland');
  });

  it('shows total club and country counts in hero', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).toContain('3 clubs');
    expect(res.text).toContain('2 countries');
  });

  it('links to country pages', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).toContain('href="/clubs/usa"');
    expect(res.text).toContain('href="/clubs/finland"');
  });

  it('does not show individual club names or hashtags on the index', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).not.toContain('Rose City Footbag');
    expect(res.text).not.toContain('#club_rose_city');
  });

  it('does not show archived club countries if they have no active clubs', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs');
    expect(res.text).not.toContain('Old Defunct Club');
  });
});

// ── Clubs country page ─────────────────────────────────────────────────────────

describe('GET /clubs/:countrySlug', () => {
  it('returns 200 for a known country', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.status).toBe(200);
  });

  it('shows clubs in the requested country', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).toContain('Rose City Footbag');
    expect(res.text).toContain('Boston Hackers');
  });

  it('does not show clubs from other countries', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).not.toContain('Helsinki Footbag');
  });

  it('shows region headings for clubs with regions', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).toContain('Oregon');
    expect(res.text).toContain('Massachusetts');
  });

  it('links club names to club detail URLs', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).toContain('href="/clubs/club_rose_city"');
    expect(res.text).toContain('href="/clubs/club_boston_hackers"');
  });

  it('renders data-club-id on each club entry', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).toContain('data-club-id="club-portland-001"');
  });

  it('renders region anchor IDs for map integration', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).toContain('id="region-oregon"');
    expect(res.text).toContain('id="region-massachusetts"');
  });

  it('does not show archived clubs', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/usa');
    expect(res.text).not.toContain('Old Defunct Club');
  });

  it('shows external links for clubs that have them', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/finland');
    expect(res.text).toContain('https://example.com/helsinki');
  });

  it('includes breadcrumb back to clubs index', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/finland');
    expect(res.text).toContain('href="/clubs"');
  });

  it('returns 404 for an unknown country slug', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/narnia');
    expect(res.status).toBe(404);
  });
});

// ── Club detail ────────────────────────────────────────────────────────────────

describe('GET /clubs/club_:clubKey', () => {
  it('returns 200 for a known club', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_rose_city');
    expect(res.status).toBe(200);
  });

  it('shows the club name', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_rose_city');
    expect(res.text).toContain('Rose City Footbag');
  });

  it('shows the club hashtag', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_rose_city');
    expect(res.text).toContain('#club_rose_city');
  });

  it('shows city and region', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_rose_city');
    expect(res.text).toContain('Portland');
    expect(res.text).toContain('Oregon');
  });

  it('shows external URL when present', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_helsinki');
    expect(res.text).toContain('https://example.com/helsinki');
  });

  it('includes breadcrumbs to clubs index and country page', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_rose_city');
    expect(res.text).toContain('href="/clubs"');
    expect(res.text).toContain('href="/clubs/usa"');
  });

  it('returns 404 for an unknown club key', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an archived club', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_old_defunct');
    expect(res.status).toBe(404);
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

  it('includes link to external Hall of Fame site', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('footbaghalloffame.net');
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

  it('renders history section with key content', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('A Bit of History');
    expect(res.text).toContain('Hacky Sack');
    expect(res.text).toContain('Stalberger');
  });
});

// ── Auth: login page ───────────────────────────────────────────────────────────

describe('GET /login', () => {
  it('returns 200 with login form for unauthenticated visitor', async () => {
    const app = createApp();
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<form');
    expect(res.text).toContain('name="email"');
    expect(res.text).toContain('name="password"');
  });

  it('redirects authenticated visitor to own profile', async () => {
    const app = createApp();
    const res = await request(app).get('/login').set('Cookie', validAuthCookie());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/test-user');
  });
});

// ── Auth: POST /login ──────────────────────────────────────────────────────────

describe('POST /login', () => {
  it('sets session cookie and redirects on valid credentials', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send(`email=footbag&password=${encodeURIComponent(process.env.STUB_PASSWORD ?? 'Footbag!')}`)
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members/footbag_hacky');
    const cookies: string[] = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie']
      : [res.headers['set-cookie']];
    expect(cookies.some((c: string) => c.startsWith('footbag_session='))).toBe(true);
  });

  it('returns 200 with error message on wrong password', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send('email=footbag&password=wrongpassword')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
  });

  it('returns 200 with error message on unknown username', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send('email=nobody@example.com&password=wrongpassword')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
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

// ── History: index ─────────────────────────────────────────────────────────────

describe('GET /history', () => {
  it('redirects to /members with 301', async () => {
    const app = createApp();
    const res = await request(app).get('/history');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/members');
  });
});

// ── History: detail page ───────────────────────────────────────────────────────

describe('GET /history/:personId', () => {
  it('returns 200 for HoF player without auth (public)', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${ALICE_ID}`);
    expect(res.status).toBe(200);
  });

  it('redirects unauthenticated visitor for non-HoF player', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${BOB_ID}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('returns 200 for non-HoF player when authenticated', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${BOB_ID}`).set('Cookie', validAuthCookie());
    expect(res.status).toBe(200);
  });

  it('shows player name on detail page', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${ALICE_ID}`);
    expect(res.text).toContain('Alice Footbag');
  });

  it('does not show unreliable country on detail page hero', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${ALICE_ID}`);
    expect(res.text).not.toContain('Country');
  });

  it("shows Alice's event result at 2025 Beaver Open", async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${ALICE_ID}`);
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('Freestyle');
  });

  it("shows Bob's multiple results including Shred30 win", async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${BOB_ID}`).set('Cookie', validAuthCookie());
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('Freestyle');
    expect(res.text).toContain('Shred30');
  });

  it('returns 404 for non-existent player', async () => {
    const app = createApp();
    const res = await request(app).get('/history/person-does-not-exist');
    expect(res.status).toBe(404);
  });
});

// ── 404 catch-all ──────────────────────────────────────────────────────────────

describe('GET /nonexistent-route', () => {
  it('returns 404 for an unknown route', async () => {
    const app = createApp();
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('renders the Page Not Found message', async () => {
    const app = createApp();
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.text).toContain('Page Not Found');
  });
});

