/**
 * Integration tests for all public app routes.
 * Covers: health, home, clubs, events (list/year/detail), login, logout,
 * auth redirects, members index, and members detail.
 *
 * Strategy: set FOOTBAG_DB_PATH to a temp file before any module import so
 * that db.ts opens the test database. A beforeAll hook builds the schema and
 * inserts deterministic seed rows sufficient for route-level assertions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'test-footbag.db');

// Set env vars BEFORE any module that reads them is imported.
process.env.FOOTBAG_DB_PATH  = TEST_DB_PATH;
process.env.PORT             = '3001';
process.env.NODE_ENV         = 'test';
process.env.LOG_LEVEL        = 'error'; // silence logs in test output
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

  // ── Seed: stub member (required as FK for event_results_uploads) ──────────
  db.exec(`
    INSERT INTO members (
      id,
      login_email, login_email_normalized, password_hash, password_changed_at,
      real_name, display_name, display_name_normalized,
      city, country,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (
      'seed-member-0001',
      'seed@example.com', 'seed@example.com', '[SEED_HASH]', '2025-01-01T00:00:00.000Z',
      'Seed User', 'Seed User', 'seed user',
      'Seedville', 'US',
      '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1
    );
  `);

  // ── Seed: tags ─────────────────────────────────────────────────────────────
  db.exec(`
    INSERT INTO tags (id, tag_normalized, tag_display, is_standard, standard_type, created_at, created_by, updated_at, updated_by, version)
    VALUES
      ('tag-spring-classic', '#event_2026_spring_classic', '#Event_2026_Spring_Classic', 1, 'event', '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1),
      ('tag-beaver-open',    '#event_2025_beaver_open',    '#Event_2025_Beaver_Open',    1, 'event', '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1),
      ('tag-quiet-open',     '#event_2025_quiet_open',     '#Event_2025_Quiet_Open',     1, 'event', '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1),
      ('tag-draft-event',    '#event_2026_draft_event',    '#Event_2026_Draft_Event',    1, 'event', '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1);
  `);

  // ── Seed A: upcoming published event (no results) ─────────────────────────
  db.exec(`
    INSERT INTO events (
      id, hashtag_tag_id, title, description, start_date, end_date,
      city, country, status, registration_status, sanction_status,
      payment_enabled, currency,
      is_attendee_registration_open, is_tshirt_size_collected,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (
      'event-spring-classic-2026',
      'tag-spring-classic',
      '2026 Spring Classic',
      'An upcoming footbag tournament.',
      '2026-04-15', '2026-04-17',
      'Portland', 'US',
      'published', 'open', 'none',
      0, 'USD', 0, 0,
      '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1
    );
  `);

  // ── Seed B: completed event WITH results ───────────────────────────────────
  db.exec(`
    INSERT INTO events (
      id, hashtag_tag_id, title, description, start_date, end_date,
      city, country, status, registration_status, sanction_status,
      payment_enabled, currency,
      is_attendee_registration_open, is_tshirt_size_collected,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (
      'event-beaver-open-2025',
      'tag-beaver-open',
      '2025 Beaver Open',
      'A completed footbag tournament with results.',
      '2025-07-10', '2025-07-12',
      'Corvallis', 'US',
      'completed', 'closed', 'none',
      0, 'USD', 0, 0,
      '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1
    );

    INSERT INTO event_disciplines (id, event_id, name, discipline_category, team_type, sort_order, created_at, created_by, updated_at, updated_by, version)
    VALUES ('disc-freestyle-001', 'event-beaver-open-2025', 'Freestyle', 'freestyle', 'singles', 1, '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1);

    INSERT INTO event_results_uploads (
      id, event_id, uploaded_by_member_id, uploaded_at,
      original_filename, created_at, created_by, updated_at, updated_by, version
    ) VALUES (
      'upload-001', 'event-beaver-open-2025', 'seed-member-0001',
      '2025-07-13T00:00:00.000Z', 'results.csv',
      '2025-07-13T00:00:00.000Z', 'system', '2025-07-13T00:00:00.000Z', 'system', 1
    );

    INSERT INTO event_result_entries (id, event_id, results_upload_id, discipline_id, placement, created_at, created_by, updated_at, updated_by, version)
    VALUES
      ('entry-001', 'event-beaver-open-2025', 'upload-001', 'disc-freestyle-001', 1, '2025-07-13T00:00:00.000Z', 'system', '2025-07-13T00:00:00.000Z', 'system', 1),
      ('entry-002', 'event-beaver-open-2025', 'upload-001', 'disc-freestyle-001', 2, '2025-07-13T00:00:00.000Z', 'system', '2025-07-13T00:00:00.000Z', 'system', 1);

    INSERT INTO event_result_entry_participants (id, result_entry_id, participant_order, display_name, created_at, created_by, updated_at, updated_by, version)
    VALUES
      ('part-001', 'entry-001', 1, 'Alice Footbag', '2025-07-13T00:00:00.000Z', 'system', '2025-07-13T00:00:00.000Z', 'system', 1),
      ('part-002', 'entry-002', 1, 'Bob Hackysack', '2025-07-13T00:00:00.000Z', 'system', '2025-07-13T00:00:00.000Z', 'system', 1);
  `);

  // ── Seed C: completed event WITHOUT results ────────────────────────────────
  db.exec(`
    INSERT INTO events (
      id, hashtag_tag_id, title, description, start_date, end_date,
      city, country, status, registration_status, sanction_status,
      payment_enabled, currency,
      is_attendee_registration_open, is_tshirt_size_collected,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (
      'event-quiet-open-2025',
      'tag-quiet-open',
      '2025 Quiet Open',
      'A completed event with no results uploaded.',
      '2025-09-05', '2025-09-07',
      'Eugene', 'US',
      'completed', 'closed', 'none',
      0, 'USD', 0, 0,
      '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1
    );
  `);

  // ── Seed D: draft event — must not be publicly visible ─────────────────────
  db.exec(`
    INSERT INTO events (
      id, hashtag_tag_id, title, description, start_date, end_date,
      city, country, status, registration_status, sanction_status,
      payment_enabled, currency,
      is_attendee_registration_open, is_tshirt_size_collected,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (
      'event-draft-2026',
      'tag-draft-event',
      '2026 Draft Event',
      'This event should never appear publicly.',
      '2026-06-01', '2026-06-03',
      'Nowhere', 'US',
      'draft', 'open', 'none',
      0, 'USD', 0, 0,
      '2025-01-01T00:00:00.000Z', 'system', '2025-01-01T00:00:00.000Z', 'system', 1
    );
  `);

  // ── Seed E: historical persons for member route tests ─────────────────────
  db.exec(`
    INSERT INTO historical_persons (
      person_id, person_name, country,
      event_count, placement_count,
      bap_member, fbhof_member
    ) VALUES
      ('person-alice-001', 'Alice Footbag', 'US', 3, 5, 0, 0),
      ('person-bob-002',   'Bob Hackysack', 'CA', 1, 2, 0, 0);
  `);

  db.close();
}

beforeAll(async () => {
  buildTestDatabase();
  // Import after DB is built and env vars are set
  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  // Also remove WAL sidecar files if present
  for (const ext of ['-wal', '-shm']) {
    const f = TEST_DB_PATH + ext;
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
  it('returns 200 and includes upcoming event title', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2026 Spring Classic');
  });

  it('includes archive year link for 2025', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/events/year/2025');
  });

  it('does not reveal draft events', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).not.toContain('2026 Draft Event');
  });
});

// ── Events year archive ────────────────────────────────────────────────────────

describe('GET /events/year/:year', () => {
  it('returns 200 for a year with events', async () => {
    const app = createApp();
    const res = await request(app).get('/events/year/2025');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('2025 Quiet Open');
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
});

// ── Single event page ──────────────────────────────────────────────────────────

describe('GET /events/:eventKey', () => {
  it('returns 200 for event with results', async () => {
    const app = createApp();
    const res = await request(app).get('/events/event_2025_beaver_open');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2025 Beaver Open');
    expect(res.text).toContain('Alice Footbag');
  });

  it('returns 200 for event without results and shows no-results message', async () => {
    const app = createApp();
    const res = await request(app).get('/events/event_2025_quiet_open');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2025 Quiet Open');
    expect(res.text).toContain('Results are not yet available');
  });

  it('returns 200 for upcoming (published) event', async () => {
    const app = createApp();
    const res = await request(app).get('/events/event_2026_spring_classic');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2026 Spring Classic');
  });

  it('returns 404 for a draft (non-public) event', async () => {
    const app = createApp();
    const res = await request(app).get('/events/event_2026_draft_event');
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
    // This verifies the route ordering: year/:year must match before :eventKey
    const app = createApp();
    const res = await request(app).get('/events/year/2025');
    expect(res.status).toBe(200);
    // Should render year page, not a 404 from eventKey validation failure
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

  it('includes a featured upcoming event', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('2026 Spring Classic');
  });

  it('does not reveal draft events', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).not.toContain('2026 Draft Event');
  });

  it('includes navigation links to events and clubs', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('href="/events"');
    expect(res.text).toContain('href="/clubs"');
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

  it('includes coming-soon notice', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('coming soon');
  });

  it('includes HoF nav link in header', async () => {
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

  it('renders content sections', async () => {
    const app = createApp();
    const res = await request(app).get('/hof');
    expect(res.text).toContain('A Bit of History');
    expect(res.text).toContain('The Mike Marshall Award');
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

  it('redirects to /members when already authenticated', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/login')
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members');
  });
});

// ── Auth: POST /login ──────────────────────────────────────────────────────────

describe('POST /login', () => {
  it('redirects to /members and sets cookie on valid credentials', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .send('username=footbag&password=Footbag!')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/members');
    expect(res.headers['set-cookie']).toBeDefined();
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

  it('returns 200 with error message on wrong username', async () => {
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
    // Cookie should be cleared (Max-Age=0 or Expires in the past)
    const sessionCookie = cookies.find((c: string) => c.startsWith('footbag_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

// ── Members: auth gate ─────────────────────────────────────────────────────────

describe('GET /members (auth gate)', () => {
  it('redirects unauthenticated visitor to /login', async () => {
    const app = createApp();
    const res = await request(app).get('/members');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('returns 200 for authenticated visitor and shows member list', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members')
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alice Footbag');
    expect(res.text).toContain('Bob Hackysack');
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

// ── Members: detail page auth gate ────────────────────────────────────────────

describe('GET /members/:personId (auth gate)', () => {
  it('redirects unauthenticated visitor to /login', async () => {
    const app = createApp();
    const res = await request(app).get('/members/person-alice-001');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('returns 200 for authenticated visitor viewing existing member', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members/person-alice-001')
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alice Footbag');
  });

  it('returns 404 for authenticated visitor viewing non-existent member', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/members/person-does-not-exist')
      .set('Cookie', validAuthCookie());
    expect(res.status).toBe(404);
  });
});
