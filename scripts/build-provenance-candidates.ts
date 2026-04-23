/**
 * Provenance candidate builder.
 *
 * Read-only. Proposes likely `historical_persons.legacy_member_id` back-link
 * candidates by name-matching HPs that currently have no provenance against
 * `legacy_members`. No DB writes, no migrations, no schema changes, no claim
 * or classifier edits. Output is a review artifact for a human to approve.
 *
 * Matching rules (in priority order):
 *   HIGH / exact_normalized_unique
 *     HP's normalized name matches exactly one legacy_members row AND that
 *     legacy row is not claimed by any other HP in the output.
 *
 *   HIGH / variant_normalized_unique
 *     HP's normalized name maps through exactly one HIGH `name_variants` pair
 *     to exactly one legacy_members row AND that legacy row is not claimed
 *     by any other HP.
 *
 *   MEDIUM / ambiguous_multiple_legacy_matches
 *     HP resolves to 2+ legacy_members rows (same normalized name or multiple
 *     variant-assisted paths). One row per candidate is emitted with
 *     ambiguity_count = total candidates for that HP.
 *
 *   MEDIUM / ambiguous_multiple_hp_matches
 *     The legacy candidate is also claimed by another HP in this run. Both
 *     HPs are downgraded to MEDIUM with ambiguity_count = number of HPs
 *     contending for the legacy row.
 *
 * NEVER: fuzzy / Levenshtein / soundex / token-overlap heuristics. This pass
 * is intentionally conservative; under-matching beats false positives.
 *
 * Normalization: NFKC + lowercase + trim + collapse-whitespace. Matches
 * `src/services/nameVariantsService.ts::normalizeForMatch` so candidates are
 * directly consumable by the same classifier should they be approved.
 *
 * Usage:
 *   npx tsx scripts/build-provenance-candidates.ts [--db path/to/footbag.db]
 *
 * Output:
 *   legacy_data/out/provenance_candidates_high.csv
 *   legacy_data/out/provenance_candidates_medium.csv
 */
import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_DB = path.resolve(__dirname, '..', 'database', 'footbag.db');
const DEFAULT_OUT_DIR = path.resolve(__dirname, '..', 'legacy_data', 'out');

export type Confidence = 'HIGH' | 'MEDIUM';
export type Reason =
  | 'exact_normalized_unique'
  | 'variant_normalized_unique'
  | 'ambiguous_multiple_legacy_matches'
  | 'ambiguous_multiple_hp_matches';

export interface ProvenanceCandidate {
  historical_person_id: string;
  historical_person_name: string;
  candidate_legacy_member_id: string;
  candidate_legacy_name: string;
  confidence: Confidence;
  reason: Reason;
  ambiguity_count: number;
}

export interface Summary {
  hp_without_provenance: number;
  high_count: number;
  medium_count: number;
  unresolved: number;
  top_ambiguity_buckets: Array<{ normalized: string; size: number; example_ids: string[] }>;
}

interface HPRow { person_id: string; person_name: string; legacy_member_id: string | null; }
interface LMRow { legacy_member_id: string; real_name: string | null; display_name: string | null; }
interface NVRow { canonical_normalized: string; variant_normalized: string; }

