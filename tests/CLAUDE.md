# tests/ — Testing conventions

## Framework

- **Runner:** Vitest (`npm test` = `vitest run`; `npm run test:watch` = `vitest`)
- **HTTP assertions:** Supertest
- **Database:** better-sqlite3 (synchronous, real SQLite — no mocking)

## Test strategy

All tests are integration tests that exercise real HTTP routes against a real SQLite database. No mocks — tests run against real code paths.

Tests can be written before, during, or after implementation — whenever they add the most value. The goal is meaningful coverage, not ceremony.

## Database isolation

Each test file sets `FOOTBAG_DB_PATH` to a unique temp path **before any module import**, so `db.ts` opens the test database. `beforeAll` builds the schema from `database/schema.sql` and inserts test data using factories. `afterAll` removes the temp DB and WAL sidecars.

For mutation tests: either use a fresh per-test DB, or wrap mutations in a transaction and roll back. Do not let one test's writes corrupt another test's reads.

## Test data: use factories

Use the factory helpers in `tests/fixtures/factories.ts` to insert test data. Each factory accepts optional overrides and returns the inserted ID.

```typescript
import { insertEvent, insertMember, insertDiscipline } from '../fixtures/factories';

// Insert only what the test needs
const memberId = insertMember(db);
const eventId  = insertEvent(db, { status: 'draft', title: 'Secret Draft' });
const discId   = insertDiscipline(db, eventId, { name: 'Freestyle' });
```

Available factories: `insertMember`, `insertTag`, `insertEvent`, `insertDiscipline`, `insertResultsUpload`, `insertResultEntry`, `insertResultParticipant`, `insertHistoricalPerson`.

Insert only the rows a given test suite needs. Do not assume rows from other test files exist. Keep seed data deterministic — no random values, no timestamps that vary between runs.

## File layout

```
tests/
  fixtures/
    factories.ts         ← test data factories (use these)
  integration/
    app.routes.test.ts   ← existing integration tests
```

New test files go in `tests/integration/`. Name them `{domain}.routes.test.ts` or `{domain}.service.test.ts`.

## What to test

For every new route, good coverage includes:
- Happy path — correct HTTP status and expected content
- Auth gate — 302 redirect if unauthenticated, 200 if authenticated (for protected routes)
- Not-found / invalid input — 404 or 400 as appropriate
- Draft/unpublished content does not appear in public responses
- Route ordering — more-specific routes match before catch-alls

For every new service method (exercised through routes):
- Correct output shape for the page view-model
- Business rule enforcement (filters, sorts, eligibility checks)
- Edge cases from `docs/USER_STORIES.md` or `docs/SERVICE_CATALOG.md`

Adversarial tests are valuable: try to break your own feature before production does.

## Running tests

```bash
npm test              # run all tests once
npm run test:watch    # watch mode
npm run build         # tsc type-check — must pass before any PR
```

## CI

On every push and PR, GitHub Actions runs `npm run build` then `npm test`. PRs cannot merge unless CI passes. See `.github/workflows/ci.yml`.

Branch protection rules to configure in GitHub (Settings > Branches > main):
- Require status checks to pass before merging: select `ci / Type-check and test`
- Require branches to be up to date before merging
- Do not allow bypassing the above settings
