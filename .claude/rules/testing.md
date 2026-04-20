# Testing rules

Tests are load-bearing project infrastructure, not ceremony. Every change that affects behavior lands with tests that cover its intent AND its known failure modes. Test coverage is non-negotiable; only the test *shape* is negotiable.

## Mandate

1. **Every bug fix includes a regression test.** The test must fail against the pre-fix code and pass after the fix. This is how we know the fix is real and prevents recurrence.
2. **Every new feature includes edge-case coverage.** Not just the happy path. The set of edge cases below is the minimum starting point for every feature.
3. **Every service contract change includes shape assertions.** New method, changed return shape, new error class, new validation — each gets an explicit test against the new shape.
4. **Tests land in the same change as the code they cover.** Not "add tests later." Not "will add in a follow-up PR." Not "TODO: test this." In the same diff.

Do not ask whether to add tests. Add them.

## What "edge cases" means

For every public-facing route:

- Happy path — correct HTTP status, expected content, expected redirects.
- Authentication gate — 302 redirect if unauthenticated, 200 if authenticated (for protected routes).
- Authorization gate — 403 or 404 when authenticated-but-not-authorized (admin-only, owner-only, etc.).
- Not-found — 404 for unknown IDs, slugs, keys.
- Invalid input — 400 or 422 for malformed/oversized/wrong-type bodies and query params.
- Draft/unpublished content — must not appear in public responses.
- Route ordering — more-specific routes match before catch-alls.
- Anti-enumeration — endpoints that could leak existence (login, password reset, email verify, claim lookup) must return identical UX for "exists" vs "does not exist" cases.
- Rate-limit behavior — exceeds-limit returns 429 with `Retry-After`.
- CSRF — state-changing verbs (POST/PATCH/PUT/DELETE) reject requests without a matching CSRF token.

For every service method:

- Correct output shape for the intended view-model or contract consumer.
- Business rule enforcement — filters, sorts, eligibility checks, tier gates.
- Transaction atomicity — multi-row writes either all land or none.
- Idempotency — repeating an operation with the same key returns the same id/outcome.
- Error classes — every `throw` path has a test that asserts the thrown class and the message shape.
- Boundary values — zero rows, one row, N rows, N+1 rows, empty strings, unicode, NULLs, extreme dates.
- Edge cases from the relevant `docs/USER_STORIES.md` or `docs/SERVICE_CATALOG.md` entry — read the story before writing the test.

For every pure function / shaping helper:

- Identity cases (empty input → empty output).
- Round-trip stability (shape(shape(x)) === shape(x) when the contract promises idempotency).
- Locale / normalization / case-folding edges.

For every schema change or factory change:

- The factory inserts a row that satisfies all NOT NULL / CHECK / FK constraints.
- The factory's auto-creation of dependent rows (e.g. `legacy_members` stub on passing `legacy_member_id`) is exercised by a test that proves the dependent row appears.

## Adversarial testing

Before calling a test suite complete, try to break the feature. Common attacks:

- Oversized payloads (1 MB subject line, 100 KB email body).
- Unicode mischief (RTL override, zero-width joiners, homoglyph substitutions).
- SQL-injection attempts in every free-text input.
- XSS attempts in every field that lands in a Handlebars template.
- Timing attacks against anti-enumeration endpoints (login, password reset, claim lookup).
- Race conditions — two simultaneous inserts of the same idempotency key; two simultaneous claims of the same legacy account.
- Expired/wrong-type/replay-attack tokens.

If an adversarial test reveals a hole, fix it *and* keep the test.

## Anti-patterns (forbidden)

- **No mocking the DB.** Integration tests run against a real SQLite file per `tests/CLAUDE.md`.
- **No mocking framework internals.** Don't mock Express, Handlebars, JWT, argon2, or SES adapter internals. Use the stub adapters and real middleware.
- **No timestamp / random / UUID leakage.** Tests that compare against `Date.now()`, `randomUUID()`, or `crypto.randomBytes()` without freezing the source produce flake. Freeze time; seed randomness; or assert shape, not value.
- **No global state leakage between test files.** Each file owns its temp DB path; no fixture file assumes rows seeded by another file.
- **No silent skips.** `.skip`, `.todo`, `xit` are forbidden in committed code. If a test can't land, the feature can't either.
- **No "tested manually" as a substitute.** Manual verification is for UI/visual checks. Logic is tested by the suite.
- **No tests that run on the dev DB.** Tests always use `setTestEnv` + `createTestDb` from `tests/fixtures/testDb.ts`.

## Coverage floor

Current thresholds (`vitest.config.ts`): 95% statements, 76% branches, 93% functions. Target: 100% across the board. Coverage never ratchets down. If a change lowers a threshold, the change is wrong — not the threshold.

New source files must land with tests that keep coverage at or above the current floor. Do not lower thresholds to admit new code.

## When tests are insufficient

Tests prove code does what the test expects. They do not prove the code is correct. Before shipping:

- Re-read the user story or design decision that motivated the change.
- Confirm the acceptance criteria are all exercised by at least one test.
- Check that the adversarial tests didn't miss a class of input the story implies.

If the story is unclear, escalate to the human before writing tests that encode a guess.

## Dev↔staging adapter parity

Adapters (`JwtSigningAdapter`, `SesAdapter`, `PhotoStorageAdapter`) are the only seam between dev and staging. Dev uses `local`/`stub` implementations against in-process fakes; staging uses `kms`/`live` implementations against real AWS. Production (when it exists) will reuse the staging adapters against the production AWS account.

Every new adapter, or change to an existing adapter's contract, requires three tests. These are long-term tests that describe a permanent contract, not one-shot verifications for the sprint that introduced them.

1. **Boot-time config test** (in `tests/unit/env-config.test.ts`). `src/config/env.ts` must fail-fast at module-load when required prod-mode env vars are absent, with a specific error message. Add a case per new required env var.

2. **Interface parity test** (in `tests/integration/adapter-parity.test.ts`). Both implementations satisfy the TypeScript interface and produce observable outputs with identical structure. Use an injected fake client to stand in for the AWS SDK call path; do not mock the SDK package itself.

3. **Staging-smoke test** (in `tests/smoke/`). Hits real staging AWS via the assumed-role chain. Gated behind `RUN_STAGING_SMOKE=1` and excluded from the default `npm test` run. Asserts the permanent contract that staging runtime identity is reachable and the adapter's AWS API calls succeed. A failure means staging AWS wiring is broken or incomplete (not that the test is "Phase H-specific" or any other sprint label).

The `tests/smoke/` suite is run by operators on the staging host (or from a workstation with the staging profile configured) after any change to staging AWS runtime identity, KMS keys, SES identities, or IAM policies the app depends on, via `npm run test:smoke`. It is not part of CI and is never run against production.

## Cross-references

- `tests/CLAUDE.md` — conventions (Vitest, Supertest, factories, test DB isolation, file layout).
- `tests/fixtures/factories.ts` — canonical test-data factories; extend these rather than hand-rolling row inserts.
- `tests/fixtures/testDb.ts` — DB setup/teardown helper.
- `docs/USER_STORIES.md` — functional acceptance criteria.
- `docs/SERVICE_CATALOG.md` — service contract shapes.