export function normalizeForMatch(raw: string | null | undefined): string {
  const nfkc = (raw ?? '').normalize('NFKC').toLowerCase().trim();
  if (!nfkc) return '';
  return nfkc.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Build the provenance-candidate set from the given DB. Pure read.
 * Exported for direct test invocation; the CLI just wires args + IO around it.
 */
export function buildProvenanceCandidates(db: BetterSqlite3.Database): {
  candidates: ProvenanceCandidate[];
  summary: Summary;
} {
  const hps = db.prepare(
    `SELECT person_id, person_name, legacy_member_id
       FROM historical_persons
       WHERE legacy_member_id IS NULL`,
  ).all() as HPRow[];

  const legacies = db.prepare(
    `SELECT legacy_member_id, real_name, display_name FROM legacy_members`,
  ).all() as LMRow[];

  const variants = db.prepare(
    `SELECT canonical_normalized, variant_normalized FROM name_variants`,
  ).all() as NVRow[];

  // Indexes.
  const legacyByName = new Map<string, LMRow[]>();
  for (const lm of legacies) {
    const display = lm.real_name && lm.real_name.trim()
      ? lm.real_name
      : lm.display_name ?? '';
    const key = normalizeForMatch(display);
    if (!key) continue;
    const list = legacyByName.get(key) ?? [];
    list.push(lm);
    legacyByName.set(key, list);
  }

  // For each HP, gather edges: (legacy, matchKind).
  type Edge = { lm: LMRow; matchKind: 'exact' | 'variant' };
  const edgesByHp = new Map<string, Edge[]>();

  for (const hp of hps) {
    const hpKey = normalizeForMatch(hp.person_name);
    if (!hpKey) continue;

    const edges: Edge[] = [];
    const seenLegacyIds = new Set<string>();

    // Exact matches.
    for (const lm of legacyByName.get(hpKey) ?? []) {
      if (!seenLegacyIds.has(lm.legacy_member_id)) {
        edges.push({ lm, matchKind: 'exact' });
        seenLegacyIds.add(lm.legacy_member_id);
      }
    }

    // Variant-assisted. Symmetric table: hpKey might match either column.
    for (const nv of variants) {
      const other =
        nv.canonical_normalized === hpKey ? nv.variant_normalized :
        nv.variant_normalized   === hpKey ? nv.canonical_normalized :
        null;
      if (other === null) continue;
      for (const lm of legacyByName.get(other) ?? []) {
        if (!seenLegacyIds.has(lm.legacy_member_id)) {
          edges.push({ lm, matchKind: 'variant' });
          seenLegacyIds.add(lm.legacy_member_id);
        }
      }
    }

    if (edges.length > 0) edgesByHp.set(hp.person_id, edges);
  }

  // Global pass: count how many HPs claim each legacy candidate.
  const legacyClaimants = new Map<string, Set<string>>();
  for (const [hpId, edges] of edgesByHp) {
    for (const e of edges) {
      const set = legacyClaimants.get(e.lm.legacy_member_id) ?? new Set();
      set.add(hpId);
      legacyClaimants.set(e.lm.legacy_member_id, set);
    }
  }

  // Final classification.
  const hpById = new Map(hps.map((h) => [h.person_id, h]));
  const out: ProvenanceCandidate[] = [];
  let unresolved = 0;
  for (const hp of hps) {
    const edges = edgesByHp.get(hp.person_id);
    if (!edges || edges.length === 0) {
      unresolved++;
      continue;
    }

    const legacyDisplay = (lm: LMRow) =>
      (lm.real_name && lm.real_name.trim()) ? lm.real_name! : (lm.display_name ?? '');

    if (edges.length > 1) {
      // Multiple legacy candidates for this HP — all MEDIUM / multi-legacy.
      for (const e of edges) {
        out.push({
          historical_person_id:      hp.person_id,
          historical_person_name:    hp.person_name,
          candidate_legacy_member_id: e.lm.legacy_member_id,
          candidate_legacy_name:     legacyDisplay(e.lm),
          confidence:                'MEDIUM',
          reason:                    'ambiguous_multiple_legacy_matches',
          ambiguity_count:           edges.length,
        });
      }
      continue;
    }

    // Exactly one legacy candidate.
    const e = edges[0]!;
    const hpContenders = legacyClaimants.get(e.lm.legacy_member_id) ?? new Set();
    if (hpContenders.size > 1) {
      out.push({
        historical_person_id:       hp.person_id,
        historical_person_name:     hp.person_name,
        candidate_legacy_member_id: e.lm.legacy_member_id,
        candidate_legacy_name:      legacyDisplay(e.lm),
        confidence:                 'MEDIUM',
        reason:                     'ambiguous_multiple_hp_matches',
        ambiguity_count:            hpContenders.size,
      });
      continue;
    }

    out.push({
      historical_person_id:       hp.person_id,
      historical_person_name:     hp.person_name,
      candidate_legacy_member_id: e.lm.legacy_member_id,
      candidate_legacy_name:      legacyDisplay(e.lm),
      confidence:                 'HIGH',
      reason:                     e.matchKind === 'exact'
                                    ? 'exact_normalized_unique'
                                    : 'variant_normalized_unique',
      ambiguity_count:            1,
    });
  }

  // Deterministic order.
  out.sort((a, b) => {
    if (a.historical_person_id !== b.historical_person_id) {
      return a.historical_person_id < b.historical_person_id ? -1 : 1;
    }
    if (a.candidate_legacy_member_id !== b.candidate_legacy_member_id) {
      return a.candidate_legacy_member_id < b.candidate_legacy_member_id ? -1 : 1;
    }
    return 0;
  });

  // Top ambiguity buckets: normalized HP names that hit >1 legacy.
  const bucketSizes = new Map<string, { size: number; example_ids: string[] }>();
  for (const [hpId, edges] of edgesByHp) {
    if (edges.length <= 1) continue;
    const hp = hpById.get(hpId);
    if (!hp) continue;
    const key = normalizeForMatch(hp.person_name);
    const existing = bucketSizes.get(key);
    if (existing) {
      existing.size = Math.max(existing.size, edges.length);
      if (existing.example_ids.length < 3) existing.example_ids.push(hpId);
    } else {
      bucketSizes.set(key, { size: edges.length, example_ids: [hpId] });
    }
  }

  const top_ambiguity_buckets = [...bucketSizes.entries()]
    .map(([normalized, v]) => ({ normalized, size: v.size, example_ids: v.example_ids }))
    .sort((a, b) => (b.size - a.size) || (a.normalized < b.normalized ? -1 : 1))
    .slice(0, 10);

  const summary: Summary = {
    hp_without_provenance: hps.length,
    high_count:  out.filter((c) => c.confidence === 'HIGH').length,
    medium_count: out.filter((c) => c.confidence === 'MEDIUM').length,
    unresolved,
    top_ambiguity_buckets,
  };

  return { candidates: out, summary };
}

function writeCsv(filepath: string, rows: ProvenanceCandidate[]): void {
  const headers = [
    'historical_person_id',
    'historical_person_name',
    'candidate_legacy_member_id',
    'candidate_legacy_name',
    'confidence',
    'reason',
    'ambiguity_count',
  ];
  const quote = (s: string): string => {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      quote(r.historical_person_id),
      quote(r.historical_person_name),
      quote(r.candidate_legacy_member_id),
      quote(r.candidate_legacy_name),
      r.confidence,
      r.reason,
      String(r.ambiguity_count),
    ].join(','));
  }
  writeFileSync(filepath, lines.join('\n') + '\n', { encoding: 'utf8' });
}

