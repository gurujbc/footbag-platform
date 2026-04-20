/**
 * Integration tests for member privacy boundaries.
 *
 * Covers:
 *   - Honors-gated public profiles (HoF/BAP accessible without auth; regular members not)
 *   - PII not leaked on public profiles
 *   - show_competitive_results flag
 *   - Purged members excluded from all queries
 *   - Deceased members cannot log in
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, insertHistoricalPerson, insertTag, insertEvent, insertDiscipline, insertResultsUpload, insertResultEntry, insertResultParticipant, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3060');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const HOF_SLUG     = 'hof_player';
const BAP_SLUG     = 'bap_player';
const REGULAR_SLUG = 'regular_player';
const PURGED_SLUG  = 'purged_player';
const DECEASED_SLUG = 'deceased_player';
const HOF_NORESULTS_SLUG = 'hof_noresults';
const VIEWER_ID    = 'viewer-001';
const VIEWER_SLUG  = 'viewer_user';

const DECEASED_EMAIL    = 'deceased@example.com';
const DECEASED_PASSWORD = 'DeceasedPass1!';

function viewerCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: VIEWER_ID })}`;
}

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // Viewer (authenticated user who is not any of the test subjects)
  insertMember(db, { id: VIEWER_ID, slug: VIEWER_SLUG, display_name: 'Viewer User' });

  // HoF member with results
  const hofId = insertMember(db, {
    id: 'hof-001', slug: HOF_SLUG, display_name: 'HoF Player',
    is_hof: 1, show_competitive_results: 1,
    login_email: 'hof@example.com',
    legacy_member_id: 'legacy-hof-001',
  });
  // Create a linked historical person and result for this HoF member
  insertHistoricalPerson(db, {
    person_id: 'hp-hof-001', person_name: 'HoF Player',
    legacy_member_id: 'legacy-hof-001',
    event_count: 1, placement_count: 1, hof_member: 1,
  });
  const evtId = insertEvent(db, { status: 'completed', title: 'HoF Event' });
  const discId = insertDiscipline(db, evtId);
  const uploadId = insertResultsUpload(db, evtId, hofId);
  const entryId = insertResultEntry(db, evtId, uploadId, discId, { placement: 1 });
  insertResultParticipant(db, entryId, 'HoF Player', { historical_person_id: 'hp-hof-001' });

  // BAP member
  insertMember(db, {
    id: 'bap-001', slug: BAP_SLUG, display_name: 'BAP Player',
    is_bap: 1,
    login_email: 'bap@example.com',
  });

  // Regular member (neither HoF nor BAP)
  insertMember(db, {
    id: 'regular-001', slug: REGULAR_SLUG, display_name: 'Regular Player',
    login_email: 'regular@example.com',
  });

  // HoF member with show_competitive_results = 0
  insertMember(db, {
    id: 'hof-noresults-001', slug: HOF_NORESULTS_SLUG, display_name: 'HoF No Results',
    is_hof: 1, show_competitive_results: 0,
    login_email: 'hofnoresults@example.com',
    legacy_member_id: 'legacy-hof-nr',
  });
  insertHistoricalPerson(db, {
    person_id: 'hp-hof-nr', person_name: 'HoF No Results',
    legacy_member_id: 'legacy-hof-nr',
    event_count: 1, placement_count: 1, hof_member: 1,
  });

  // Purged member (personal_data_purged_at set, credentials NULL)
  insertMember(db, {
    id: 'purged-001', slug: PURGED_SLUG, display_name: 'Purged Player',
    personal_data_purged_at: '2025-06-01T00:00:00.000Z',
    is_hof: 1,  // even HoF purged members should not be accessible
  });

  // Deceased member with valid credentials
  const deceasedHash = await argon2.hash(DECEASED_PASSWORD);
  insertMember(db, {
    id: 'deceased-001', slug: DECEASED_SLUG, display_name: 'Deceased Player',
    login_email: DECEASED_EMAIL, password_hash: deceasedHash,
    is_deceased: 1, is_hof: 1,
  });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ── HoF public profile ───────────────────────────────────────────────────────

describe('GET /members/:slug — HoF public profile', () => {
  it('accessible without auth', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${HOF_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('HoF Player');
  });

  it('does not expose login_email', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${HOF_SLUG}`);
    expect(res.text).not.toContain('hof@example.com');
  });

  it('does not contain profile edit form fields', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${HOF_SLUG}`);
    expect(res.text).not.toContain('name="bio"');
    expect(res.text).not.toContain('name="phone"');
    expect(res.text).not.toContain('name="emailVisibility"');
  });
});

// ── BAP public profile ───────────────────────────────────────────────────────

describe('GET /members/:slug — BAP public profile', () => {
  it('accessible without auth', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${BAP_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('BAP Player');
  });
});

// ── Regular member (not HoF/BAP) ─────────────────────────────────────────────

describe('GET /members/:slug — regular member', () => {
  it('redirects to login without auth', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${REGULAR_SLUG}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('returns 404 for different authenticated user', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${REGULAR_SLUG}`)
      .set('Cookie', viewerCookie());
    expect(res.status).toBe(404);
  });
});

// ── show_competitive_results flag ─────────────────────────────────────────────

describe('show_competitive_results flag', () => {
  it('HoF with results enabled shows event data', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${HOF_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('HoF Event');
  });

  it('HoF with results disabled omits event data', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${HOF_NORESULTS_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('HoF Event');
  });
});

// ── Purged member ─────────────────────────────────────────────────────────────

describe('purged member', () => {
  it('profile returns 404 without auth', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${PURGED_SLUG}`);
    // Either 302 (redirect to login) or 404; purged slug should not resolve
    expect([302, 404]).toContain(res.status);
  });

  it('profile returns 404 with auth', async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/members/${PURGED_SLUG}`)
      .set('Cookie', viewerCookie());
    expect(res.status).toBe(404);
  });
});

// ── Deceased member ───────────────────────────────────────────────────────────

describe('deceased member', () => {
  it('cannot log in with valid credentials', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: DECEASED_EMAIL, password: DECEASED_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
  });

  it('public profile is still visible if HoF', async () => {
    const app = createApp();
    const res = await request(app).get(`/members/${DECEASED_SLUG}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Deceased Player');
  });
});
