/**
 * Auto-link scenario pack.
 *
 * Representative fixture matrix exercising every branch of
 * `classifyAutoLink` + `getAutoLinkClassificationForMember` and every
 * downstream verify redirect. The matrix consolidates the branches scattered
 * across the per-case tests in one table-driven suite. Names are chosen to
 * resemble real competitor patterns (BAP honorees, diacritic-bearing
 * European names, display-name shortenings, compound surnames).
 *
 * | # | Scenario id              | Member real_name            | HP person_name                | Variant row                                | Expected tier                      | Expected verify redirect   | Driver     |
 * |---|--------------------------|-----------------------------|-------------------------------|--------------------------------------------|------------------------------------|----------------------------|------------|
 * | 1 | `none`                   | Matti Lehto                 | Matti Lehto                   | —                                          | `none`                             | `/members/sc_none`         | verify     |
 * | 2 | `tier1`                  | Kenny Shults                | Kenny Shults                  | —                                          | `tier1`                            | `/history/auto-link`       | verify     |
 * | 3 | `tier2_diacritic`        | Alex Martinez               | Alex Martínez                 | `alex martinez ↔ alex martínez`            | `tier2`                            | `/history/auto-link`       | verify     |
 * | 4 | `tier2_display_name`     | Chris Siebert               | Christopher Michael Siebert   | `chris siebert ↔ christopher michael …`    | `tier2`                            | `/history/auto-link`       | verify     |
 * | 5 | `tier3_no_hp`            | Jesper Karlsson             | — (legacy row exists, no HP)  | —                                          | `tier3 / no_hp_for_legacy_account` | `/history/claim`           | verify     |
 * | 6 | `tier3_no_name`          | Completely Different Name   | Provenance Target             | —                                          | `tier3 / no_name_candidate`        | `/history/claim`           | verify     |
 * | 7 | `tier3_multi`            | Pat Common                  | Pat Common (x2)               | —                                          | `tier3 / multiple_name_candidates` | `/history/claim`           | verify     |
 * | 8 | `tier3_hp_mismatch_decoy`| Decoy Claimer               | Correct Owner                 | —                                          | `tier3 / hp_mismatch`              | `/history/claim`           | verify     |
 * | 9 | `tier3_surname_split`    | Boris Belouin Ollivier      | Boris Belouin                 | `boris belouin ↔ boris belouin ollivier`   | `tier3 / hp_mismatch`              | `/history/claim`           | verify     |
 * |10 | `already_linked`         | Linked Already              | —                             | —                                          | `none` (already has link)          | n/a                        | direct     |
 * |11 | `missing_login_email`    | (irrelevant)                | —                             | —                                          | `none` (member not found)          | n/a                        | direct     |
 *
 * `verify` driver: seed → issue email_verify token → GET /verify/:token → assert redirect.
 * `direct` driver: seed → call `identityAccessService.getAutoLinkClassificationForMember(memberId)` → assert tier.
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  insertMember,
  insertHistoricalPerson,
  insertLegacyMember,
  insertNameVariant,
} from './factories';

export type ExpectedBranch =
  | 'none'
  | 'tier1'
  | 'tier2'
  | 'tier3_no_hp_for_legacy_account'
  | 'tier3_no_name_candidate'
  | 'tier3_multiple_name_candidates'
  | 'tier3_hp_mismatch'
  | 'already_linked'
  | 'missing_login_email';

export interface AutoLinkScenario {
  /** Member ID and fixture key. */
  id: string;
  /** URL slug for the seeded member. */
  slug: string;
  /** One-line description shown in test names / audit output. */
  description: string;
  /** Expected classification branch. */
  expected: ExpectedBranch;
  /** Expected post-verify redirect, or null for scenarios exercised directly. */
  expectedVerifyRedirect: string | null;
  /**
   * How the scenario is exercised:
   *   - 'verify' — through the full /verify/:token → redirect flow
   *   - 'direct' — by calling getAutoLinkClassificationForMember directly
   *               (for branches that can't be reached organically: already
   *                linked, missing login_email).
   */
  driver: 'verify' | 'direct';
  /** Seed DB rows for this scenario; returns the member ID. */
  seed: (db: BetterSqlite3.Database) => string;
}

