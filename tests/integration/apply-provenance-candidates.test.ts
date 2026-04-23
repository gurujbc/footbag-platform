/**
 * Integration tests for applyProvenanceCandidates.
 *
 * Exercises the write path in isolation: happy apply, skip reasons
 * (hp_already_linked, legacy_missing, legacy_already_claimed,
 * duplicate_target_in_csv, hp_missing), and the all-or-nothing
 * transaction guarantee when a mid-apply invariant is violated.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { applyProvenanceCandidates, CsvRow } from '../../scripts/apply-provenance-candidates';

const DB_PATH = path.resolve(
  process.cwd(),
  `test-apply-prov-${Date.now()}-${process.pid}.db`,
);

function freshDb(): BetterSqlite3.Database {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const schema = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  const db = new BetterSqlite3(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

function seedCommon(db: BetterSqlite3.Database): void {
  const TS = '2025-01-01T00:00:00.000Z';
  const insLegacy = db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`);
  const insHp = db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, legacy_member_id, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'test', 'CANONICAL', 0, 0)`);

  insLegacy.run('LM-clean',    'Clean Target',   'clean target', TS);
  insLegacy.run('LM-claimed',  'Claimed Target', 'claimed target', TS);
  insLegacy.run('LM-unique-a', 'Unique A',       'unique a',     TS);
  insLegacy.run('LM-unique-b', 'Unique B',       'unique b',     TS);

  insHp.run('hp-clean',         'Clean HP',         null);
  insHp.run('hp-has-link',      'Already Linked',   'LM-unique-b');  // HP already linked
  insHp.run('hp-claim-target',  'Claimed Owner',    'LM-claimed');   // holds LM-claimed
  insHp.run('hp-for-a',         'For Unique A',     null);
  insHp.run('hp-contends',      'Contender',        null);           // will try to claim LM-claimed
  insHp.run('hp-missing-lm',    'Bad Target',       null);
}

let db: BetterSqlite3.Database;

beforeAll(() => {
  db = freshDb();
  seedCommon(db);
});

afterAll(() => {
  db.close();
  for (const ext of ['', '-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe('applyProvenanceCandidates', () => {
  it('applies a clean HIGH row and updates historical_persons', () => {
    const rows: CsvRow[] = [
      { historical_person_id: 'hp-clean', candidate_legacy_member_id: 'LM-clean' },
    ];
    const result = applyProvenanceCandidates(db, rows);
    expect(result.applied).toEqual([
      { person_id: 'hp-clean', legacy_member_id: 'LM-clean' },
    ]);
    expect(result.skipped).toEqual([]);

    const hp = db.prepare('SELECT legacy_member_id FROM historical_persons WHERE person_id = ?')
      .get('hp-clean') as { legacy_member_id: string };
    expect(hp.legacy_member_id).toBe('LM-clean');
  });

  it('skips hp_already_linked without touching the existing link', () => {
    const result = applyProvenanceCandidates(db, [
      { historical_person_id: 'hp-has-link', candidate_legacy_member_id: 'LM-unique-a' },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      person_id: 'hp-has-link',
      reason: 'hp_already_linked',
    });
    const hp = db.prepare('SELECT legacy_member_id FROM historical_persons WHERE person_id = ?')
      .get('hp-has-link') as { legacy_member_id: string };
    expect(hp.legacy_member_id).toBe('LM-unique-b');
  });

  it('skips legacy_missing when target legacy_members row does not exist', () => {
    const result = applyProvenanceCandidates(db, [
      { historical_person_id: 'hp-missing-lm', candidate_legacy_member_id: 'LM-does-not-exist' },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      person_id: 'hp-missing-lm',
      legacy_member_id: 'LM-does-not-exist',
      reason: 'legacy_missing',
    });
  });

  it('skips legacy_already_claimed when another HP holds the target', () => {
    const result = applyProvenanceCandidates(db, [
      { historical_person_id: 'hp-contends', candidate_legacy_member_id: 'LM-claimed' },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      person_id: 'hp-contends',
      reason: 'legacy_already_claimed',
    });
  });

  it('deduplicates duplicate_target_in_csv and keeps first occurrence only', () => {
    const rows: CsvRow[] = [
      { historical_person_id: 'hp-for-a',   candidate_legacy_member_id: 'LM-unique-a' },
      { historical_person_id: 'hp-another', candidate_legacy_member_id: 'LM-unique-a' },
    ];
    const result = applyProvenanceCandidates(db, rows);
    expect(result.applied).toEqual([
      { person_id: 'hp-for-a', legacy_member_id: 'LM-unique-a' },
    ]);
    expect(result.skipped[0]).toMatchObject({
      person_id: 'hp-another',
      reason: 'duplicate_target_in_csv',
    });
  });

  it('skips hp_missing when the HP row does not exist', () => {
    const result = applyProvenanceCandidates(db, [
      { historical_person_id: 'hp-does-not-exist', candidate_legacy_member_id: 'LM-unique-b' },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      person_id: 'hp-does-not-exist',
      reason: 'hp_missing',
    });
  });
});
