/**
 * Integration tests for the consecutive kicks records public route.
 *
 * Covers:
 *   GET /consecutive — consecutive kicks records page
 *
 * Verifies:
 *   - world records section renders
 *   - highest scores section renders with grouped subsections
 *   - progression section renders
 *   - milestone section renders
 *   - player names and scores appear correctly
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import {
  setTestEnv,
  createTestDb,
  cleanupTestDb,
  importApp,
} from '../fixtures/testDb';
import { insertConsecutiveKicksRecord } from '../fixtures/factories';

const { dbPath } = setTestEnv('3090');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // Official World Record row
  insertConsecutiveKicksRecord(db, {
    sort_order: 402,
    section:    'Official World Records',
    subsection: 'Current Official World Records',
    division:   'Open Singles',
    player_1:   'Ted Martin',
    player_2:   null,
    score:      63326,
    note:       'Open Singles World Record',
    event_date: '14/6/1997',
    event_name: '1997 Midwest Regional Footbag Championships',
    location:   'Lions Park, Mount Prospect, Illinois',
  });

  // Official World Record — doubles
  insertConsecutiveKicksRecord(db, {
    sort_order: 406,
    section:    'Official World Records',
    subsection: 'Current Official World Records',
    division:   'Open Doubles',
    player_1:   'Gary Lautt',
    player_2:   'Tricia George',
    score:      132011,
    note:       'Open Doubles World Record',
    event_date: '1998-03-21/1998-03-22',
    event_name: '1998 Chico Challenge',
    location:   'Lia Way Rec Center, Chico, California',
  });

  // Highest Official Score row
  insertConsecutiveKicksRecord(db, {
    sort_order: 101,
    section:    'Highest Official Scores',
    subsection: 'Singles Consecutive 20000+ Club',
    division:   'Open Singles',
    rank:       1,
    player_1:   'Ted Martin',
    player_2:   null,
    score:      63326,
    note:       'Open World Record',
  });

  // Another highest score (different player, Women's)
  insertConsecutiveKicksRecord(db, {
    sort_order: 105,
    section:    'Highest Official Scores',
    subsection: 'Singles Consecutive 20000+ Club',
    division:   "Women's Singles",
    rank:       5,
    player_1:   'Constance Constable',
    player_2:   null,
    score:      24713,
    note:       "Women's World Record",
  });

  // Progression row
  insertConsecutiveKicksRecord(db, {
    sort_order: 518,
    section:    'World Record Progression',
    subsection: 'Open Singles Consecutive',
    division:   'Open Singles',
    year:       '1997',
    player_1:   'Ted Martin',
    player_2:   null,
    score:      63326,
  });

  // Milestone row
  insertConsecutiveKicksRecord(db, {
    sort_order: 1307,
    section:    'Milestone Firsts',
    subsection: 'Singles milestone first',
    division:   'Open Singles',
    player_1:   'Ted Martin',
    player_2:   null,
    score:      40000,
  });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ---------------------------------------------------------------------------

describe('GET /consecutive', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.status).toBe(200);
  });

  it('renders the page title', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Consecutive Kicks Records');
  });

  it('shows Current World Records section', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Current World Records');
  });

  it('shows Ted Martin world record with score', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Ted Martin');
    expect(res.text).toContain('63,326');
  });

  it('shows doubles holders joined with &', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Gary Lautt');
    expect(res.text).toContain('Tricia George');
    expect(res.text).toContain('132,011');
  });

  it('shows Highest Official Scores section', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Highest Official Scores');
    expect(res.text).toContain('Singles Consecutive 20000+ Club');
  });

  it('shows Constance Constable in scores list', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Constance Constable');
    expect(res.text).toContain('24,713');
  });

  it('shows World Record Progression section', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('World Record Progression');
    expect(res.text).toContain('Open Singles Consecutive');
  });

  it('shows year column in progression table', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('1997');
  });

  it('shows Milestone Firsts section', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('Milestone Firsts');
    expect(res.text).toContain('Singles milestone first');
  });

  it('shows WFA source attribution', async () => {
    const app = createApp();
    const res = await request(app).get('/consecutive');
    expect(res.text).toContain('World Footbag Association');
  });
});
