/**
 * Integration tests for auth-gating of club member lists.
 *
 * Club detail pages are public, but the members section is only rendered
 * for authenticated users. Unauthenticated responses must not include
 * member names in the HTML body.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import {
  insertTag,
  insertClub,
  insertMember,
  insertHistoricalPerson,
  insertLegacyClubCandidate,
  insertLegacyPersonClubAffiliation,
  createTestSessionJwt,
} from '../fixtures/factories';

const TEST_DB_PATH      = path.join(process.cwd(), `test-clubs-auth-${Date.now()}.db`);

// JWT/SES env vars come from tests/setup-env.ts (per-vitest-worker defaults).
process.env.FOOTBAG_DB_PATH          = TEST_DB_PATH;
process.env.PORT                     = '3002';
process.env.NODE_ENV                 = 'test';
process.env.LOG_LEVEL                = 'error';
process.env.PUBLIC_BASE_URL          = 'http://localhost:3002';
process.env.SESSION_SECRET           = 'test-secret-clubs-auth';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: typeof import('../../src/app').createApp;

function authCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: 'test-user', role: 'admin' })}`;
}

beforeAll(async () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // Admin test-user for authCookie()
  insertMember(db, {
    id: 'test-user',
    slug: 'test_user_admin',
    login_email: 'test-user@example.com',
    display_name: 'Test Admin',
    is_admin: 1,
  });

  // Club with a known tag key
  const clubId = insertClub(db, {
    id:   'club-auth-test-001',
    name: 'Evergreen Footbag Club',
    city: 'Seattle',
    country: 'USA',
    hashtag_tag_id: insertTag(db, {
      tag_normalized: '#club_evergreen',
      tag_display:    '#club_evergreen',
      standard_type:  'club',
    }),
  });

  // Historical person who is a confirmed member of that club
  const personId = insertHistoricalPerson(db, {
    person_id:   'person-confirmed-001',
    person_name: 'Zephyr Kickflip',
    country:     'US',
  });

  // Legacy candidate mapped to the club
  const candidateId = insertLegacyClubCandidate(db, {
    legacy_club_key: 'legacy_evergreen_001',
    display_name:    'Evergreen Footbag Club',
    mapped_club_id:  clubId,
  });

  // Confirmed affiliation
  insertLegacyPersonClubAffiliation(db, {
    historical_person_id:     personId,
    legacy_club_candidate_id: candidateId,
    resolution_status:        'confirmed_current',
  });

  // Second person with a 'pending' (unresolved) affiliation — must never appear
  const pendingPersonId = insertHistoricalPerson(db, {
    person_id:   'person-pending-001',
    person_name: 'Phantom Unresolved',
    country:     'US',
  });
  insertLegacyPersonClubAffiliation(db, {
    historical_person_id:     pendingPersonId,
    legacy_club_candidate_id: candidateId,
    resolution_status:        'pending',
  });

  db.close();
  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  for (const f of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('GET /clubs/club_evergreen — unauthenticated', () => {
  it('returns 200 (club detail is public)', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_evergreen');
    expect(res.status).toBe(200);
  });

  it('shows club name and city', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_evergreen');
    expect(res.text).toContain('Evergreen Footbag Club');
    expect(res.text).toContain('Seattle');
  });

  it('does not include member names in the response body', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_evergreen');
    expect(res.text).not.toContain('Zephyr Kickflip');
  });

  it('shows a login prompt in place of the members list', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_evergreen');
    expect(res.text).toContain('Log in');
    expect(res.text).toContain('/login');
  });

  it('does not expose members with unresolved affiliation status', async () => {
    const app = createApp();
    const res = await request(app).get('/clubs/club_evergreen');
    expect(res.text).not.toContain('Phantom Unresolved');
  });
});

describe('GET /clubs/club_evergreen — authenticated', () => {
  it('returns 200', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/clubs/club_evergreen')
      .set('Cookie', authCookie());
    expect(res.status).toBe(200);
  });

  it('shows confirmed member names', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/clubs/club_evergreen')
      .set('Cookie', authCookie());
    expect(res.text).toContain('Zephyr Kickflip');
  });

  it('does not show the login prompt', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/clubs/club_evergreen')
      .set('Cookie', authCookie());
    expect(res.text).not.toContain('Log in to see club members');
  });

  it('does not expose members with unresolved affiliation status', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/clubs/club_evergreen')
      .set('Cookie', authCookie());
    expect(res.text).not.toContain('Phantom Unresolved');
  });
});
