/**
 * Integration tests for the Phase 3B auto-link classifier in
 * identityAccessService.verifyEmailByToken.
 *
 * Contract under test: combining the email-anchor check with
 * findAutoLinkCandidates(real_name) produces an AutoLinkClassification that
 * callers can use to decide post-verify UI. Tier 1 and Tier 2 are only
 * emitted when email anchor, HP-provenance, and a unique name candidate all
 * point to the same HP. Any other email-anchored situation is Tier 3.
 * Absence of an email anchor yields tier: 'none'. The classifier never
 * writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb } from '../fixtures/testDb';
import {
  insertMember,
  insertHistoricalPerson,
  insertLegacyMember,
  insertNameVariant,
} from '../fixtures/factories';

const { dbPath } = setTestEnv('3100');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let identitySvc: typeof import('../../src/services/identityAccessService');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let tokenSvc: typeof import('../../src/services/accountTokenService');

// Shared fixture identifiers.
const LEGACY_ID_EXACT      = 'legmem-auto-exact';
const LEGACY_ID_VARIANT    = 'legmem-auto-variant';
const LEGACY_ID_MULTI      = 'legmem-auto-multi';
const LEGACY_ID_NO_CAND    = 'legmem-auto-nocand';
const LEGACY_ID_HP_MISMATCH = 'legmem-auto-hpmismatch';
const LEGACY_ID_NO_HP      = 'legmem-auto-nohp';

const HP_EXACT     = 'hp-auto-exact';
const HP_VARIANT   = 'hp-auto-variant';
const HP_MULTI_A   = 'hp-auto-multi-a';
const HP_MULTI_B   = 'hp-auto-multi-b';
const HP_ACTUAL    = 'hp-auto-actual';        // HP that email-anchor expects
const HP_DECOY     = 'hp-auto-decoy';         // HP the name happens to point to

const LEGACY_ID_SURNAME_SPLIT = 'legmem-auto-surname-split';
const HP_SURNAME_SPLIT        = 'hp-auto-surname-split';

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // ── Scenario 1: tier1 — unique exact match ────────────────────────────────
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_EXACT, legacy_email: 'exact@example.com' });
  insertHistoricalPerson(db, {
    person_id: HP_EXACT,
    person_name: 'Jordan Alpha',
    legacy_member_id: LEGACY_ID_EXACT,
  });
  insertMember(db, {
    id: 'mem-tier1',
    slug: 'tier1_mem',
    login_email: 'exact@example.com',
    real_name: 'Jordan Alpha',
    email_verified_at: null,
  });

  // ── Scenario 2: tier2 — unique variant match via name_variants ───────────
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_VARIANT, legacy_email: 'variant@example.com' });
  insertHistoricalPerson(db, {
    person_id: HP_VARIANT,
    person_name: 'Alex Martínez',
    legacy_member_id: LEGACY_ID_VARIANT,
  });
  insertNameVariant(db, {
    canonical_normalized: 'alex martínez',
    variant_normalized:   'alex martinez',
  });
  insertMember(db, {
    id: 'mem-tier2',
    slug: 'tier2_mem',
    login_email: 'variant@example.com',
    real_name: 'Alex Martinez',    // ASCII-folded — must resolve via variant
    email_verified_at: null,
  });

  // ── Scenario 3: tier3 multiple_name_candidates ───────────────────────────
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_MULTI, legacy_email: 'multi@example.com' });
  insertHistoricalPerson(db, {
    person_id: HP_MULTI_A,
    person_name: 'Pat Common',
    legacy_member_id: LEGACY_ID_MULTI,
  });
  insertHistoricalPerson(db, {
    person_id: HP_MULTI_B,
    person_name: 'Pat Common',
  });
  insertMember(db, {
    id: 'mem-tier3-multi',
    slug: 'tier3_multi',
    login_email: 'multi@example.com',
    real_name: 'Pat Common',
    email_verified_at: null,
  });

  // ── Scenario 4: tier3 no_name_candidate ──────────────────────────────────
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_NO_CAND, legacy_email: 'nocand@example.com' });
  insertHistoricalPerson(db, {
    person_id: 'hp-auto-nocand',
    person_name: 'Provenance Target',
    legacy_member_id: LEGACY_ID_NO_CAND,
  });
  insertMember(db, {
    id: 'mem-tier3-nocand',
    slug: 'tier3_nocand',
    login_email: 'nocand@example.com',
    real_name: 'Completely Different Name',   // no HP matches
    email_verified_at: null,
  });

  // ── Scenario 5: tier3 hp_mismatch ────────────────────────────────────────
  // Email provenances to HP_ACTUAL; real_name resolves to HP_DECOY.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_HP_MISMATCH, legacy_email: 'mismatch@example.com' });
  insertHistoricalPerson(db, {
    person_id: HP_ACTUAL,
    person_name: 'Correct Owner',
    legacy_member_id: LEGACY_ID_HP_MISMATCH,
  });
  insertHistoricalPerson(db, {
    person_id: HP_DECOY,
    person_name: 'Decoy Claimer',
  });
  insertMember(db, {
    id: 'mem-tier3-mismatch',
    slug: 'tier3_mismatch',
    login_email: 'mismatch@example.com',
    real_name: 'Decoy Claimer',
    email_verified_at: null,
  });

  // ── Scenario 6: tier3 no_hp_for_legacy_account ───────────────────────────
  // Email matches a legacy_members row, but no HP back-links to it.
  insertLegacyMember(db, { legacy_member_id: LEGACY_ID_NO_HP, legacy_email: 'nohp@example.com' });
  insertMember(db, {
    id: 'mem-tier3-nohp',
    slug: 'tier3_nohp',
    login_email: 'nohp@example.com',
    real_name: 'Orphan Member',
    email_verified_at: null,
  });

  // ── Scenario 6b: variant match but surname mismatch ─────────────────────
  // Curated display-name pair links "Boris Belouin Ollivier" → "Boris Belouin"
  // via name_variants, but the two names have different surnameKeys. The
  // downstream claim policy would refuse, so the classifier must downgrade to
  // tier3/hp_mismatch rather than sending the user to a page that will
  // surface a 422.
  insertLegacyMember(db, {
    legacy_member_id: LEGACY_ID_SURNAME_SPLIT,
    legacy_email: 'split@example.com',
  });
  insertHistoricalPerson(db, {
    person_id:        HP_SURNAME_SPLIT,
    person_name:      'Boris Belouin',
    legacy_member_id: LEGACY_ID_SURNAME_SPLIT,
  });
  insertNameVariant(db, {
    canonical_normalized: 'boris belouin',
    variant_normalized:   'boris belouin ollivier',
  });
  insertMember(db, {
    id: 'mem-surname-split',
    slug: 'surname_split',
    login_email: 'split@example.com',
    real_name: 'Boris Belouin Ollivier',
    email_verified_at: null,
  });

  // ── Scenario 7: tier: 'none' ─────────────────────────────────────────────
  // No legacy_members row with this email.
  insertMember(db, {
    id: 'mem-none',
    slug: 'none_mem',
    login_email: 'unseen@example.com',
    real_name: 'Jordan Alpha',    // matches HP_EXACT by name, but no email anchor
    email_verified_at: null,
  });

  db.close();
  identitySvc = await import('../../src/services/identityAccessService');
  tokenSvc = await import('../../src/services/accountTokenService');
});

afterAll(() => cleanupTestDb(dbPath));

async function verifyFor(memberId: string) {
  const { rawToken } = tokenSvc.accountTokenService.issueToken({
    memberId,
    tokenType: 'email_verify',
    ttlHours: 24,
  });
  return identitySvc.identityAccessService.verifyEmailByToken(rawToken);
}

describe('verifyEmailByToken auto-link classification', () => {
  it('Tier 1: email match + HP provenance + unique exact name candidate', async () => {
    const result = await verifyFor('mem-tier1');
    expect(result).not.toBeNull();
    expect(result!.legacyMatch).not.toBeNull();
    expect(result!.autoLinkClassification).toMatchObject({
      tier: 'tier1',
      personId: HP_EXACT,
      personName: 'Jordan Alpha',
    });
  });

  it('Tier 2: email match + HP provenance + unique variant name candidate', async () => {
    const result = await verifyFor('mem-tier2');
    expect(result).not.toBeNull();
    expect(result!.legacyMatch).not.toBeNull();
    expect(result!.autoLinkClassification).toMatchObject({
      tier: 'tier2',
      personId: HP_VARIANT,
      personName: 'Alex Martínez',
      matchedVariantNormalized: 'alex martinez',
    });
  });

  it('Tier 3: multiple HP candidates for the same real_name never auto-link', async () => {
    const result = await verifyFor('mem-tier3-multi');
    expect(result!.autoLinkClassification).toEqual({
      tier: 'tier3',
      reason: 'multiple_name_candidates',
    });
  });

  it('Tier 3: email anchor + no name candidate', async () => {
    const result = await verifyFor('mem-tier3-nocand');
    expect(result!.autoLinkClassification).toEqual({
      tier: 'tier3',
      reason: 'no_name_candidate',
    });
  });

  it('Tier 3: name candidate points to a different HP than the email provenance', async () => {
    const result = await verifyFor('mem-tier3-mismatch');
    expect(result!.autoLinkClassification).toEqual({
      tier: 'tier3',
      reason: 'hp_mismatch',
    });
  });

  it('Tier 3: email anchor exists but no HP back-links to the legacy account', async () => {
    const result = await verifyFor('mem-tier3-nohp');
    expect(result!.autoLinkClassification).toEqual({
      tier: 'tier3',
      reason: 'no_hp_for_legacy_account',
    });
  });

  it('Tier 3: variant match whose surnames do not align by claim-policy surnameKey', async () => {
    // The name_variants row says these two forms are the same person, but
    // claim policy (lookupHistoricalPersonForClaim) surname-blocks the pair.
    // Classifier must refuse tier1/tier2 so the UX does not route the user
    // to an endpoint that will reject them.
    const result = await verifyFor('mem-surname-split');
    expect(result!.autoLinkClassification).toEqual({
      tier: 'tier3',
      reason: 'hp_mismatch',
    });
  });

  it("tier: 'none' when no email anchor exists, even when the real_name would have matched an HP", async () => {
    const result = await verifyFor('mem-none');
    expect(result!.legacyMatch).toBeNull();
    expect(result!.autoLinkClassification).toEqual({ tier: 'none' });
  });

  it('preserves existing legacyMatch field shape on Tier 1 path (regression)', async () => {
    const result = await verifyFor('mem-tier1');
    expect(result!.legacyMatch).toMatchObject({
      legacyMemberId: LEGACY_ID_EXACT,
      displayName: expect.any(String),
    });
  });

  it('returns null on an invalid token (regression: base flow preserved)', async () => {
    const result = await identitySvc.identityAccessService.verifyEmailByToken('not-a-real-token');
    expect(result).toBeNull();
  });

  it('does not write name_variants or create auto-links during verify', async () => {
    const before = new BetterSqlite3(dbPath, { readonly: true });
    const counts = {
      variants:  (before.prepare('SELECT COUNT(*) AS n FROM name_variants').get() as { n: number }).n,
      claimedHp: (before.prepare(
        'SELECT COUNT(*) AS n FROM members WHERE historical_person_id IS NOT NULL',
      ).get() as { n: number }).n,
      claimedLm: (before.prepare(
        'SELECT COUNT(*) AS n FROM members WHERE legacy_member_id IS NOT NULL',
      ).get() as { n: number }).n,
    };
    before.close();

    await verifyFor('mem-tier1');
    await verifyFor('mem-tier2');
    await verifyFor('mem-tier3-mismatch');

    const after = new BetterSqlite3(dbPath, { readonly: true });
    const counts2 = {
      variants:  (after.prepare('SELECT COUNT(*) AS n FROM name_variants').get() as { n: number }).n,
      claimedHp: (after.prepare(
        'SELECT COUNT(*) AS n FROM members WHERE historical_person_id IS NOT NULL',
      ).get() as { n: number }).n,
      claimedLm: (after.prepare(
        'SELECT COUNT(*) AS n FROM members WHERE legacy_member_id IS NOT NULL',
      ).get() as { n: number }).n,
    };
    after.close();

    expect(counts2).toEqual(counts);
  });
});
