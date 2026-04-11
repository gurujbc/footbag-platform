/**
 * Integration tests for freestyle public routes.
 *
 * Covers:
 *   GET /freestyle         — landing page
 *   GET /freestyle/records — records page
 *
 * Public filter contract verified:
 *   - only 'probable' and 'verified' confidence rows appear
 *   - superseded rows (superseded_by IS NOT NULL) do not appear
 *   - rows with neither person_id nor display_name cannot exist (DB CHECK)
 *
 * Person-link contract:
 *   - resolved person_id renders as /history/:personId link
 *   - unresolved (display_name only) renders as plain text
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import {
  setTestEnv,
  createTestDb,
  cleanupTestDb,
  importApp,
} from '../fixtures/testDb';
import {
  insertHistoricalPerson,
  insertFreestyleRecord,
  insertMember,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3080');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const PERSON_ID          = 'person-freestyle-test-001';
const FREESTYLE_PLAYER_ID = 'person-freestyle-player-001';

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // A canonical person whose records should link to /history/:personId
  insertHistoricalPerson(db, {
    person_id:    PERSON_ID,
    person_name:  'Alice Shredder',
    source_scope: 'CANONICAL',
  });

  // Public record — linked to canonical person
  insertFreestyleRecord(db, {
    id:           'fr-public-linked',
    person_id:    PERSON_ID,
    display_name: 'Alice Shredder',
    trick_name:   'Torque',
    value_numeric: 42,
    confidence:   'probable',
    video_url:    'https://youtu.be/abc123',
  });

  // Public record — display_name only (no person_id)
  insertFreestyleRecord(db, {
    id:           'fr-public-unlinked',
    person_id:    null,
    display_name: 'Unknown Player',
    trick_name:   'Whirl',
    value_numeric: 17,
    confidence:   'probable',
  });

  // Provisional record — must NOT appear on public page
  insertFreestyleRecord(db, {
    id:           'fr-provisional',
    display_name: 'Hidden Player',
    trick_name:   'Secret Trick',
    value_numeric: 99,
    confidence:   'provisional',
  });

  // Superseded record — must NOT appear on public page
  insertFreestyleRecord(db, {
    id:             'fr-old',
    display_name:   'Old Record Holder',
    trick_name:     'Torque',
    value_numeric:  30,
    confidence:     'probable',
    superseded_by:  'fr-public-linked',
  });

  // Player with their own freestyle records — HoF so page is publicly accessible
  insertHistoricalPerson(db, {
    person_id:    FREESTYLE_PLAYER_ID,
    person_name:  'Bob Freestyler',
    source_scope: 'CANONICAL',
    hof_member:   1,
  });
  insertFreestyleRecord(db, {
    id:            'fr-bob-1',
    person_id:     FREESTYLE_PLAYER_ID,
    display_name:  'Bob Freestyler',
    trick_name:    'Pixie',
    value_numeric: 55,
    confidence:    'probable',
    video_url:     'https://youtu.be/pixie123',
    video_timecode: '0:42',
  });
  insertFreestyleRecord(db, {
    id:            'fr-bob-provisional',
    person_id:     FREESTYLE_PLAYER_ID,
    display_name:  'Bob Freestyler',
    trick_name:    'Hidden Trick',
    value_numeric: 99,
    confidence:    'provisional',  // must NOT appear on player page
  });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /freestyle', () => {
  it('returns 200 with page title', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Freestyle Footbag');
  });

  it('contains a link to /freestyle/records', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('/freestyle/records');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle/records', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.status).toBe(200);
  });

  it('shows public probable records', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).toContain('Torque');
    expect(res.text).toContain('Whirl');
  });

  it('links resolved person_id to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).toContain(`/history/${PERSON_ID}`);
    expect(res.text).toContain('Alice Shredder');
  });

  it('renders display_name as plain text when no person_id', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).toContain('Unknown Player');
    // Should not be wrapped in an /history link
    expect(res.text).not.toContain('/history/null');
    expect(res.text).not.toContain('href="/history/"');
  });

  it('does not show provisional records', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).not.toContain('Hidden Player');
    expect(res.text).not.toContain('Secret Trick');
  });

  it('does not show superseded records', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).not.toContain('Old Record Holder');
    // Value 30 could appear in other records, so check via holder name
  });

  it('shows video link when video_url is present', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).toContain('https://youtu.be/abc123');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle/leaders', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/leaders');
    expect(res.status).toBe(200);
  });

  it('shows Alice Shredder as a leader (has 1 public record)', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/leaders');
    expect(res.text).toContain('Alice Shredder');
  });

  it('links resolved person_id holders to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/leaders');
    expect(res.text).toContain(`/history/${PERSON_ID}`);
  });

  it('renders unresolved holder as plain text', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/leaders');
    expect(res.text).toContain('Unknown Player');
    expect(res.text).not.toContain('/history/null');
  });

  it('does not include provisional records in leader counts', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/leaders');
    expect(res.text).not.toContain('Hidden Player');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle — enriched landing page', () => {
  it('shows top holders section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('Top Record Holders');
    expect(res.text).toContain('Alice Shredder');
  });

  it('shows recent records section', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('Recent Records');
  });

  it('contains links to both records and leaders sub-pages', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle');
    expect(res.text).toContain('/freestyle/records');
    expect(res.text).toContain('/freestyle/leaders');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle/about', () => {
  it('returns 200 with page title', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/about');
    expect(res.status).toBe(200);
    expect(res.text).toContain('About Freestyle');
  });

  it('contains competition format content', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/about');
    expect(res.text).toContain('Routines');
    expect(res.text).toContain('30 Second Shred');
    expect(res.text).toContain('Sick 3');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle/moves', () => {
  it('returns 200 with page title', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/moves');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Move Sets');
  });

  it('contains core set names', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/moves');
    expect(res.text).toContain('Pixie');
    expect(res.text).toContain('Fairy');
    expect(res.text).toContain('Nuclear');
    expect(res.text).toContain('Stepping');
  });
});

// ---------------------------------------------------------------------------

describe('GET /freestyle/tricks/:slug', () => {
  it('returns 200 for a known trick slug', async () => {
    const app = createApp();
    // 'Torque' was inserted in beforeAll with slug 'torque'
    const res = await request(app).get('/freestyle/tricks/torque');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Torque');
    expect(res.text).toContain('Alice Shredder');
  });

  it('links holder to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/tricks/torque');
    expect(res.text).toContain(`/history/${PERSON_ID}`);
  });

  it('returns 404 for an unknown slug', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/tricks/not-a-real-trick');
    expect(res.status).toBe(404);
  });

  it('shows video link when present', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/tricks/torque');
    expect(res.text).toContain('https://youtu.be/abc123');
  });
});

// ---------------------------------------------------------------------------

describe('records page trick links', () => {
  it('links trick names to /freestyle/tricks/:slug on records page', async () => {
    const app = createApp();
    const res = await request(app).get('/freestyle/records');
    expect(res.text).toContain('/freestyle/tricks/torque');
  });
});

// ---------------------------------------------------------------------------

describe('GET /history/:personId — freestyle records section', () => {
  it('shows freestyle records section for a player with records', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${FREESTYLE_PLAYER_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Freestyle Records');
    expect(res.text).toContain('Pixie');
    expect(res.text).toContain('55');
  });

  it('shows video link with timecode on player freestyle section', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${FREESTYLE_PLAYER_ID}`);
    expect(res.text).toContain('https://youtu.be/pixie123');
    expect(res.text).toContain('0:42');
  });

  it('does not show provisional records on player page', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${FREESTYLE_PLAYER_ID}`);
    expect(res.text).not.toContain('Hidden Trick');
  });

  it('includes link to /freestyle/records from player freestyle section', async () => {
    const app = createApp();
    const res = await request(app).get(`/history/${FREESTYLE_PLAYER_ID}`);
    expect(res.text).toContain('/freestyle/records');
  });
});
