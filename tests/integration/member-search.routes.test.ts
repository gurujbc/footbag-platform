/**
 * Integration tests for GET /members (landing + search).
 *
 * Port 3060 — unique to this file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, insertHistoricalPerson } from '../fixtures/factories';
import { createSessionCookie } from '../../src/middleware/authStub';

const { dbPath, sessionSecret: TEST_SECRET } = setTestEnv('3063');

const SEARCHER_ID   = 'member-searcher-001';
const SEARCHER_SLUG = 'searcher_user';

function searcherCookie(): string {
  return `footbag_session=${createSessionCookie(SEARCHER_ID, 'member', TEST_SECRET, 'Searcher', SEARCHER_SLUG)}`;
}

let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // The searcher (authenticated user)
  insertMember(db, { id: SEARCHER_ID, slug: SEARCHER_SLUG, display_name: 'Searcher User', real_name: 'Searcher User' });

  // Searchable members
  insertMember(db, { display_name: 'Jane Footbag', real_name: 'Jane Footbag', country: 'US', slug: 'jane_footbag' });
  insertMember(db, { display_name: 'Janet Kicks', real_name: 'Janet Kicks', country: 'CA', slug: 'janet_kicks' });
  insertMember(db, { display_name: 'Bob Hackysack', real_name: 'Bob Hackysack', country: 'DE', slug: 'bob_hackysack' });

  // HoF member (honor badge should appear)
  insertMember(db, { display_name: 'Jane Legend', real_name: 'Jane Legend', slug: 'jane_legend', is_hof: 1 });

  // Opted-out member (searchable=0)
  insertMember(db, { display_name: 'Jane Hidden', real_name: 'Jane Hidden', slug: 'jane_hidden', searchable: 0 });

  // Deceased member
  insertMember(db, { display_name: 'Jane Departed', real_name: 'Jane Departed', slug: 'jane_departed', is_deceased: 1 });

  // Deleted member
  insertMember(db, { display_name: 'Jane Deleted', real_name: 'Jane Deleted', slug: 'jane_deleted', deleted_at: '2025-01-01T00:00:00.000Z' });

  // Unverified placeholder (email_verified_at = null)
  insertMember(db, { display_name: 'Jane Placeholder', real_name: 'Jane Placeholder', slug: 'jane_placeholder', email_verified_at: null });

  // Historical persons (legacy data)
  insertHistoricalPerson(db, { person_id: 'person-dave-001', person_name: 'Dave Leberknight', country: 'US' });
  insertHistoricalPerson(db, { person_id: 'person-zane-001', person_name: 'Zane Footbag', country: 'CA' });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

// ── Landing page ──────────────────────────────────────────────────────────────

describe('GET /members — landing', () => {
  it('unauthenticated → 200 with welcome page', async () => {
    const app = createApp();
    const res = await request(app).get('/members');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sign Up');
    expect(res.text).toContain('/register');
  });

  it('authenticated → 200 with search form and profile link', async () => {
    const app = createApp();
    const res = await request(app).get('/members').set('Cookie', searcherCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Search');
    expect(res.text).toContain(`/members/${SEARCHER_SLUG}`);
  });

  it('no search results section when no query', async () => {
    const app = createApp();
    const res = await request(app).get('/members').set('Cookie', searcherCookie());
    expect(res.text).not.toContain('Results');
    expect(res.text).not.toContain('No members found');
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe('GET /members?q= — member search', () => {
  it('prefix match returns matching members', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=ja').set('Cookie', searcherCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('Jane Footbag');
    expect(res.text).toContain('Janet Kicks');
    expect(res.text).toContain('Jane Legend');
  });

  it('shows country in results', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=ja').set('Cookie', searcherCookie());
    expect(res.text).toContain('US');
    expect(res.text).toContain('CA');
  });

  it('shows honor badge for HoF member', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=jane+le').set('Cookie', searcherCookie());
    expect(res.text).toContain('HoF');
  });

  it('links to member profile for current members', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=bob').set('Cookie', searcherCookie());
    expect(res.text).toContain('/members/bob_hackysack');
  });

  it('no results for unknown name', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=zzzzz').set('Cookie', searcherCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('No members found');
  });

  it('query too short (1 char) shows validation message', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=j').set('Cookie', searcherCookie());
    expect(res.status).toBe(200);
    expect(res.text).toContain('at least 2 characters');
  });

  it('excludes opted-out members (searchable=0)', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=jane').set('Cookie', searcherCookie());
    expect(res.text).not.toContain('Jane Hidden');
  });

  it('excludes deceased members', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=jane').set('Cookie', searcherCookie());
    expect(res.text).not.toContain('Jane Departed');
  });

  it('excludes deleted members', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=jane').set('Cookie', searcherCookie());
    expect(res.text).not.toContain('Jane Deleted');
  });

  it('excludes unverified placeholder members', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=jane').set('Cookie', searcherCookie());
    expect(res.text).not.toContain('Jane Placeholder');
  });

  it('matches substring anywhere in name', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=footbag').set('Cookie', searcherCookie());
    expect(res.text).toContain('Jane Footbag');
  });

  it('includes historical persons in results', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=lebe').set('Cookie', searcherCookie());
    expect(res.text).toContain('Dave Leberknight');
    expect(res.text).toContain('/history/person-dave-001');
  });

  it('links historical person to /history/:personId', async () => {
    const app = createApp();
    const res = await request(app).get('/members?q=zane').set('Cookie', searcherCookie());
    expect(res.text).toContain('Zane Footbag');
    expect(res.text).toContain('/history/person-zane-001');
  });
});
