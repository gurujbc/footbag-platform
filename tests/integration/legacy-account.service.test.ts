/**
 * Integration tests for identityAccessService.lookupLegacyAccount and
 * claimLegacyAccount (three-table claim flow per DD §2.4).
 *
 * Exercises the new methods directly without going through HTTP; controllers
 * are swapped to these in a later batch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb } from '../fixtures/testDb';
import { insertMember, insertLegacyMember, insertHistoricalPerson } from '../fixtures/factories';

const { dbPath } = setTestEnv('3078');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let svc: typeof import('../../src/services/identityAccessService').identityAccessService;

// Live member who will do the claiming.
const MEMBER_A = 'member-a-claim';
// Live member who already has a claim (used for already-claimed tests).
const MEMBER_B = 'member-b-preclaimed';

// Legacy accounts to test against.
const LEGACY_UNCLAIMED = 'legmem-unclaimed-1';
const LEGACY_WITH_HP   = 'legmem-with-hp-1';
const LEGACY_PRECLAIMED = 'legmem-preclaimed-1';
const LEGACY_EMAIL_MATCH = 'legmem-email-1';
const LEGACY_USERID_MATCH = 'legmem-userid-1';

// HP that will be linked via legacy_member_id at claim time.
const HP_PERSON_ID = 'hp-linked-001';

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: MEMBER_A, slug: 'alice_claim', login_email: 'alice@example.com' });
  insertMember(db, { id: MEMBER_B, slug: 'bob_preclaim', login_email: 'bob@example.com' });
  // Pre-set B's legacy_member_id to simulate an already-claimed active member.
  insertLegacyMember(db, { legacy_member_id: 'legmem-b-prior', real_name: 'Prior Claim' });
  db.prepare(`UPDATE members SET legacy_member_id = ? WHERE id = ?`).run('legmem-b-prior', MEMBER_B);

  insertLegacyMember(db, {
    legacy_member_id: LEGACY_UNCLAIMED,
    real_name: 'Unclaimed User',
    legacy_email: 'unclaimed@example.com',
    country: 'Canada',
    is_hof: 0,
    is_bap: 0,
  });

  insertHistoricalPerson(db, {
    person_id: HP_PERSON_ID,
    person_name: 'Historical Linked',
    legacy_member_id: LEGACY_WITH_HP,
  });
  insertLegacyMember(db, {
    legacy_member_id: LEGACY_WITH_HP,
    real_name: 'Historical Linked',
    legacy_email: 'historical@example.com',
    country: 'Germany',
    is_hof: 1,
    is_bap: 0,
    bio: 'A competing legend.',
  });

  insertLegacyMember(db, {
    legacy_member_id: LEGACY_PRECLAIMED,
    real_name: 'Already Claimed',
    legacy_email: 'preclaimed@example.com',
    claimed_by_member_id: MEMBER_B,
    claimed_at: '2026-01-01T00:00:00.000Z',
  });

  insertLegacyMember(db, {
    legacy_member_id: LEGACY_EMAIL_MATCH,
    real_name: 'Email Lookup',
    legacy_email: 'findme@example.com',
  });

  insertLegacyMember(db, {
    legacy_member_id: LEGACY_USERID_MATCH,
    real_name: 'UserId Lookup',
    legacy_user_id: 'legacy_name_42',
  });

  db.close();

  const mod = await import('../../src/services/identityAccessService');
  svc = mod.identityAccessService;
});

afterAll(() => cleanupTestDb(dbPath));

function memberRow(id: string): Record<string, unknown> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const row = db.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as Record<string, unknown>;
  db.close();
  return row;
}

function legacyRow(id: string): Record<string, unknown> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const row = db.prepare(`SELECT * FROM legacy_members WHERE legacy_member_id = ?`).get(id) as Record<string, unknown>;
  db.close();
  return row;
}

describe('lookupLegacyAccount', () => {
  it('finds an unclaimed legacy_members row by legacy_member_id', () => {
    const result = svc.lookupLegacyAccount(MEMBER_A, LEGACY_UNCLAIMED);
    expect(result).not.toBeNull();
    expect(result!.legacyMemberId).toBe(LEGACY_UNCLAIMED);
    expect(result!.country).toBe('Canada');
  });

  it('finds by legacy_email', () => {
    const result = svc.lookupLegacyAccount(MEMBER_A, 'findme@example.com');
    expect(result?.legacyMemberId).toBe(LEGACY_EMAIL_MATCH);
  });

  it('finds by legacy_user_id', () => {
    const result = svc.lookupLegacyAccount(MEMBER_A, 'legacy_name_42');
    expect(result?.legacyMemberId).toBe(LEGACY_USERID_MATCH);
  });

  it('returns null for non-matching identifier', () => {
    const result = svc.lookupLegacyAccount(MEMBER_A, 'nonexistent-id-999');
    expect(result).toBeNull();
  });

  it('returns null when the legacy_members row is already claimed', () => {
    const result = svc.lookupLegacyAccount(MEMBER_A, LEGACY_PRECLAIMED);
    expect(result).toBeNull();
  });

  it('throws when the requesting member has already claimed a legacy record', () => {
    expect(() => svc.lookupLegacyAccount(MEMBER_B, LEGACY_UNCLAIMED)).toThrow(
      /already linked/i,
    );
  });

  it('throws on empty identifier', () => {
    expect(() => svc.lookupLegacyAccount(MEMBER_A, '   ')).toThrow(/enter a legacy identifier/i);
  });
});

describe('claimLegacyAccount', () => {
  it('marks legacy_members claimed, transfers fields, and sets historical_person_id when HP matches', () => {
    const MEMBER_CLAIM_HP = 'member-claim-hp';
    const db = new BetterSqlite3(dbPath);
    insertMember(db, { id: MEMBER_CLAIM_HP, slug: 'claim_hp', login_email: 'claimhp@example.com' });
    db.close();

    svc.claimLegacyAccount(MEMBER_CLAIM_HP, LEGACY_WITH_HP);

    const lm = legacyRow(LEGACY_WITH_HP);
    expect(lm.claimed_by_member_id).toBe(MEMBER_CLAIM_HP);
    expect(lm.claimed_at).toBeTruthy();

    const m = memberRow(MEMBER_CLAIM_HP);
    expect(m.legacy_member_id).toBe(LEGACY_WITH_HP);
    expect(m.historical_person_id).toBe(HP_PERSON_ID);
    expect(m.is_hof).toBe(1); // OR-merged from legacy.
    expect(m.country).toBe('US'); // factory default 'US' is non-empty, fill-if-empty leaves it alone.
    expect(m.bio).toBe('A competing legend.'); // member bio defaulted to '', so legacy fills it.
  });

  it('marks claimed and transfers fields when no HP match exists (no historical_person_id set)', () => {
    const MEMBER_CLAIM_NOHP = 'member-claim-nohp';
    const db = new BetterSqlite3(dbPath);
    insertMember(db, { id: MEMBER_CLAIM_NOHP, slug: 'claim_nohp', login_email: 'claimnohp@example.com' });
    db.close();

    svc.claimLegacyAccount(MEMBER_CLAIM_NOHP, LEGACY_UNCLAIMED);

    const lm = legacyRow(LEGACY_UNCLAIMED);
    expect(lm.claimed_by_member_id).toBe(MEMBER_CLAIM_NOHP);

    const m = memberRow(MEMBER_CLAIM_NOHP);
    expect(m.legacy_member_id).toBe(LEGACY_UNCLAIMED);
    expect(m.historical_person_id).toBeNull();
  });

  it('rejects claim of an already-claimed legacy_members row', () => {
    const MEMBER_DOUBLE_CLAIM = 'member-double-claim';
    const db = new BetterSqlite3(dbPath);
    insertMember(db, { id: MEMBER_DOUBLE_CLAIM, slug: 'double_claim', login_email: 'double@example.com' });
    db.close();

    expect(() => svc.claimLegacyAccount(MEMBER_DOUBLE_CLAIM, LEGACY_PRECLAIMED)).toThrow(
      /already been claimed/i,
    );
  });

  it('rejects when the requesting member already has a legacy claim', () => {
    // MEMBER_B has legacy_member_id='legmem-b-prior' set in beforeAll.
    const SOME_LEGACY = 'legmem-for-b-retry';
    const db = new BetterSqlite3(dbPath);
    insertLegacyMember(db, { legacy_member_id: SOME_LEGACY, real_name: 'Temp' });
    db.close();

    expect(() => svc.claimLegacyAccount(MEMBER_B, SOME_LEGACY)).toThrow(/already linked/i);
  });

  it('rejects claim of non-existent legacy_member_id', () => {
    const MEMBER_GHOST = 'member-ghost-claim';
    const db = new BetterSqlite3(dbPath);
    insertMember(db, { id: MEMBER_GHOST, slug: 'ghost', login_email: 'ghost@example.com' });
    db.close();

    expect(() => svc.claimLegacyAccount(MEMBER_GHOST, 'nonexistent-legacy-id')).toThrow(
      /no longer available/i,
    );
  });
});
