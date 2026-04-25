---
name: write-tests
description: Write or extend tests for a route, service, or pure function. Use when adding new features, verifying edge-case coverage, or confirming a fix holds.
---

# Write Tests

## When to use this skill

- Adding a new route or service method and want tests alongside or before implementation
- Checking whether existing coverage is sufficient for a feature
- Verifying a bug fix is captured by a regression test
- Doing a focused coverage pass after a feature lands

Tests can be written at any point. See `tests/CLAUDE.md` for conventions.

## Step 1 — Confirm scope

Read the top active-slice/status block in `IMPLEMENTATION_PLAN.md`. Confirm the feature being tested is in scope for the current slice. Do not write tests for out-of-scope behavior.

## Step 2 — Determine test layer

**Unit tests** (`tests/unit/`) for exported pure functions with no DB dependency:
- `slugify()` from `identityAccessService.ts`
- `personHref()` from `personLink.ts`
- `groupPlayerResults()` from `playerShaping.ts`
- `ServiceError` classes and `isServiceError()` from `serviceErrors.ts`

Non-exported pure functions are tested indirectly through integration tests. Do not modify production code exports just for testing.

**Integration tests** (`tests/integration/`) for everything involving routes, DB, auth, or rendered HTML:
- Route contracts (status codes, redirects, rendered content)
- Auth gates and ownership enforcement
- Privacy boundaries (purged members excluded, honors-gated profiles, show_competitive_results)
- Session edge cases (tampered cookies, malformed payloads)
- Validation negative paths (invalid input, boundary values)
- Business rules exercised through routes

**Smoke tests** (`tests/smoke/`) for real-AWS wiring contracts only. Opt-in via `npm run test:smoke` (which uses `scripts/test-smoke.sh` to read TF outputs and gate behind `RUN_STAGING_SMOKE=1`). Excluded from default `npm test` and CI. See "Smoke tests" below for scope rules.

## Step 3 — Understand what needs testing

Read:
1. Acceptance criteria from `docs/USER_STORIES.md` (targeted sections)
2. Route contract from `docs/VIEW_CATALOG.md` for the affected page (if a route test)
3. Service contract from `docs/SERVICE_CATALOG.md` for the affected service
4. Nearby tests in the target directory, follow established patterns exactly

Do not invent behavior not in the acceptance criteria.

## Step 4 — Plan test cases

Identify cases to cover:
- Happy path: correct status and expected content
- Auth gate: 302 if unauthenticated, 200 if authenticated (protected routes)
- Ownership: 404 if accessing another member's protected resource
- Privacy: purged members excluded, honors-gated public profiles, PII not leaked to unauthorized users
- Not-found / invalid input: 404 or 400 as appropriate
- Draft/unpublished content must not appear in public responses
- Route ordering: more-specific before catch-all
- Negative paths: validation failures, boundary values, empty/whitespace input
- Adversarial: session tampering, double-submit, concurrent claims

State the planned cases before writing code.

## Step 5 — Write tests

### Unit tests

No DB setup needed. Import the function directly and assert.

```typescript
import { describe, it, expect } from 'vitest';
import { slugify } from '../../src/services/identityAccessService';

describe('slugify', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(slugify('John Doe')).toBe('john_doe');
  });
});
```

### Integration tests

Use the shared helper from `tests/fixtures/testDb.ts` for new test files:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { insertMember, insertEvent } from '../fixtures/factories';
import { createSessionCookie } from '../../src/middleware/authStub';

const { dbPath, sessionSecret } = setTestEnv('3050');

let createApp: Awaited<ReturnType<typeof importApp>>;

beforeAll(async () => {
  const db = createTestDb(dbPath);

  insertMember(db, { id: 'test-001', slug: 'test_user' });
  insertEvent(db, { status: 'published', title: 'Spring Classic' });

  db.close();
  createApp = await importApp();
});

afterAll(() => cleanupTestDb(dbPath));

function authCookie(): string {
  return `footbag_session=${createSessionCookie('test-001', 'member', sessionSecret, 'Test User', 'test_user')}`;
}

describe('GET /events', () => {
  it('lists published events', async () => {
    const app = createApp();
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Spring Classic');
  });
});
```

Use factories from `tests/fixtures/factories.ts`. Insert only what the tests need. Use `insertMember()` overrides for edge cases (e.g., `{ is_hof: 1 }`, `{ is_deceased: 1 }`, `{ personal_data_purged_at: '2025-01-01T00:00:00.000Z' }`).

## Step 6 — Run and report

```bash
npm test              # all tests
npm run test:unit     # unit tests only
npm run test:integration  # integration tests only
npm run test:coverage # with coverage report
npm run build         # type-check
```

Report: which tests were added, what each asserts, whether all tests pass, and whether type-check is clean. Flag any failures with the full error output.

## Smoke tests

Run via `npm run test:smoke` against real staging AWS. Gated behind `RUN_STAGING_SMOKE=1` (set by `scripts/test-smoke.sh`). Excluded from default test runs and CI. The canonical example is `tests/smoke/staging-readiness.test.ts`.

**Scope: wiring only.** Smoke verifies that the running infrastructure can reach AWS with the correct identity, the right resources exist with the right metadata, and adapter calls succeed end-to-end. Smoke is not for application logic or library behavior.

In scope for smoke:
- Identity resolution (assumed-role ARN matches the expected role)
- AWS resource metadata (key spec, key usage, signing algorithms)
- Adapter round-trip via real AWS (KMS sign+verify, SES send to mailbox simulator)
- Alias and ARN addressing variants the production code uses
- Adapter codepaths whose AWS-side behavior differs (e.g., `msg.from` override changes the SES `Source` field)

Out of scope for smoke (use unit tests against the adapter):
- Token tampering, expired-token, `alg=none` rejection
- Adapter input validation, encoding, error-class shaping
- Default-vs-override branches whose AWS-side behavior is identical

Out of scope for smoke (use integration tests):
- End-to-end flows (password reset, outbox drain)
- Bounce / complaint webhook handling
- Suppression list, rate-limit, retry behavior

**Bar for adding a smoke assertion:**
- Must require real AWS to verify (not coverable by a stub)
- Must catch a specific, named misconfiguration not already detected
- Must be deterministic (no clock-dependence, no rate-limit-dependence)

Update the test file's header docblock with the new failure-mode entry whenever a smoke assertion lands.

**Adapter parity (long-term).** Per `.claude/rules/testing.md` "Dev↔staging adapter parity," every adapter has three layers: boot-time config (`tests/unit/env-config.test.ts`), interface parity with an injected fake AWS client (`tests/integration/adapter-parity.test.ts`), and the staging smoke. Smoke is the only layer that needs real AWS; do not duplicate parity-test assertions into smoke.

## Mutation tests (DB writes)

If a test writes to the database, isolate it: use a fresh per-test DB path, or wrap the mutation in a transaction and roll back in `afterEach`. Do not let writes from one test affect reads in another.

## Composition order

`write-tests` fits anywhere in the flow: before implementation (spec), alongside (driven by code), or after (coverage pass).

Full skill sequence: `extend-service-contract` -> `add-public-page` -> `write-tests` -> `doc-sync` -> `prepare-pr`
