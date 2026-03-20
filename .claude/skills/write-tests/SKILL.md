---
name: write-tests
description: Write or extend integration tests for a route or service. Use when adding new features, verifying edge-case coverage, or confirming a fix holds.
---

# Write Tests

## When to use this skill

- Adding a new route or service method and want tests alongside or before implementation
- Checking whether existing coverage is sufficient for a feature
- Verifying a bug fix is captured by a regression test
- Doing a focused coverage pass after a feature lands

Tests can be written at any point — before, during, or after implementation. See `tests/CLAUDE.md` for conventions.

## Step 1 — Confirm scope

Read the top active-slice/status block in `IMPLEMENTATION_PLAN.md`. Confirm the feature being tested is in scope for the current slice. Do not write tests for out-of-scope behavior.

## Step 2 — Understand what needs testing

Read:
1. Acceptance criteria from `docs/USER_STORIES.md` (targeted sections)
2. Route contract from `docs/VIEW_CATALOG.md` §6.x for the affected page (if a route test)
3. Service contract from `docs/SERVICE_CATALOG.md` for the affected service
4. Nearby tests in `tests/integration/` — follow established patterns exactly

Do not invent behavior not in the acceptance criteria.

## Step 3 — Plan test cases

Identify cases to cover:
- Happy path — correct status and expected content
- Auth gate — 302 if unauthenticated, 200 if authenticated (protected routes only)
- Not-found / invalid input — 404 or 400 as appropriate
- Draft/unpublished content must not appear in public responses
- Route ordering — more-specific before catch-all
- Adversarial / edge cases from acceptance criteria or service contracts

State the planned cases before writing code.

## Step 4 — Write tests using factories

Use factories from `tests/fixtures/factories.ts` to set up test data. Insert only what the tests need.

```typescript
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { insertEvent, insertMember } from '../fixtures/factories';

const TEST_DB_PATH = path.join(process.cwd(), `test-${Date.now()}.db`);

process.env.FOOTBAG_DB_PATH = TEST_DB_PATH;
// set other required env vars here if not already set

let createApp: typeof import('../../src/app').createApp;

beforeAll(async () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
  const db = new BetterSqlite3(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // Insert only what these tests need
  insertEvent(db, { status: 'published', title: 'Spring Classic 2026' });
  insertEvent(db, { status: 'draft',     title: 'Secret Draft' });

  db.close();
  const mod = await import('../../src/app');
  createApp = mod.createApp;
});

afterAll(() => {
  for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('GET /events', () => {
  it('returns 200 and lists published events', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Spring Classic 2026');
  });

  it('does not expose draft events', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.text).not.toContain('Secret Draft');
  });
});
```

## Step 5 — Run and report

```bash
npm test
npm run build
```

Report: which tests were added, what each asserts, whether all tests pass, and whether type-check is clean. Flag any failures with the full error output.

## Mutation tests

If a test writes to the database, isolate it: use a fresh per-test DB path, or wrap the mutation in a transaction and roll back in `afterEach`. Do not let writes from one test affect reads in another.

## Composition order

`write-tests` fits anywhere in the flow: before implementation (spec), alongside (driven by code), or after (coverage pass).

Full skill sequence: `extend-service-contract` → `add-public-page` → `write-tests` → `doc-sync` → `prepare-pr`
