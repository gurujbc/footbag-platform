/**
 * Integration tests for the persons QC page.
 *
 * Covers:
 *   GET /internal/persons/qc — historical persons data quality viewer
 *
 * Verifies:
 *   - 200 response with flagged persons
 *   - Clean persons do not appear as flagged
 *   - Category and source filters work
 *   - QC check functions catch known bad patterns
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import {
  setTestEnv,
  createTestDb,
  cleanupTestDb,
  importApp,
} from '../fixtures/testDb';
import { insertHistoricalPerson } from '../fixtures/factories';
import { runPersonsQcChecks, PersonQcRow } from '../../src/services/personsQcChecks';

const { dbPath } = setTestEnv('3115');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);

  // Clean persons — should NOT be flagged
  insertHistoricalPerson(db, { person_name: 'Alice Johnson', country: 'US' });
  insertHistoricalPerson(db, { person_name: 'Jan Kowalski', country: 'PL' });

  // Encoding corruption (HIGH)
  insertHistoricalPerson(db, { person_name: 'Pawe\u00B3 Ro\u00BCek', country: 'PL' });

  // Embedded question mark (HIGH)
  insertHistoricalPerson(db, { person_name: 'Ale? Pelko', country: 'SI' });

  // Multi-person entry (MEDIUM)
  insertHistoricalPerson(db, { person_name: 'Homola + Hal\u00E1sz', source: 'CLUB' });

  // Junk marker — trailing asterisk (LOW)
  insertHistoricalPerson(db, { person_name: 'Patrick Keehan*', country: 'US' });

  // Incomplete name — standalone question mark (MEDIUM)
  insertHistoricalPerson(db, { person_name: 'R\u00E9mi ?', country: 'FR' });

  // Single word (LOW)
  insertHistoricalPerson(db, { person_name: 'Egoitz', country: 'ES' });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

describe('GET /internal/persons/qc', () => {
  it('returns 200 with QC page content', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Persons QC');
    expect(res.text).toContain('persons');
    expect(res.text).toContain('flagged');
  });

  it('shows flagged persons in the response', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc');
    expect(res.text).toContain('Pawe\u00B3 Ro\u00BCek');
    expect(res.text).toContain('Ale? Pelko');
    expect(res.text).toContain('Homola');
    expect(res.text).toContain('R\u00E9mi ?');
    expect(res.text).toContain('Egoitz');
  });

  it('does not flag clean persons', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc');
    // Clean names should not appear in the issues table.
    // They ARE in the DB but should not be flagged.
    // The table only shows flagged items, so "Alice Johnson" should not be in a <code> tag.
    expect(res.text).not.toContain('<code>Alice Johnson</code>');
    expect(res.text).not.toContain('<code>Jan Kowalski</code>');
  });

  it('filters by category', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc?category=encoding_corruption');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Pawe\u00B3 Ro\u00BCek');
    // Single-word issue should not appear under encoding_corruption filter
    expect(res.text).not.toContain('<code>Egoitz</code>');
  });

  it('filters by source', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/persons/qc?source=CLUB');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Homola');
  });
});

// ── Unit-style tests for QC check functions ──────────────────────────────────

describe('runPersonsQcChecks', () => {
  function makeRow(overrides: Partial<PersonQcRow> = {}): PersonQcRow {
    return {
      person_id: 'test-id',
      person_name: 'Test Person',
      aliases: null,
      source: null,
      source_scope: 'CANONICAL',
      country: 'US',
      event_count: 0,
      placement_count: 0,
      ...overrides,
    };
  }

  it('returns no issues for clean names', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Alice Johnson' }),
      makeRow({ person_name: 'Jan Kowalski' }),
      makeRow({ person_name: 'Alejandro Rueda Pati\u00F1o' }),  // legitimate Spanish ñ
    ]);
    expect(issues).toHaveLength(0);
  });

  it('catches mojibake encoding corruption', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Pawe\u00B3 Ro\u00BCek' }),  // ³ and ¼
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some(i => i.category === 'encoding_corruption' && i.severity === 'HIGH')).toBe(true);
  });

  it('catches embedded question mark corruption', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Ale? Pelko' }),
    ]);
    // Should have encoding_corruption for the embedded ?
    const corruption = issues.filter(i => i.category === 'encoding_corruption');
    expect(corruption.length).toBeGreaterThanOrEqual(1);
    expect(corruption[0].severity).toBe('HIGH');
  });

  it('catches multi-person entries', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Homola + Hal\u00E1sz' }),
      makeRow({ person_name: 'Anthony Intemann / Greg Nice Neumann' }),
    ]);
    const multi = issues.filter(i => i.category === 'multi_person');
    expect(multi).toHaveLength(2);
    expect(multi[0].severity).toBe('MEDIUM');
  });

  it('catches trailing junk markers', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Patrick Keehan*' }),
    ]);
    const junk = issues.filter(i => i.category === 'junk_marker');
    expect(junk.length).toBeGreaterThanOrEqual(1);
  });

  it('catches standalone question mark (incomplete name)', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'R\u00E9mi ?' }),
    ]);
    const incomplete = issues.filter(i => i.category === 'incomplete_name');
    expect(incomplete.length).toBeGreaterThanOrEqual(1);
    expect(incomplete[0].severity).toBe('MEDIUM');
  });

  it('catches single-word names', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Egoitz' }),
    ]);
    const single = issues.filter(i => i.category === 'single_word');
    expect(single).toHaveLength(1);
    expect(single[0].severity).toBe('LOW');
  });

  it('skips sentinel names', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Unknown' }),
      makeRow({ person_name: '[UNKNOWN PARTNER]' }),
      makeRow({ person_name: '__NON_PERSON__' }),
      makeRow({ person_name: '' }),
    ]);
    expect(issues).toHaveLength(0);
  });

  it('does not flag legitimate Spanish ñ', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Alejandro Rueda Pati\u00F1o' }),
      makeRow({ person_name: 'Jessica Cede\u00F1o' }),
    ]);
    expect(issues).toHaveLength(0);
  });

  it('catches bad chars (+=\\|)', () => {
    const issues = runPersonsQcChecks([
      makeRow({ person_name: 'Michi+mr. Germany GER' }),
    ]);
    const junk = issues.filter(i => i.category === 'junk_marker' && i.detail.includes('+='));
    expect(junk.length).toBeGreaterThanOrEqual(1);
  });
});