function hrule() { console.log('─'.repeat(78)); }

function parseArgs(): { db: string; outDir: string } {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--db');
  const j = argv.indexOf('--out-dir');
  return {
    db: i >= 0 ? argv[i + 1] : DEFAULT_DB,
    outDir: j >= 0 ? argv[j + 1] : DEFAULT_OUT_DIR,
  };
}

function main(): number {
  const { db: dbPath, outDir } = parseArgs();
  if (!existsSync(dbPath)) {
    console.error(`ERROR: DB not found at ${dbPath}`);
    return 1;
  }
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const { candidates, summary } = buildProvenanceCandidates(db);
  db.close();

  mkdirSync(outDir, { recursive: true });
  const highPath = path.join(outDir, 'provenance_candidates_high.csv');
  const mediumPath = path.join(outDir, 'provenance_candidates_medium.csv');
  writeCsv(highPath,   candidates.filter((c) => c.confidence === 'HIGH'));
  writeCsv(mediumPath, candidates.filter((c) => c.confidence === 'MEDIUM'));

  console.log();
  console.log('  Provenance candidate builder');
  console.log(`  DB: ${dbPath}`);
  hrule();
  console.log(`  HPs without provenance scanned:          ${summary.hp_without_provenance}`);
  console.log(`  HIGH candidates:                         ${summary.high_count}`);
  console.log(`  MEDIUM candidates (rows):                ${summary.medium_count}`);
  console.log(`  Unresolved (no name match):              ${summary.unresolved}`);
  hrule();
  if (summary.top_ambiguity_buckets.length > 0) {
    console.log('  Top ambiguity buckets (normalized HP name → #legacy candidates):');
    for (const b of summary.top_ambiguity_buckets) {
      const ex = b.example_ids.slice(0, 3).join(', ');
      console.log(`    ${b.normalized.padEnd(40, ' ')} ${String(b.size).padStart(3, ' ')}   e.g. ${ex}`);
    }
  } else {
    console.log('  Top ambiguity buckets: none.');
  }
  hrule();
  console.log(`  Wrote: ${highPath}`);
  console.log(`         ${mediumPath}`);
  console.log();
  return 0;
}

// Only invoke main when executed directly (not when imported by tests).
if (require.main === module) {
  process.exit(main());
}
