/**
 * Canonical person-link resolution.
 *
 * Every page that links to a person (event results, history landing,
 * history detail teammates) must use this helper so the URL pattern
 * is consistent: members get `/members/{slug}`, everyone else gets
 * `/history/{personId}`.
 *
 * The SQL layer is responsible for resolving the member slug via the
 * claim chain (historical_persons.legacy_member_id → members.legacy_member_id).
 * This helper only formats the already-resolved values.
 */
export function personHref(
  memberSlug: string | null | undefined,
  historicalPersonId: string | null | undefined,
): string | null {
  if (memberSlug) return `/members/${memberSlug}`;
  if (historicalPersonId) return `/history/${historicalPersonId}`;
  return null;
}
