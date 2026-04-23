/**
 * Integration tests for nameVariantsService.
 *
 * Contract under test: given a member's real_name, return historical-person
 * auto-link candidates via the `name_variants` table (HIGH-only by loader
 * contract). Read-only; no links created, no rows modified.
 *
 * Normalization: NFKC + lowercase + trim + collapse internal whitespace.
 * Rows stored in `name_variants` are pre-normalized by the loader.
 *
 * Cases covered:
 *   - diacritic variant hit
 *   - display-name variant hit
 *   - collision / no-match
 *   - exact canonical match (no variant row)
 *   - empty / whitespace input
 *   - multi-HP canonical collision
 *   - exact beats variant when same HP reachable both ways
 *   - NFKC normalization (compatibility form folding)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setTestEnv, createTestDb, cleanupTestDb } from '../fixtures/testDb';
import { insertHistoricalPerson, insertNameVariant } from '../fixtures/factories';

const { dbPath } = setTestEnv('3099');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let svc: typeof import('../../src/services/nameVariantsService');

// Canonical HP names and their IDs. Chosen to exercise diacritic / display-
// name / plain paths without depending on any pre-existing row.
const HP_ALEX_MARTINEZ         = 'person-hp-alex-martinez';
const HP_CHRIS_SIEBERT         = 'person-hp-chris-siebert';
const HP_SAM_Q_TESTER          = 'person-hp-sam-tester';
const HP_DUPLICATE_JANE_A      = 'person-hp-jane-doe-a';
const HP_DUPLICATE_JANE_B      = 'person-hp-jane-doe-b';
const HP_ALSO_CHRIS_SIEBERT    = 'person-hp-chris-siebert-literal';

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // Diacritic case: canonical HP has diacritic; variant is ASCII-folded.
  insertHistoricalPerson(db, {
    person_id: HP_ALEX_MARTINEZ,
    person_name: 'Alex Martínez',
  });
  insertNameVariant(db, {
    canonical_normalized: 'alex martínez',
    variant_normalized:   'alex martinez',
  });

  // Display-name case: canonical is a longer legal name; variant is a
  // shorter informal name.
  insertHistoricalPerson(db, {
    person_id: HP_CHRIS_SIEBERT,
    person_name: 'Christopher Michael Siebert',
  });
  insertNameVariant(db, {
    canonical_normalized: 'christopher michael siebert',
    variant_normalized:   'chris siebert',
  });

  // Plain canonical case: no variant row at all; an exact input should hit
  // directly.
  insertHistoricalPerson(db, {
    person_id: HP_SAM_Q_TESTER,
    person_name: 'Sam Q. Tester',
  });

  // Two distinct HPs sharing the same canonical normalized form — common
  // name collision. Both must be returned.
  insertHistoricalPerson(db, {
    person_id: HP_DUPLICATE_JANE_A,
    person_name: 'Jane Doe',
  });
  insertHistoricalPerson(db, {
    person_id: HP_DUPLICATE_JANE_B,
    person_name: 'Jane Doe',
  });

  // Same HP reachable both directly and through a variant: expect a single
  // record with matchKind='exact'.
  insertHistoricalPerson(db, {
    person_id: HP_ALSO_CHRIS_SIEBERT,
    person_name: 'Chris Siebert',
  });

  db.close();
  svc = await import('../../src/services/nameVariantsService');
});

afterAll(() => cleanupTestDb(dbPath));

describe('normalizeForMatch', () => {
  it('applies NFKC, lowercase, trim, and whitespace collapse', () => {
    expect(svc.normalizeForMatch('  Alex   Martínez  ')).toBe('alex martínez');
  });

  it('returns empty string for empty input', () => {
    expect(svc.normalizeForMatch('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(svc.normalizeForMatch('   \t\n  ')).toBe('');
  });

  it('folds NFKC-compatibility characters (fullwidth → ASCII)', () => {
    // U+FF21 ... FULLWIDTH LATIN CAPITAL LETTER A
    expect(svc.normalizeForMatch('Ａlex Martinez')).toBe('alex martinez');
  });
});

describe('findAutoLinkCandidates', () => {
  it('returns a diacritic-variant hit', () => {
    const candidates = svc.findAutoLinkCandidates('Alex Martinez');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      personId: HP_ALEX_MARTINEZ,
      personName: 'Alex Martínez',
      matchKind: 'variant',
      matchedCanonicalNormalized: 'alex martínez',
      matchedVariantNormalized:   'alex martinez',
    });
  });

  it('returns a display-name variant hit and the exact-match HP on the same canonical', () => {
    // "Chris Siebert" is both: (a) a variant → Christopher Michael Siebert,
    // and (b) itself a canonical HP name. Both HPs must appear: one via
    // 'variant', one via 'exact'.
    const candidates = svc.findAutoLinkCandidates('Chris Siebert');
    expect(candidates).toHaveLength(2);

    const byId = Object.fromEntries(candidates.map((c) => [c.personId, c]));
    expect(byId[HP_CHRIS_SIEBERT]).toMatchObject({
      personName: 'Christopher Michael Siebert',
      matchKind: 'variant',
      matchedCanonicalNormalized: 'christopher michael siebert',
      matchedVariantNormalized:   'chris siebert',
    });
    expect(byId[HP_ALSO_CHRIS_SIEBERT]).toMatchObject({
      personName: 'Chris Siebert',
      matchKind: 'exact',
      matchedCanonicalNormalized: 'chris siebert',
    });
    expect(byId[HP_ALSO_CHRIS_SIEBERT].matchedVariantNormalized).toBeUndefined();
  });

  it('returns no candidates when nothing matches (collision/no-match)', () => {
    expect(svc.findAutoLinkCandidates('Unknown Stranger')).toEqual([]);
  });

  it('hits the exact canonical path when no variant row exists', () => {
    const candidates = svc.findAutoLinkCandidates('Sam Q. Tester');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      personId: HP_SAM_Q_TESTER,
      personName: 'Sam Q. Tester',
      matchKind: 'exact',
      matchedCanonicalNormalized: 'sam q. tester',
    });
    expect(candidates[0].matchedVariantNormalized).toBeUndefined();
  });

  it('returns both HPs when two share the same canonical name (common-name collision)', () => {
    const candidates = svc.findAutoLinkCandidates('Jane Doe');
    const ids = candidates.map((c) => c.personId).sort();
    expect(ids).toEqual([HP_DUPLICATE_JANE_A, HP_DUPLICATE_JANE_B]);
    expect(candidates.every((c) => c.matchKind === 'exact')).toBe(true);
  });

  it('returns [] for empty input', () => {
    expect(svc.findAutoLinkCandidates('')).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(svc.findAutoLinkCandidates('   ')).toEqual([]);
  });

  it('normalizes extra whitespace in the input before lookup', () => {
    const candidates = svc.findAutoLinkCandidates('  Alex    Martinez  ');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].personId).toBe(HP_ALEX_MARTINEZ);
  });

  it('returns results in stable personId order', () => {
    const candidates = svc.findAutoLinkCandidates('Jane Doe');
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].personId <= candidates[i].personId).toBe(true);
    }
  });

  it('does not create or modify any row (read-only invariant)', async () => {
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const before = new BetterSqlite3(dbPath, { readonly: true });
    const countsBefore = {
      hp:        (before.prepare('SELECT COUNT(*) AS n FROM historical_persons').get() as { n: number }).n,
      variants:  (before.prepare('SELECT COUNT(*) AS n FROM name_variants').get() as { n: number }).n,
      members:   (before.prepare('SELECT COUNT(*) AS n FROM members').get() as { n: number }).n,
    };
    before.close();

    svc.findAutoLinkCandidates('Alex Martinez');
    svc.findAutoLinkCandidates('Chris Siebert');
    svc.findAutoLinkCandidates('Unknown Stranger');

    const after = new BetterSqlite3(dbPath, { readonly: true });
    const countsAfter = {
      hp:        (after.prepare('SELECT COUNT(*) AS n FROM historical_persons').get() as { n: number }).n,
      variants:  (after.prepare('SELECT COUNT(*) AS n FROM name_variants').get() as { n: number }).n,
      members:   (after.prepare('SELECT COUNT(*) AS n FROM members').get() as { n: number }).n,
    };
    after.close();

    expect(countsAfter).toEqual(countsBefore);
  });
});
