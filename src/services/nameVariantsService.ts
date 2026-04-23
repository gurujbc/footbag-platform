/**
 * Auto-link candidate generation from the `name_variants` table.
 *
 * Read-only helper. Given a member's real_name, returns the set of
 * historical_persons whose canonical name matches either:
 *   - the input directly (exact canonical hit), or
 *   - a canonical form reached through the symmetric `name_variants` table
 *     (variant hit).
 *
 * The service does NOT auto-link. It does not create, modify, or persist
 * any relationship. The caller composes this with the email-anchor check
 * (MIGRATION_PLAN §7 tier classifier) to decide what, if anything, to do.
 *
 * HIGH-only enforcement lives at load time (see
 * `legacy_data/scripts/load_name_variants_seed.py`). Rows present in the
 * DB are production-eligible by construction; this read path trusts that
 * invariant and does not re-filter.
 */
import { nameVariants as nameVariantsDb } from '../db/db';

export interface AutoLinkCandidate {
  personId: string;
  personName: string;
  matchKind: 'exact' | 'variant';
  matchedCanonicalNormalized: string;
  /** Present only when matchKind === 'variant'. */
  matchedVariantNormalized?: string;
}

/**
 * NFKC + lowercase + trim + collapse-internal-whitespace.
 *
 * This is the same rule applied by `load_name_variants_seed.py::db_normalize`
 * at load time and documented on the `name_variants` table in
 * `database/schema.sql`. Every comparison against stored rows must route
 * through this function.
 */
export function normalizeForMatch(raw: string): string {
  const nfkc = (raw ?? '').normalize('NFKC').toLowerCase().trim();
  if (!nfkc) return '';
  return nfkc.split(/\s+/).filter(Boolean).join(' ');
}

interface NameVariantRow {
  canonical_normalized: string;
  variant_normalized: string;
}

interface HistoricalPersonRow {
  person_id: string;
  person_name: string;
}

/**
 * Return historical-person auto-link candidates for a given real_name.
 *
 * Semantics:
 *   - Empty or whitespace-only input returns `[]`.
 *   - An HP reachable both directly (exact) and via a variant is reported
 *     once with `matchKind='exact'` (exact wins).
 *   - Multiple HPs reachable through the same canonical form are all
 *     returned; the caller decides how to present (Tier 3 admin review
 *     per MIGRATION_PLAN §7 when ambiguity remains at the email step).
 *   - Results are sorted by `personId` for stable ordering.
 */
export function findAutoLinkCandidates(realName: string): AutoLinkCandidate[] {
  const input = normalizeForMatch(realName);
  if (!input) return [];

  // The normalized input is itself the first canonical form to try.
  // Symmetric lookups contribute additional canonical forms.
  const canonicalForms = new Map<string, string | undefined>();
  canonicalForms.set(input, undefined); // exact hit, no variant row involved

  const variantRows = nameVariantsDb.findByEitherColumn.all(
    input,
    input,
  ) as NameVariantRow[];
  for (const row of variantRows) {
    const other =
      row.canonical_normalized === input
        ? row.variant_normalized
        : row.canonical_normalized;
    // Preserve an existing entry: if `other` was already reached exactly
    // (e.g. input == other somehow), keep `undefined` so it's classified exact.
    if (!canonicalForms.has(other)) {
      canonicalForms.set(other, row.variant_normalized);
    }
  }

  const byPerson = new Map<string, AutoLinkCandidate>();
  for (const [canonical, matchedVariantNormalized] of canonicalForms) {
    const hpRows = nameVariantsDb.findHistoricalPersonsByNormalizedName.all(
      canonical,
    ) as HistoricalPersonRow[];
    const isExact = canonical === input;
    for (const hp of hpRows) {
      const existing = byPerson.get(hp.person_id);
      if (existing && existing.matchKind === 'exact') {
        continue; // exact wins over variant
      }
      byPerson.set(hp.person_id, {
        personId: hp.person_id,
        personName: hp.person_name,
        matchKind: isExact ? 'exact' : 'variant',
        matchedCanonicalNormalized: canonical,
        ...(isExact ? {} : { matchedVariantNormalized }),
      });
    }
  }

  return [...byPerson.values()].sort((a, b) =>
    a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0,
  );
}
