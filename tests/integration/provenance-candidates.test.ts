/**
 * Integration tests for the provenance candidate builder.
 *
 * Calls `buildProvenanceCandidates(db)` directly against a fresh SQLite
 * schema seeded with fixtures that cover every classification branch of
 * the script: HIGH exact, HIGH variant, MEDIUM multi-legacy, MEDIUM
 * multi-HP, and unresolved (no match). The script is read-only; these
 * tests verify that assertion too by comparing row counts before and
 * after.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { buildProvenanceCandidates } from '../../scripts/build-provenance-candidates';

const DB_PATH = path.resolve(
  process.cwd(),
  `test-provenance-${Date.now()}-${process.pid}.db`,
);

function seed(db: BetterSqlite3.Database): void {
  const TS = '2025-01-01T00:00:00.000Z';
  const SYS = 'system';

  // HIGH / exact_normalized_unique: one HP, one legacy, exact match.
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-exact', 'Kenny Shults', 'test');
  db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`)
    .run('LM-exact', 'Kenny Shults', 'kenny shults', TS);

  // HIGH / variant_normalized_unique.
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-variant', 'Alex Martínez', 'test');
  db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`)
    .run('LM-variant', 'Alex Martinez', 'alex martinez', TS);
  db.prepare(`INSERT INTO name_variants (canonical_normalized, variant_normalized, source, created_at)
    VALUES (?, ?, 'mirror_mined', ?)`)
    .run('alex martínez', 'alex martinez', TS);

  // MEDIUM / ambiguous_multiple_legacy_matches: one HP, two legacies with same name.
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-multi-legacy', 'Pat Common', 'test');
  db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`)
    .run('LM-multi-a', 'Pat Common', 'pat common', TS);
  db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`)
    .run('LM-multi-b', 'Pat Common', 'pat common', TS);

  // MEDIUM / ambiguous_multiple_hp_matches: two HPs share the same name,
  // both point at the same single legacy candidate.
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-share-a', 'Jordan Shared', 'test');
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-share-b', 'Jordan Shared', 'test');
  db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`)
    .run('LM-shared', 'Jordan Shared', 'jordan shared', TS);

  // Unresolved: HP with no matching legacy name anywhere.
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-unresolved', 'Nobody Stranger', 'test');

  // Already-linked HP — must be excluded because legacy_member_id IS NULL is the filter.
  db.prepare(`INSERT INTO legacy_members
    (legacy_member_id, display_name, display_name_normalized, import_source, imported_at, version)
    VALUES (?, ?, ?, 'mirror', ?, 1)`)
    .run('LM-existing', 'Already Linked', 'already linked', TS);
  db.prepare(`INSERT INTO historical_persons
    (person_id, person_name, legacy_member_id, source, source_scope, event_count, placement_count)
    VALUES (?, ?, ?, ?, 'CANONICAL', 0, 0)`)
    .run('hp-prelinked', 'Already Linked', 'LM-existing', 'test');
}

let db: BetterSqlite3.Database;

beforeAll(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'database', 'schema.sql'),
    'utf8',
  );
  db = new BetterSqlite3(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  seed(db);
});

afterAll(() => {
  db.close();
  for (const ext of ['', '-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe('buildProvenanceCandidates', () => {
  it('emits HIGH / exact_normalized_unique for a unique exact match', () => {
    const { candidates } = buildProvenanceCandidates(db);
    const row = candidates.find((c) => c.historical_person_id === 'hp-exact');
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      candidate_legacy_member_id: 'LM-exact',
      confidence: 'HIGH',
      reason: 'exact_normalized_unique',
      ambiguity_count: 1,
    });
  });

  it('emits HIGH / variant_normalized_unique for a variant-assisted unique match', () => {
    const { candidates } = buildProvenanceCandidates(db);
    const row = candidates.find((c) => c.historical_person_id === 'hp-variant');
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      candidate_legacy_member_id: 'LM-variant',
      confidence: 'HIGH',
      reason: 'variant_normalized_unique',
      ambiguity_count: 1,
    });
  });

  it('emits MEDIUM / ambiguous_multiple_legacy_matches (one row per candidate)', () => {
    const { candidates } = buildProvenanceCandidates(db);
    const rows = candidates.filter((c) => c.historical_person_id === 'hp-multi-legacy');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.confidence).toBe('MEDIUM');
      expect(r.reason).toBe('ambiguous_multiple_legacy_matches');
      expect(r.ambiguity_count).toBe(2);
    }
    expect(rows.map((r) => r.candidate_legacy_member_id).sort())
      .toEqual(['LM-multi-a', 'LM-multi-b']);
  });

  it('emits MEDIUM / ambiguous_multiple_hp_matches when two HPs contend for the same legacy', () => {
    const { candidates } = buildProvenanceCandidates(db);
    const rows = candidates.filter((c) =>
      c.historical_person_id === 'hp-share-a' ||
      c.historical_person_id === 'hp-share-b');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.confidence).toBe('MEDIUM');
      expect(r.reason).toBe('ambiguous_multiple_hp_matches');
      expect(r.ambiguity_count).toBe(2);
      expect(r.candidate_legacy_member_id).toBe('LM-shared');
    }
  });

  it('counts unresolved HPs in the summary but does not emit rows for them', () => {
    const { candidates, summary } = buildProvenanceCandidates(db);
    expect(candidates.find((c) => c.historical_person_id === 'hp-unresolved')).toBeUndefined();
    expect(summary.unresolved).toBeGreaterThanOrEqual(1);
  });

  it('ignores HPs that already have legacy_member_id set (baseline filter)', () => {
    const { candidates } = buildProvenanceCandidates(db);
    expect(candidates.find((c) => c.historical_person_id === 'hp-prelinked')).toBeUndefined();
  });

  it('summary counts match emitted row confidence counts', () => {
    const { candidates, summary } = buildProvenanceCandidates(db);
    expect(summary.high_count).toBe(
      candidates.filter((c) => c.confidence === 'HIGH').length,
    );
    expect(summary.medium_count).toBe(
      candidates.filter((c) => c.confidence === 'MEDIUM').length,
    );
  });

  it('is deterministic across runs (stable sort and same output)', () => {
    const r1 = buildProvenanceCandidates(db);
    const r2 = buildProvenanceCandidates(db);
    expect(r2.candidates).toEqual(r1.candidates);
  });

  it('does not mutate the DB', () => {
    const countBefore = {
      hp: (db.prepare('SELECT COUNT(*) AS n FROM historical_persons').get() as { n: number }).n,
      lm: (db.prepare('SELECT COUNT(*) AS n FROM legacy_members').get() as { n: number }).n,
      nv: (db.prepare('SELECT COUNT(*) AS n FROM name_variants').get() as { n: number }).n,
    };
    buildProvenanceCandidates(db);
    const countAfter = {
      hp: (db.prepare('SELECT COUNT(*) AS n FROM historical_persons').get() as { n: number }).n,
      lm: (db.prepare('SELECT COUNT(*) AS n FROM legacy_members').get() as { n: number }).n,
      nv: (db.prepare('SELECT COUNT(*) AS n FROM name_variants').get() as { n: number }).n,
    };
    expect(countAfter).toEqual(countBefore);
  });
});