export const AUTO_LINK_SCENARIOS: AutoLinkScenario[] = [
  // ── 1. none ──────────────────────────────────────────────────────────────
  {
    id: 'sc-none',
    slug: 'sc_none',
    description: 'No legacy_members row matches login_email; real_name alone is insufficient.',
    expected: 'none',
    expectedVerifyRedirect: '/members/sc_none',
    driver: 'verify',
    seed: (db) => {
      // An unrelated HP exists — proves name similarity alone is not an anchor.
      insertHistoricalPerson(db, { person_id: 'hp-sc-none-decoy', person_name: 'Matti Lehto' });
      insertMember(db, {
        id: 'sc-none',
        slug: 'sc_none',
        login_email: 'sc-none@example.com',
        real_name: 'Matti Lehto',
        email_verified_at: null,
      });
      return 'sc-none';
    },
  },

  // ── 2. tier1 — exact name match ──────────────────────────────────────────
  {
    id: 'sc-tier1',
    slug: 'sc_tier1',
    description: 'Email anchor + HP provenance + exact name match (BAP honoree).',
    expected: 'tier1',
    expectedVerifyRedirect: '/history/auto-link',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-tier1', legacy_email: 'sc-tier1@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-tier1',
        person_name: 'Kenny Shults',
        legacy_member_id: 'lm-sc-tier1',
      });
      insertMember(db, {
        id: 'sc-tier1',
        slug: 'sc_tier1',
        login_email: 'sc-tier1@example.com',
        real_name: 'Kenny Shults',
        email_verified_at: null,
      });
      return 'sc-tier1';
    },
  },

  // ── 3. tier2 — diacritic variant ─────────────────────────────────────────
  {
    id: 'sc-tier2-diacritic',
    slug: 'sc_tier2_diacritic',
    description: 'ASCII-folded name resolves to diacritic-bearing canonical via name_variants.',
    expected: 'tier2',
    expectedVerifyRedirect: '/history/auto-link',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-tier2-dia', legacy_email: 'sc-tier2-dia@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-tier2-dia',
        person_name: 'Alex Martínez',
        legacy_member_id: 'lm-sc-tier2-dia',
      });
      insertNameVariant(db, {
        canonical_normalized: 'alex martínez',
        variant_normalized:   'alex martinez',
      });
      insertMember(db, {
        id: 'sc-tier2-diacritic',
        slug: 'sc_tier2_diacritic',
        login_email: 'sc-tier2-dia@example.com',
        real_name: 'Alex Martinez',
        email_verified_at: null,
      });
      return 'sc-tier2-diacritic';
    },
  },

  // ── 4. tier2 — display-name shortening ───────────────────────────────────
  {
    id: 'sc-tier2-display',
    slug: 'sc_tier2_display',
    description: 'Informal display name resolves to full legal canonical via curated display_name variant.',
    expected: 'tier2',
    expectedVerifyRedirect: '/history/auto-link',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-tier2-disp', legacy_email: 'sc-tier2-disp@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-tier2-disp',
        person_name: 'Christopher Michael Siebert',
        legacy_member_id: 'lm-sc-tier2-disp',
      });
      insertNameVariant(db, {
        canonical_normalized: 'christopher michael siebert',
        variant_normalized:   'christopher siebert',
      });
      insertMember(db, {
        id: 'sc-tier2-display',
        slug: 'sc_tier2_display',
        login_email: 'sc-tier2-disp@example.com',
        real_name: 'Christopher Siebert',
        email_verified_at: null,
      });
      return 'sc-tier2-display';
    },
  },

  // ── 5. tier3 no_hp_for_legacy_account ────────────────────────────────────
  {
    id: 'sc-tier3-no-hp',
    slug: 'sc_tier3_no_hp',
    description: 'Email anchor matches a legacy_members row, but no HP back-links to it.',
    expected: 'tier3_no_hp_for_legacy_account',
    expectedVerifyRedirect: '/history/claim',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-nohp', legacy_email: 'sc-nohp@example.com' });
      insertMember(db, {
        id: 'sc-tier3-no-hp',
        slug: 'sc_tier3_no_hp',
        login_email: 'sc-nohp@example.com',
        real_name: 'Jesper Karlsson',
        email_verified_at: null,
      });
      return 'sc-tier3-no-hp';
    },
  },

  // ── 6. tier3 no_name_candidate ───────────────────────────────────────────
  {
    id: 'sc-tier3-no-name',
    slug: 'sc_tier3_no_name',
    description: 'Email anchor + HP provenance, but real_name matches no HP directly or via variants.',
    expected: 'tier3_no_name_candidate',
    expectedVerifyRedirect: '/history/claim',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-noname', legacy_email: 'sc-noname@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-noname',
        person_name: 'Provenance Target',
        legacy_member_id: 'lm-sc-noname',
      });
      insertMember(db, {
        id: 'sc-tier3-no-name',
        slug: 'sc_tier3_no_name',
        login_email: 'sc-noname@example.com',
        real_name: 'Completely Different Name',
        email_verified_at: null,
      });
      return 'sc-tier3-no-name';
    },
  },

  // ── 7. tier3 multiple_name_candidates ────────────────────────────────────
  {
    id: 'sc-tier3-multi',
    slug: 'sc_tier3_multi',
    description: 'Email anchor + HP provenance, but two HPs share the normalized name.',
    expected: 'tier3_multiple_name_candidates',
    expectedVerifyRedirect: '/history/claim',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-multi', legacy_email: 'sc-multi@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-multi-a',
        person_name: 'Pat Common',
        legacy_member_id: 'lm-sc-multi',
      });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-multi-b',
        person_name: 'Pat Common',
      });
      insertMember(db, {
        id: 'sc-tier3-multi',
        slug: 'sc_tier3_multi',
        login_email: 'sc-multi@example.com',
        real_name: 'Pat Common',
        email_verified_at: null,
      });
      return 'sc-tier3-multi';
    },
  },

  // ── 8. tier3 hp_mismatch (decoy path) ────────────────────────────────────
  {
    id: 'sc-tier3-decoy',
    slug: 'sc_tier3_decoy',
    description: 'Email provenances to one HP, but real_name resolves to a different HP.',
    expected: 'tier3_hp_mismatch',
    expectedVerifyRedirect: '/history/claim',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-decoy', legacy_email: 'sc-decoy@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-decoy-actual',
        person_name: 'Correct Owner',
        legacy_member_id: 'lm-sc-decoy',
      });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-decoy-decoy',
        person_name: 'Decoy Claimer',
      });
      insertMember(db, {
        id: 'sc-tier3-decoy',
        slug: 'sc_tier3_decoy',
        login_email: 'sc-decoy@example.com',
        real_name: 'Decoy Claimer',
        email_verified_at: null,
      });
      return 'sc-tier3-decoy';
    },
  },

  // ── 9. tier3 hp_mismatch via surname-split (surnameKey block) ────────────
  {
    id: 'sc-tier3-surname-split',
    slug: 'sc_tier3_surname_split',
    description: 'name_variants row links two forms whose surnameKeys differ; classifier defers to claim policy.',
    expected: 'tier3_hp_mismatch',
    expectedVerifyRedirect: '/history/claim',
    driver: 'verify',
    seed: (db) => {
      insertLegacyMember(db, { legacy_member_id: 'lm-sc-split', legacy_email: 'sc-split@example.com' });
      insertHistoricalPerson(db, {
        person_id: 'hp-sc-split',
        person_name: 'Boris Belouin',
        legacy_member_id: 'lm-sc-split',
      });
      insertNameVariant(db, {
        canonical_normalized: 'boris belouin',
        variant_normalized:   'boris belouin ollivier',
      });
      insertMember(db, {
        id: 'sc-tier3-surname-split',
        slug: 'sc_tier3_surname_split',
        login_email: 'sc-split@example.com',
        real_name: 'Boris Belouin Ollivier',
        email_verified_at: null,
      });
      return 'sc-tier3-surname-split';
    },
  },

  // ── 10. already linked ──────────────────────────────────────────────────
  {
    id: 'sc-already-linked',
    slug: 'sc_already_linked',
    description: 'Member already holds a historical_person_id; classifier refuses to re-offer a link.',
    expected: 'already_linked',
    expectedVerifyRedirect: null,
    driver: 'direct',
    seed: (db) => {
      insertHistoricalPerson(db, { person_id: 'hp-sc-prelink', person_name: 'Linked Already' });
      insertMember(db, {
        id: 'sc-already-linked',
        slug: 'sc_already_linked',
        login_email: 'sc-prelink@example.com',
        real_name: 'Linked Already',
        email_verified_at: '2025-01-01T00:00:00.000Z',
      });
      // Mutate to simulate an existing claim.
      db.prepare('UPDATE members SET historical_person_id = ? WHERE id = ?')
        .run('hp-sc-prelink', 'sc-already-linked');
      return 'sc-already-linked';
    },
  },

  // ── 11. missing login_email (member not found on re-classification) ─────
  {
    id: 'sc-missing-email',
    slug: 'sc_missing_email',
    description: 'getAutoLinkClassificationForMember called with an unknown member_id; returns none.',
    expected: 'missing_login_email',
    expectedVerifyRedirect: null,
    driver: 'direct',
    seed: (_db) => {
      // No rows; the scenario queries a non-existent member_id.
      return 'sc-missing-email-nonexistent';
    },
  },
];

export function seedAllScenarios(db: BetterSqlite3.Database): void {
  for (const sc of AUTO_LINK_SCENARIOS) {
    sc.seed(db);
  }
}
