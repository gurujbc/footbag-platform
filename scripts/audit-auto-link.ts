/**
 * Dry-run audit for the verify-time auto-link flow.
 *
 * Read-only. Inspects the local SQLite DB and prints per-bucket counts that
 * estimate the upper bound on how many registered members would be eligible
 * for each classification branch, plus a composite outcome estimate.
 *
 * Does NOT modify the DB. Does NOT run any service code. Uses app-side NFKC
 * normalization for app↔DB parity with the production read path.
 *
 * Usage:
 *   npx tsx scripts/audit-auto-link.ts [--db path/to/footbag.db]
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

function normalizeForMatch(raw: string): string {
  const nfkc = (raw ?? '').normalize('NFKC').toLowerCase().trim();
  if (!nfkc) return '';
  return nfkc.split(/\s+/).filter(Boolean).join(' ');
}

interface Member {
  id: string;
  login_email: string | null;
  real_name: string | null;
  legacy_member_id: string | null;
  historical_person_id: string | null;
}
interface LegacyMember {
  legacy_member_id: string;
  legacy_email: string | null;
}
interface HistoricalPerson {
  person_id: string;
  person_name: string;
  legacy_member_id: string | null;
}
interface NameVariant {
  canonical_normalized: string;
  variant_normalized: string;
}

function hrule() { console.log('─'.repeat(78)); }

function formatRow(label: string, value: string | number, hint?: string): void {
  const leftWidth = 52;
  const left = label.padEnd(leftWidth, ' ');
  const right = String(value).padStart(7, ' ');
  console.log(`  ${left}${right}${hint ? '   ' + hint : ''}`);
}

function main(): number {
  const { db: dbPath } = parseArgs();
  if (!existsSync(dbPath)) {
    console.error(`ERROR: DB not found at ${dbPath}`);
    console.error(`Pass --db <path> to point at a different file.`);
    return 1;
  }

  const db = new BetterSqlite3(dbPath, { readonly: true });

  const members = db.prepare(`
    SELECT id, login_email, real_name, legacy_member_id, historical_person_id
    FROM members
    WHERE deleted_at IS NULL
  `).all() as Member[];

  const legacyMembers = db.prepare(`
    SELECT legacy_member_id, legacy_email
    FROM legacy_members
  `).all() as LegacyMember[];

  const historicalPersons = db.prepare(`
    SELECT person_id, person_name, legacy_member_id
    FROM historical_persons
  `).all() as HistoricalPerson[];

  const nameVariants = db.prepare(`
    SELECT canonical_normalized, variant_normalized
    FROM name_variants
  `).all() as NameVariant[];

  // Indices.
  const legacyByEmail = new Map<string, LegacyMember>();
  for (const lm of legacyMembers) {
    if (lm.legacy_email) {
      legacyByEmail.set(lm.legacy_email.toLowerCase().trim(), lm);
    }
  }
  const hpByLegacyId = new Map<string, HistoricalPerson>();
  for (const hp of historicalPersons) {
    if (hp.legacy_member_id) {
      hpByLegacyId.set(hp.legacy_member_id, hp);
    }
  }
  const hpByNormalizedName = new Map<string, HistoricalPerson[]>();
  for (const hp of historicalPersons) {
    const key = normalizeForMatch(hp.person_name);
    if (!key) continue;
    const list = hpByNormalizedName.get(key) ?? [];
    list.push(hp);
    hpByNormalizedName.set(key, list);
  }

  // Per-member bucket membership.
  let n_members          = members.length;
  let n_already_linked   = 0;
  let n_no_real_name     = 0;
  let n_no_login_email   = 0;
  let n_email_anchor     = 0;
  let n_email_plus_hp    = 0;
  let n_exact_match      = 0;
  let n_variant_match    = 0;
  let n_multi_candidates = 0;

  // Estimated per-member classification outcomes.
  let est_tier1    = 0;
  let est_tier2    = 0;
  let est_tier3    = 0;
  let est_none     = 0;
  const tier3_reasons: Record<string, number> = {
    no_hp_for_legacy_account: 0,
    no_name_candidate: 0,
    multiple_name_candidates: 0,
    hp_mismatch: 0,
  };

  for (const m of members) {
    if (m.legacy_member_id || m.historical_person_id) {
      n_already_linked++;
      est_none++;
      continue;
    }
    if (!m.real_name || !m.real_name.trim()) {
      n_no_real_name++;
      est_none++;
      continue;
    }
    const loginEmail = (m.login_email ?? '').toLowerCase().trim();
    if (!loginEmail) {
      n_no_login_email++;
      est_none++;
      continue;
    }

    const anchor = legacyByEmail.get(loginEmail);
    if (!anchor) {
      est_none++;
      continue;
    }
    n_email_anchor++;

    const hp = hpByLegacyId.get(anchor.legacy_member_id);
    if (!hp) {
      est_tier3++;
      tier3_reasons.no_hp_for_legacy_account++;
      continue;
    }
    n_email_plus_hp++;

    // Build candidate set for this member via app-side normalizer.
    const input = normalizeForMatch(m.real_name);
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
      for (const candidate of hps) {
        candidateHps.set(candidate.person_id, candidate);
        if (canon === input) sawExact = true;
      }
    }

    if (candidateHps.size === 0) {
      est_tier3++;
      tier3_reasons.no_name_candidate++;
      continue;
    }
    if (candidateHps.size > 1) {
      n_multi_candidates++;
      est_tier3++;
      tier3_reasons.multiple_name_candidates++;
      continue;
    }
    const onlyHp = [...candidateHps.values()][0]!;
    if (onlyHp.person_id !== hp.person_id) {
      est_tier3++;
      tier3_reasons.hp_mismatch++;
      continue;
    }
    if (sawExact) {
      n_exact_match++;
      est_tier1++;
    } else {
      n_variant_match++;
      est_tier2++;
    }
  }

  // Table-level indicators that don't depend on member enrolment.
  const n_legacy_with_email = [...legacyByEmail.keys()].length;
  const n_legacy_with_hp    = hpByLegacyId.size;
  const n_hp_collision_groups = [...hpByNormalizedName.values()].filter((l) => l.length > 1).length;
  const n_hp_total          = historicalPersons.length;
  const n_variants_total    = nameVariants.length;

  // Output.
  console.log();
  console.log('  Auto-link dry-run audit');
  console.log(`  DB: ${dbPath}`);
  hrule();
  console.log('  Population');
  hrule();
  formatRow('members (active)',         n_members);
  formatRow('legacy_members total',     legacyMembers.length);
  formatRow('legacy_members with email',n_legacy_with_email);
  formatRow('historical_persons total', n_hp_total);
  formatRow('HPs with legacy_member_id (provenance)', n_legacy_with_hp);
  formatRow('name_variants rows (HIGH-only by loader contract)', n_variants_total);
  formatRow('HP normalized-name collision groups', n_hp_collision_groups,
    n_hp_collision_groups > 0 ? '(members resolving to these ⇒ tier3/multi)' : '');
  hrule();
  console.log('  Member-level prerequisite buckets');
  hrule();
  formatRow('already linked (has legacy_member_id or historical_person_id)', n_already_linked);
  formatRow('no real_name (empty or whitespace)', n_no_real_name);
  formatRow('no login_email', n_no_login_email);
  formatRow('email anchor exists (login_email ↔ legacy_members.legacy_email)', n_email_anchor);
  formatRow('email anchor + HP provenance exists', n_email_plus_hp);
  formatRow('exact-name HP match exists for real_name', n_exact_match);
  formatRow('variant-assisted HP match exists (HIGH only)', n_variant_match);
  formatRow('multiple HP candidates collision', n_multi_candidates);
  hrule();
  console.log('  Estimated classification outcome per member');
  hrule();
  formatRow('tier1 (exact match eligible for auto-link)', est_tier1);
  formatRow('tier2 (variant match eligible for auto-link)', est_tier2);
  formatRow('tier3 total', est_tier3);
  for (const [reason, count] of Object.entries(tier3_reasons)) {
    formatRow(`  tier3 / ${reason}`, count);
  }
  formatRow('none (no action / already linked / no email anchor)', est_none);
  hrule();
  console.log();

  db.close();
  return 0;
}

process.exit(main());
