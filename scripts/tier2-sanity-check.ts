/**
 * Tier-2 sanity checker.
 *
 * Read-only diagnostic. Iterates every `name_variants` row whose canonical
 * HP has `legacy_member_id` provenance (the Tier-2-ready pool) and flags:
 *
 *   - variant/canonical surname-key mismatches (classifier would downgrade
 *     to tier3/hp_mismatch — expected behavior, but worth listing so the
 *     loaded seed can be reviewed)
 *   - canonical HP names that collide with another HP's normalized name
 *     (would force tier3/multiple_name_candidates even though the variant
 *     pair itself is clean)
 *
 * Exit code is always 0 — this is reporting, not a gate.
 *
 * Usage:
 *   npx tsx scripts/tier2-sanity-check.ts [--db path/to/footbag.db]
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

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// Mirrors src/services/identityAccessService.ts::surnameKey.
function surnameKey(name: string | null | undefined): string {
  if (!name) return '';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? '';
  return stripAccents(last).toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface HistoricalPerson { person_id: string; person_name: string; legacy_member_id: string | null; }
interface NameVariant { canonical_normalized: string; variant_normalized: string; }

interface SurnameFlag {
  variant: string;
  canonical_hp: string;
  person_id: string;
  variant_surname: string;
  canonical_surname: string;
}

interface CollisionFlag {
  canonical_normalized: string;
  colliding_hp_names: string[];
  colliding_person_ids: string[];
}

function hrule() { console.log('─'.repeat(78)); }

function main(): number {
  const { db: dbPath } = parseArgs();
  if (!existsSync(dbPath)) {
    console.error(`ERROR: DB not found at ${dbPath}`);
    return 1;
  }
  const db = new BetterSqlite3(dbPath, { readonly: true });

  const historicalPersons = db.prepare(
    `SELECT person_id, person_name, legacy_member_id FROM historical_persons`,
  ).all() as HistoricalPerson[];
  const nameVariants = db.prepare(
    `SELECT canonical_normalized, variant_normalized FROM name_variants`,
  ).all() as NameVariant[];
  db.close();

  const hpByNormalizedName = new Map<string, HistoricalPerson[]>();
  for (const hp of historicalPersons) {
    const key = normalizeForMatch(hp.person_name);
    if (!key) continue;
    const list = hpByNormalizedName.get(key) ?? [];
    list.push(hp);
    hpByNormalizedName.set(key, list);
  }

  const tier2Ready: Array<{ nv: NameVariant; hp: HistoricalPerson }> = [];
  for (const nv of nameVariants) {
    const hps = hpByNormalizedName.get(nv.canonical_normalized) ?? [];
    for (const hp of hps) {
      if (hp.legacy_member_id) tier2Ready.push({ nv, hp });
    }
  }

  const surnameFlags: SurnameFlag[] = [];
  const collisionFlags: CollisionFlag[] = [];
  const seenCollisionCanonicals = new Set<string>();

  for (const { nv, hp } of tier2Ready) {
    const v_sk = surnameKey(nv.variant_normalized);
    const c_sk = surnameKey(hp.person_name);
    if (v_sk !== c_sk) {
      surnameFlags.push({
        variant: nv.variant_normalized,
        canonical_hp: hp.person_name,
        person_id: hp.person_id,
        variant_surname: v_sk,
        canonical_surname: c_sk,
      });
    }

    const hps = hpByNormalizedName.get(nv.canonical_normalized) ?? [];
    if (hps.length > 1 && !seenCollisionCanonicals.has(nv.canonical_normalized)) {
      seenCollisionCanonicals.add(nv.canonical_normalized);
      collisionFlags.push({
        canonical_normalized: nv.canonical_normalized,
        colliding_hp_names: hps.map((h) => h.person_name),
        colliding_person_ids: hps.map((h) => h.person_id),
      });
    }
  }

  // Output.
  console.log();
  console.log('  Tier-2 sanity checker');
  console.log(`  DB: ${dbPath}`);
  console.log(`  Tier-2-ready pairs scanned: ${tier2Ready.length}`);
  hrule();

  if (surnameFlags.length === 0) {
    console.log('  surnameKey alignment: CLEAN (0 rows flagged)');
  } else {
    console.log(`  surnameKey mismatches (${surnameFlags.length}) — classifier downgrades to tier3/hp_mismatch:`);
    for (const f of surnameFlags) {
      console.log(
        `    ${f.variant.padEnd(40, ' ')} → ${f.canonical_hp.padEnd(32, ' ')} ` +
        `(${f.variant_surname} ≠ ${f.canonical_surname})`,
      );
    }
  }
  hrule();

  if (collisionFlags.length === 0) {
    console.log('  canonical HP collisions: CLEAN (0 groups flagged)');
  } else {
    console.log(`  canonical HP collisions (${collisionFlags.length}) — tier3/multiple_name_candidates:`);
    for (const f of collisionFlags) {
      console.log(`    ${f.canonical_normalized}`);
      for (let i = 0; i < f.colliding_hp_names.length; i++) {
        console.log(`      · ${f.colliding_hp_names[i]} (${f.colliding_person_ids[i]})`);
      }
    }
  }
  hrule();
  console.log();
  return 0;
}

process.exit(main());
