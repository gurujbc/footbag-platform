/**
 * Auto-link metrics report — simulated outcome distribution.
 *
 * Read-only. Prints the tier1/tier2/tier3/none distribution that WOULD
 * result if every `legacy_members` row became a registrant whose
 * `real_name` equalled its provenance HP's canonical name. This gives a
 * same-day forecast of where the classifier will land once the legacy-site
 * data dump populates `legacy_members.legacy_email` (the current data
 * block — production activity is zero today).
 *
 * Log-based metrics would be preferable, but `logger.info(...)` output is
 * not persisted to a queryable store on this host. DB simulation uses the
 * same classification rules as `identityAccessService.classifyAutoLink`
 * (email anchor → HP provenance → unique name candidate → surnameKey
 * equality). Numbers are upper bounds; real registrants' `real_name` will
 * drift from canonical, reducing tier1/tier2 by some unknown factor.
 *
 * Usage:
 *   npx tsx scripts/report-autolink-metrics.ts [--db path/to/footbag.db]
 *
 * Default DB path: ./database/footbag.db
 */
import BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_DB = path.resolve(__dirname, '..', 'database', 'footbag.db');

function parseArgs(): { db: string } {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--db');
  return { db: i >= 0 ? argv[i + 1] : DEFAULT_DB };
}

