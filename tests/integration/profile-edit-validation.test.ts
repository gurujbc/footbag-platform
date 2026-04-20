/**
 * Integration tests for profile edit negative paths and boundary validation.
 *
 * Covers:
 *   POST /members/:slug/edit
 *   - firstCompetitionYear boundaries and invalid values
 *   - showCompetitiveResults toggle
 *   - Bio at exactly 1000 chars (max)
 *   - Bio exceeding 1000 chars (rejected)
 *   - All fields empty (accepted)
 *   - Phone whitespace trimming
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, createTestSessionJwt } from '../fixtures/factories';

const { dbPath } = setTestEnv('3062');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

const MEMBER_ID   = 'edit-val-001';
const MEMBER_SLUG = 'edit_validator';

function ownCookie(): string {
  return `footbag_session=${createTestSessionJwt({ memberId: MEMBER_ID })}`;
}

/** Read the member row directly from the test DB to verify persisted values. */
function readMember(): Record<string, unknown> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const row = db.prepare('SELECT * FROM members WHERE id = ?').get(MEMBER_ID) as Record<string, unknown>;
  db.close();
  return row;
}

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, {
    id: MEMBER_ID,
    slug: MEMBER_SLUG,
    display_name: 'Edit Validator',
    login_email: 'editval@example.com',
    first_competition_year: 2000,
    show_competitive_results: 1,
  });
  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

function postEdit(fields: Record<string, string>): request.Test {
  return request(createApp())
    .post(`/members/${MEMBER_SLUG}/edit`)
    .set('Cookie', ownCookie())
    .type('form')
    .send(fields);
}

// ── firstCompetitionYear ──────────────────────────────────────────────────────

describe('firstCompetitionYear validation', () => {
  it('year below 1972 is silently discarded (set to NULL)', async () => {
    const res = await postEdit({ firstCompetitionYear: '1960' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.first_competition_year).toBeNull();
  });

  it('year above current year is silently discarded', async () => {
    const res = await postEdit({ firstCompetitionYear: '2099' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.first_competition_year).toBeNull();
  });

  it('year exactly 1972 is accepted', async () => {
    const res = await postEdit({ firstCompetitionYear: '1972' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.first_competition_year).toBe(1972);
  });

  it('year equal to current year is accepted', async () => {
    const currentYear = new Date().getFullYear().toString();
    const res = await postEdit({ firstCompetitionYear: currentYear });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.first_competition_year).toBe(Number(currentYear));
  });

  it('non-numeric string is discarded (set to NULL)', async () => {
    const res = await postEdit({ firstCompetitionYear: 'abc' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.first_competition_year).toBeNull();
  });

  it('empty string is discarded (set to NULL)', async () => {
    const res = await postEdit({ firstCompetitionYear: '' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.first_competition_year).toBeNull();
  });
});

// ── showCompetitiveResults ────────────────────────────────────────────────────

describe('showCompetitiveResults toggle', () => {
  it('set to 0 stores 0', async () => {
    const res = await postEdit({ showCompetitiveResults: '0' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.show_competitive_results).toBe(0);
  });

  it('set to 1 stores 1', async () => {
    const res = await postEdit({ showCompetitiveResults: '1' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.show_competitive_results).toBe(1);
  });

  it('any non-zero value defaults to 1', async () => {
    const res = await postEdit({ showCompetitiveResults: 'yes' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.show_competitive_results).toBe(1);
  });
});

// ── Bio ───────────────────────────────────────────────────────────────────────

describe('bio validation', () => {
  it('bio at exactly 1000 chars is accepted', async () => {
    const bio = 'x'.repeat(1000);
    const res = await postEdit({ bio });
    expect(res.status).toBe(302);
    const row = readMember();
    expect((row.bio as string).length).toBe(1000);
  });

  it('bio exceeding 1000 chars is rejected with 422', async () => {
    const bio = 'x'.repeat(1001);
    const res = await postEdit({ bio });
    expect(res.status).toBe(422);
    expect(res.text).toContain('1000 characters');
  });
});

// ── All fields empty ──────────────────────────────────────────────────────────

describe('all fields empty', () => {
  it('accepts empty submission without error', async () => {
    const res = await postEdit({
      bio: '',
      city: '',
      region: '',
      country: '',
      phone: '',
      emailVisibility: '',
      firstCompetitionYear: '',
      showCompetitiveResults: '1',
    });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.bio).toBe('');
    expect(row.city).toBeNull();
    expect(row.country).toBeNull();
  });
});

// ── Phone trimming ────────────────────────────────────────────────────────────

describe('phone whitespace trimming', () => {
  it('trims leading and trailing whitespace', async () => {
    const res = await postEdit({ phone: '  555-1234  ' });
    expect(res.status).toBe(302);
    const row = readMember();
    expect(row.phone).toBe('555-1234');
  });
});
