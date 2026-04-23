/**
 * Apply approved HIGH provenance candidates.
 *
 * Reads a HIGH-confidence CSV produced by `build-provenance-candidates.ts`,
 * runs a read-only precondition pass, and sets
 * `historical_persons.legacy_member_id` in a single transaction. Writes an
 * audit artifact and a rollback SQL sibling for trivial reversal.
 *
 * Schema invariants respected:
 *   - legacy_member_id has a partial UNIQUE index WHERE NOT NULL, so each
 *     legacy row can back at most one HP.
 *   - FK to legacy_members(legacy_member_id); the target must exist.
 *
 * Skip reasons (per row, never aborts the run):
 *   - hp_missing            HP row does not exist
 *   - hp_already_linked     HP already has legacy_member_id set
 *   - legacy_missing        target legacy_members row does not exist
 *   - legacy_already_claimed  another HP already holds this legacy_member_id
 *   - duplicate_target_in_csv  two CSV rows target the same legacy — keep first
 *
 * Usage:
 *   npx tsx scripts/apply-provenance-candidates.ts
 *   npx tsx scripts/apply-provenance-candidates.ts --input path/to.csv --db path/to.db
 *   npx tsx scripts/apply-provenance-candidates.ts --dry-run
 *
 * Defaults:
 *   --input  legacy_data/out/provenance_candidates_high.csv
 *   --db     database/footbag.db
 *   --audit-dir  legacy_data/out
 */
import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_DB       = path.resolve(__dirname, '..', 'database', 'footbag.db');
const DEFAULT_INPUT    = path.resolve(__dirname, '..', 'legacy_data', 'out', 'provenance_candidates_high.csv');
const DEFAULT_AUDIT    = path.resolve(__dirname, '..', 'legacy_data', 'out');

export interface CsvRow {
  historical_person_id: string;
  candidate_legacy_member_id: string;
}

export interface ApplyResult {
  applied:             Array<{ person_id: string; legacy_member_id: string }>;
  skipped: Array<{ person_id: string; legacy_member_id: string; reason: string; detail: string }>;
}

export function applyProvenanceCandidates(
  db: BetterSqlite3.Database,
  rows: CsvRow[],
): ApplyResult {
  const applied: ApplyResult['applied'] = [];
  const skipped: ApplyResult['skipped'] = [];

  // Preload current state so precondition checks are O(1) per row.
  const hpRows = db.prepare(
    `SELECT person_id, legacy_member_id FROM historical_persons`,
  ).all() as Array<{ person_id: string; legacy_member_id: string | null }>;
  const lmRows = db.prepare(
    `SELECT legacy_member_id FROM legacy_members`,
  ).all() as Array<{ legacy_member_id: string }>;

  const hpById = new Map(hpRows.map((r) => [r.person_id, r]));
  const lmById = new Set(lmRows.map((r) => r.legacy_member_id));
  const legacyAlreadyClaimedBy = new Map<string, string>(
    hpRows
      .filter((r) => r.legacy_member_id !== null)
      .map((r) => [r.legacy_member_id as string, r.person_id]),
  );

  // Dedup CSV: first occurrence wins; subsequent duplicates of the same
  // legacy target get skipped.
  const seenTargets = new Set<string>();
  const candidatesToApply: CsvRow[] = [];
  for (const row of rows) {
    if (seenTargets.has(row.candidate_legacy_member_id)) {
      skipped.push({
        person_id: row.historical_person_id,
        legacy_member_id: row.candidate_legacy_member_id,
        reason: 'duplicate_target_in_csv',
        detail: 'another CSV row earlier targets this legacy_member_id',
      });
      continue;
    }
    seenTargets.add(row.candidate_legacy_member_id);
    candidatesToApply.push(row);
  }

  // Precondition pass + queue for application.
  const toApply: CsvRow[] = [];
  for (const row of candidatesToApply) {
    const hp = hpById.get(row.historical_person_id);
    if (!hp) {
      skipped.push({
        person_id: row.historical_person_id,
        legacy_member_id: row.candidate_legacy_member_id,
        reason: 'hp_missing',
        detail: 'historical_persons row not found',
      });
      continue;
    }
    if (hp.legacy_member_id !== null) {
      skipped.push({
        person_id: row.historical_person_id,
        legacy_member_id: row.candidate_legacy_member_id,
        reason: 'hp_already_linked',
        detail: `HP is already linked to ${hp.legacy_member_id}`,
      });
      continue;
    }
    if (!lmById.has(row.candidate_legacy_member_id)) {
      skipped.push({
        person_id: row.historical_person_id,
        legacy_member_id: row.candidate_legacy_member_id,
        reason: 'legacy_missing',
        detail: 'legacy_members row not found for target',
      });
      continue;
    }
    const existing = legacyAlreadyClaimedBy.get(row.candidate_legacy_member_id);
    if (existing !== undefined) {
      skipped.push({
        person_id: row.historical_person_id,
        legacy_member_id: row.candidate_legacy_member_id,
        reason: 'legacy_already_claimed',
        detail: `legacy_member_id already held by HP ${existing}`,
      });
      continue;
    }
    toApply.push(row);
  }

  // Apply in a single transaction. All-or-nothing.
  const update = db.prepare(
    `UPDATE historical_persons
       SET legacy_member_id = ?
     WHERE person_id = ?
       AND legacy_member_id IS NULL`,
  );
  const doApply = db.transaction((items: CsvRow[]) => {
    for (const row of items) {
      const info = update.run(row.candidate_legacy_member_id, row.historical_person_id);
      if (info.changes === 1) {
        applied.push({
          person_id:        row.historical_person_id,
          legacy_member_id: row.candidate_legacy_member_id,
        });
      } else {
        // Race: concurrent writer changed state between precheck and apply.
        // Roll back the whole batch so we never land a partial result.
        throw new Error(
          `UPDATE affected 0 rows for ${row.historical_person_id}; ` +
          'HP state changed during apply — transaction rolled back',
        );
      }
    }
  });
  doApply(toApply);

  return { applied, skipped };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(): { db: string; input: string; auditDir: string; dryRun: boolean } {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    db:       get('--db')        ?? DEFAULT_DB,
    input:    get('--input')     ?? DEFAULT_INPUT,
    auditDir: get('--audit-dir') ?? DEFAULT_AUDIT,
    dryRun:   argv.includes('--dry-run'),
  };
}