// NFKC + lower + collapse + trim. Mirrors
// `src/services/nameVariantsService.ts::normalizeForMatch` and
// `legacy_data/scripts/load_name_variants_seed.py::db_normalize`.
function normalizeForMatch(raw: string): string {
  const nfkc = (raw ?? '').normalize('NFKC').toLowerCase().trim();
  if (!nfkc) return '';
  return nfkc.split(/\s+/).filter(Boolean).join(' ');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// Mirrors `src/services/identityAccessService.ts::surnameKey`.
function surnameKey(name: string | null | undefined): string {
  if (!name) return '';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? '';
  return stripAccents(last).toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface LegacyMember { legacy_member_id: string; legacy_email: string | null; }
interface HistoricalPerson { person_id: string; person_name: string; legacy_member_id: string | null; }
interface NameVariant { canonical_normalized: string; variant_normalized: string; }

function hrule() { console.log('─'.repeat(70)); }

function formatRow(label: string, value: string | number, hint?: string): void {
  const left = label.padEnd(48, ' ');
  const right = String(value).padStart(7, ' ');
  console.log(`  ${left}${right}${hint ? '   ' + hint : ''}`);
}

function main(): number {
  const { db: dbPath } = parseArgs();
  if (!existsSync(dbPath)) {
    console.error(`ERROR: DB not found at ${dbPath}`);
    return 1;
  }
  const db = new BetterSqlite3(dbPath, { readonly: true });

  const legacyMembers = db.prepare(
    `SELECT legacy_member_id, legacy_email FROM legacy_members`,
  ).all() as LegacyMember[];
  const historicalPersons = db.prepare(
    `SELECT person_id, person_name, legacy_member_id FROM historical_persons`,
  ).all() as HistoricalPerson[];
  const nameVariants = db.prepare(
    `SELECT canonical_normalized, variant_normalized FROM name_variants`,
  ).all() as NameVariant[];

  db.close();

  // Indices.
  const hpByLegacyId = new Map<string, HistoricalPerson>();
  for (const hp of historicalPersons) {
    if (hp.legacy_member_id) hpByLegacyId.set(hp.legacy_member_id, hp);
  }
  const hpByNormalizedName = new Map<string, HistoricalPerson[]>();
  for (const hp of historicalPersons) {
    const key = normalizeForMatch(hp.person_name);
    if (!key) continue;
    const list = hpByNormalizedName.get(key) ?? [];
    list.push(hp);
    hpByNormalizedName.set(key, list);
  }

  // Simulate: each legacy_member → synthetic registrant whose real_name
  // equals the provenance HP's canonical name.
  const buckets: Record<string, number> = {
    tier1: 0,
    tier2: 0,
    tier3_no_hp_for_legacy_account: 0,
    tier3_no_name_candidate: 0,
    tier3_multiple_name_candidates: 0,
    tier3_hp_mismatch: 0,
    none: 0,
  };

  for (const lm of legacyMembers) {
    const hp = hpByLegacyId.get(lm.legacy_member_id);
    if (!hp) {
      // Provenance missing → tier3/no_hp when an email anchor lands. Without
      // email, the real classifier would return 'none', but for activation-
      // forecast purposes we count these as the tier they WILL produce once
      // emails attach.
      buckets.tier3_no_hp_for_legacy_account++;
      continue;
    }

    // Synthetic real_name = HP.person_name. This is the BEST case. Real
    // registrants will type variants or wrong names, producing more tier3s.
    const input = normalizeForMatch(hp.person_name);
    const canonicalForms = new Set<string>();
    canonicalForms.add(input);
    for (const nv of nameVariants) {
      if (nv.variant_normalized === input) canonicalForms.add(nv.canonical_normalized);
      if (nv.canonical_normalized === input) canonicalForms.add(nv.variant_normalized);
    }

    const candidateHps = new Map<string, HistoricalPerson>();
    let sawExact = false;
    for (const canon of canonicalForms) {
      const hps = hpByNormalizedName.get(canon) ?? [];
      for (const c of hps) {
        candidateHps.set(c.person_id, c);
        if (canon === input) sawExact = true;
      }
    }

    if (candidateHps.size === 0) {
      buckets.tier3_no_name_candidate++;
      continue;
    }
    if (candidateHps.size > 1) {
      buckets.tier3_multiple_name_candidates++;
      continue;
    }
    const only = [...candidateHps.values()][0]!;
    if (only.person_id !== hp.person_id) {
      buckets.tier3_hp_mismatch++;
      continue;
    }
    if (surnameKey(hp.person_name) !== surnameKey(only.person_name)) {
      buckets.tier3_hp_mismatch++;
      continue;
    }
    if (sawExact) buckets.tier1++;
    else          buckets.tier2++;
  }

  // Complementary simulation: registrants whose real_name MATCHES a variant
  // form (not the canonical). For each name_variants row where the canonical
  // HP has provenance, count as tier2 eligible iff surnameKey aligns with
  // the canonical HP (matching the classifier's tightened rule).
  let variant_tier2_eligible = 0;
  let variant_surname_blocked = 0;
  for (const nv of nameVariants) {
    const hps = hpByNormalizedName.get(nv.canonical_normalized) ?? [];
    const provenanceHps = hps.filter((h) => h.legacy_member_id !== null);
    if (provenanceHps.length !== 1) continue;
    const hp = provenanceHps[0]!;
    if (surnameKey(nv.variant_normalized) === surnameKey(hp.person_name)) {
      variant_tier2_eligible++;
    } else {
      variant_surname_blocked++;
    }
  }

  // Report.
  const total = legacyMembers.length;
  console.log();
  console.log('  Auto-link metrics report (simulated from DB state)');
  console.log(`  DB: ${dbPath}`);
  console.log(`  simulated population: legacy_members (${total} rows), each treated as`);
  console.log('  a prospective registrant with real_name = provenance HP canonical name.');
  hrule();
  console.log('  Projected tier distribution');
  hrule();
  formatRow('tier1 (exact name match eligible for auto-link)', buckets.tier1);
  formatRow('tier2 (variant-assisted match eligible for auto-link)', buckets.tier2);
  const tier3Total =
    buckets.tier3_no_hp_for_legacy_account +
    buckets.tier3_no_name_candidate +
    buckets.tier3_multiple_name_candidates +
    buckets.tier3_hp_mismatch;
  formatRow('tier3 (review / manual claim required)', tier3Total);
  hrule();
  console.log('  tier3 breakdown by reason');
  hrule();
  formatRow('tier3 / no_hp_for_legacy_account', buckets.tier3_no_hp_for_legacy_account);
  formatRow('tier3 / no_name_candidate',        buckets.tier3_no_name_candidate);
  formatRow('tier3 / multiple_name_candidates', buckets.tier3_multiple_name_candidates);
  formatRow('tier3 / hp_mismatch',              buckets.tier3_hp_mismatch);
  hrule();
  console.log('  Variant-form registrants (complementary simulation)');
  hrule();
  formatRow('name_variants → tier2 eligible (surname aligned)', variant_tier2_eligible);
  formatRow('name_variants surname-blocked (downgrade to tier3/hp_mismatch)', variant_surname_blocked);
  hrule();
  console.log();
  console.log('  Note: figures project the upper bound for best-case registrants');
  console.log('  whose real_name matches HP canonical. Drift from canonical will');
  console.log('  reduce tier1/tier2 and increase tier3. Production today reports');
  console.log('  all "none" due to legacy_members.legacy_email being NULL.');
  console.log();

  return 0;
}

process.exit(main());
