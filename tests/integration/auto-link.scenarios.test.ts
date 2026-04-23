/**
 * Table-driven auto-link scenario matrix.
 *
 * Drives every scenario in `tests/fixtures/autoLinkScenarios.ts` through its
 * declared `driver`:
 *   - 'verify':  POST /verify/:token → assert redirect.
 *   - 'direct':  identityAccessService.getAutoLinkClassificationForMember → assert tier.
 *
 * Read-only: the seeded rows exist to exercise classification branches.
 * No rows are modified by the tests; the "already linked" case pre-seeds
 * its mutation, and no `claim*` commit code is called anywhere in this
 * file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setTestEnv, createTestDb, cleanupTestDb, importApp } from '../fixtures/testDb';
import { AUTO_LINK_SCENARIOS, seedAllScenarios, ExpectedBranch } from '../fixtures/autoLinkScenarios';

const { dbPath } = setTestEnv('3102');

let createApp: Awaited<ReturnType<typeof importApp>>;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let identitySvc: typeof import('../../src/services/identityAccessService');
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let tokenSvc: typeof import('../../src/services/accountTokenService');

beforeAll(async () => {
  const db = createTestDb(dbPath);
  seedAllScenarios(db);
  db.close();
  createApp = await importApp();
  identitySvc = await import('../../src/services/identityAccessService');
  tokenSvc = await import('../../src/services/accountTokenService');
});

afterAll(() => cleanupTestDb(dbPath));

function branchOf(classification: { tier: string; reason?: string }): ExpectedBranch {
  if (classification.tier === 'none')  return 'none';
  if (classification.tier === 'tier1') return 'tier1';
  if (classification.tier === 'tier2') return 'tier2';
  if (classification.tier === 'tier3') {
    return `tier3_${classification.reason}` as ExpectedBranch;
  }
  throw new Error(`unknown tier: ${classification.tier}`);
}

describe('auto-link scenarios — verify-driven branches', () => {
  const verifyScenarios = AUTO_LINK_SCENARIOS.filter((s) => s.driver === 'verify');

  for (const sc of verifyScenarios) {
    it(`${sc.id}: ${sc.description}`, async () => {
      const { rawToken } = tokenSvc.accountTokenService.issueToken({
        memberId: sc.id,
        tokenType: 'email_verify',
        ttlHours: 24,
      });
      const res = await request(createApp()).get(`/verify/${rawToken}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(sc.expectedVerifyRedirect);
    });
  }
});

describe('auto-link scenarios — classifier output for verify-driven branches', () => {
  const verifyScenarios = AUTO_LINK_SCENARIOS.filter((s) => s.driver === 'verify');

  for (const sc of verifyScenarios) {
    it(`${sc.id} classifies as ${sc.expected}`, async () => {
      const { rawToken } = tokenSvc.accountTokenService.issueToken({
        memberId: sc.id,
        tokenType: 'email_verify',
        ttlHours: 24,
      });
      const result = await identitySvc.identityAccessService.verifyEmailByToken(rawToken);
      expect(result).not.toBeNull();
      expect(branchOf(result!.autoLinkClassification)).toBe(sc.expected);
    });
  }
});

describe('auto-link scenarios — direct-driven branches (cannot go through verify)', () => {
  const directScenarios = AUTO_LINK_SCENARIOS.filter((s) => s.driver === 'direct');

  for (const sc of directScenarios) {
    it(`${sc.id}: ${sc.description}`, () => {
      const classification =
        identitySvc.identityAccessService.getAutoLinkClassificationForMember(sc.id);
      // Both 'already_linked' and 'missing_login_email' surface as 'none'
      // via getAutoLinkClassificationForMember. That's intentional: the
      // helper collapses both guard paths to the same neutral response so
      // /history/auto-link falls through to /history/claim in either case.
      expect(classification).toEqual({ tier: 'none' });
    });
  }
});
