/**
 * Integration tests for accountTokenService.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { setTestEnv, createTestDb, cleanupTestDb } from '../fixtures/testDb';
import { insertMember } from '../fixtures/factories';

const { dbPath } = setTestEnv('3068');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let accountTokenService: typeof import('../../src/services/accountTokenService').accountTokenService;

const MEMBER_ID = 'token-test-001';

beforeAll(async () => {
  const db = createTestDb(dbPath);
  insertMember(db, { id: MEMBER_ID, slug: 'token_tester', login_email: 'tokens@example.com' });
  db.close();
  const mod = await import('../../src/services/accountTokenService');
  accountTokenService = mod.accountTokenService;
});

afterAll(() => cleanupTestDb(dbPath));

function tokenRow(id: string): Record<string, unknown> | undefined {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const row = db.prepare('SELECT * FROM account_tokens WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  db.close();
  return row;
}

describe('accountTokenService.issueToken', () => {
  it('returns a URL-safe raw token and persists only its hash', () => {
    const { rawToken, tokenRowId } = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 24,
    });
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const row = tokenRow(tokenRowId)!;
    const expectedHash = createHash('sha256').update(rawToken).digest('hex');
    expect(row.token_hash).toBe(expectedHash);
    // Raw token MUST NOT appear anywhere in the row.
    const serialized = JSON.stringify(row);
    expect(serialized.includes(rawToken)).toBe(false);
  });

  it('issues distinct tokens on repeated calls', () => {
    const a = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 24,
    });
    const b = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 24,
    });
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenRowId).not.toBe(b.tokenRowId);
  });

  it('records expires_at per ttlHours', () => {
    const before = Date.now();
    const { tokenRowId } = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'password_reset', ttlHours: 1,
    });
    const row = tokenRow(tokenRowId)!;
    const expiresMs = new Date(row.expires_at as string).getTime();
    expect(expiresMs - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(expiresMs - before).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  it('rejects ttlHours <= 0', () => {
    expect(() =>
      accountTokenService.issueToken({
        memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 0,
      }),
    ).toThrow();
  });
});

describe('accountTokenService.consumeToken', () => {
  it('consumes a valid unused token and returns memberId', () => {
    const { rawToken } = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 1,
    });
    const result = accountTokenService.consumeToken(rawToken, 'email_verify');
    expect(result).not.toBeNull();
    expect(result!.memberId).toBe(MEMBER_ID);
  });

  it('is single-use: second consume returns null', () => {
    const { rawToken } = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 1,
    });
    const first = accountTokenService.consumeToken(rawToken, 'email_verify');
    expect(first).not.toBeNull();
    const second = accountTokenService.consumeToken(rawToken, 'email_verify');
    expect(second).toBeNull();
  });

  it('rejects a token presented with a wrong tokenType', () => {
    const { rawToken } = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 1,
    });
    expect(accountTokenService.consumeToken(rawToken, 'password_reset')).toBeNull();
  });

  it('rejects an unknown raw token', () => {
    expect(accountTokenService.consumeToken('not-a-real-token', 'email_verify')).toBeNull();
  });

  it('rejects an empty raw token', () => {
    expect(accountTokenService.consumeToken('', 'email_verify')).toBeNull();
  });

  it('rejects an expired token', () => {
    const { rawToken, tokenRowId } = accountTokenService.issueToken({
      memberId: MEMBER_ID, tokenType: 'email_verify', ttlHours: 1,
    });
    // Patch expires_at into the past via direct SQL (the service never allows this).
    const db = new BetterSqlite3(dbPath);
    db.prepare('UPDATE account_tokens SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', tokenRowId);
    db.close();
    expect(accountTokenService.consumeToken(rawToken, 'email_verify')).toBeNull();
  });
});