function parseCsv(source: string): CsvRow[] {
  const lines = source.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  const idxPerson = headers.indexOf('historical_person_id');
  const idxLegacy = headers.indexOf('candidate_legacy_member_id');
  const idxConf   = headers.indexOf('confidence');
  if (idxPerson < 0 || idxLegacy < 0) {
    throw new Error(`CSV missing required columns; headers: ${headers.join(',')}`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Light-weight CSV parse: respects quoted fields but no embedded newlines.
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!;
      if (inQuote) {
        if (ch === '"') {
          if (line[j + 1] === '"') { cur += '"'; j++; }
          else { inQuote = false; }
        } else { cur += ch; }
      } else {
        if (ch === ',') { fields.push(cur); cur = ''; }
        else if (ch === '"') { inQuote = true; }
        else { cur += ch; }
      }
    }
    fields.push(cur);

    if (idxConf >= 0 && fields[idxConf] !== 'HIGH') continue;  // safety: only HIGH rows
    rows.push({
      historical_person_id:       fields[idxPerson]!,
      candidate_legacy_member_id: fields[idxLegacy]!,
    });
  }
  return rows;
}

function nowUtcStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

function hrule() { console.log('─'.repeat(78)); }

function main(): number {
  const { db: dbPath, input: inputPath, auditDir, dryRun } = parseArgs();
  if (!existsSync(dbPath))    { console.error(`ERROR: DB not found: ${dbPath}`); return 1; }
  if (!existsSync(inputPath)) { console.error(`ERROR: CSV not found: ${inputPath}`); return 1; }

  const rows = parseCsv(readFileSync(inputPath, 'utf8'));
  console.log();
  console.log('  Apply provenance candidates');
  console.log(`  DB:    ${dbPath}`);
  console.log(`  input: ${inputPath}`);
  console.log(`  rows:  ${rows.length} (HIGH only)`);
  console.log(`  mode:  ${dryRun ? 'DRY-RUN (no writes)' : 'APPLY (transactional)'}`);
  hrule();

  const db = new BetterSqlite3(dbPath);
  db.pragma('foreign_keys = ON');

  let result: ApplyResult;
  if (dryRun) {
    // Exercise precondition checks without committing. Use a savepoint so
    // the applied UPDATEs inside applyProvenanceCandidates roll back.
    db.exec('SAVEPOINT dryrun');
    try {
      result = applyProvenanceCandidates(db, rows);
    } finally {
      db.exec('ROLLBACK TO SAVEPOINT dryrun; RELEASE SAVEPOINT dryrun');
    }
  } else {
    result = applyProvenanceCandidates(db, rows);
  }

  db.close();

  // Audit + rollback artifacts.
  mkdirSync(auditDir, { recursive: true });
  const stamp = nowUtcStamp();
  const auditPath    = path.join(auditDir, `provenance_apply_audit_${stamp}.csv`);
  const rollbackPath = path.join(auditDir, `provenance_apply_rollback_${stamp}.sql`);

  const auditLines = ['person_id,legacy_member_id,status,reason,detail'];
  for (const r of result.applied) {
    auditLines.push([r.person_id, r.legacy_member_id, 'applied', '', dryRun ? 'dry-run' : 'committed'].join(','));
  }
  for (const s of result.skipped) {
    auditLines.push([s.person_id, s.legacy_member_id, 'skipped', s.reason, s.detail.replace(/,/g, ' ')].join(','));
  }
  writeFileSync(auditPath, auditLines.join('\n') + '\n');

  if (!dryRun && result.applied.length > 0) {
    const rollbackLines = [
      '-- Rollback script for provenance candidate apply at ' + stamp,
      '-- Reverses the writes recorded in ' + path.basename(auditPath),
      'BEGIN TRANSACTION;',
    ];
    for (const r of result.applied) {
      rollbackLines.push(
        `UPDATE historical_persons SET legacy_member_id = NULL ` +
        `WHERE person_id = '${r.person_id.replace(/'/g, "''")}' ` +
        `AND legacy_member_id = '${r.legacy_member_id.replace(/'/g, "''")}';`,
      );
    }
    rollbackLines.push('COMMIT;');
    writeFileSync(rollbackPath, rollbackLines.join('\n') + '\n');
  }

  // Summary.
  const skipCounts: Record<string, number> = {};
  for (const s of result.skipped) skipCounts[s.reason] = (skipCounts[s.reason] ?? 0) + 1;

  console.log(`  applied:        ${result.applied.length}`);
  console.log(`  skipped total:  ${result.skipped.length}`);
  for (const [reason, n] of Object.entries(skipCounts)) {
    console.log(`    ${reason.padEnd(28, ' ')}${String(n).padStart(5, ' ')}`);
  }
  hrule();
  console.log(`  audit: ${auditPath}`);
  if (!dryRun && result.applied.length > 0) {
    console.log(`  rollback SQL: ${rollbackPath}`);
  }
  console.log();
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
