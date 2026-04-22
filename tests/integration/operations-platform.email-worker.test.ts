/**
 * Integration tests for OperationsPlatformService.runEmailWorker — the
 * delegation surface the worker.ts polling loop calls.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb } from '../fixtures/testDb';
import { insertMember } from '../fixtures/factories';

const { dbPath } = setTestEnv('3067');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let operationsPlatformService: typeof import('../../src/services/operationsPlatformService').operationsPlatformService;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getStubSesAdapterForTests: typeof import('../../src/adapters/sesAdapter').getStubSesAdapterForTests;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let resetCommunicationServiceForTests: typeof import('../../src/services/communicationService').resetCommunicationServiceForTests;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let resetSesAdapterForTests: typeof import('../../src/adapters/sesAdapter').resetSesAdapterForTests;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getCommunicationService: typeof import('../../src/services/communicationService').getCommunicationService;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let logger: typeof import('../../src/config/logger').logger;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  // Seed members referenced by outbox recipient_member_id in the logging tests.
  // The FK outbox_emails.recipient_member_id → members.id requires real rows.
  insertMember(db, { id: 'member-log-sent',  slug: 'log_sent_user',  login_email: 'log-sent@example.com'  });
  insertMember(db, { id: 'member-log-retry', slug: 'log_retry_user', login_email: 'log-retry@example.com' });
  insertMember(db, { id: 'member-log-dead',  slug: 'log_dead_user',  login_email: 'log-dead@example.com'  });
  db.close();
  const opsMod = await import('../../src/services/operationsPlatformService');
  operationsPlatformService = opsMod.operationsPlatformService;
  const commsMod = await import('../../src/services/communicationService');
  const sesMod = await import('../../src/adapters/sesAdapter');
  getStubSesAdapterForTests = sesMod.getStubSesAdapterForTests;
  resetSesAdapterForTests = sesMod.resetSesAdapterForTests;
  resetCommunicationServiceForTests = commsMod.resetCommunicationServiceForTests;
  getCommunicationService = commsMod.getCommunicationService;
  const logMod = await import('../../src/config/logger');
  logger = logMod.logger;
});

afterAll(() => cleanupTestDb(dbPath));

beforeEach(() => {
  const db = new BetterSqlite3(dbPath);
  db.prepare('DELETE FROM outbox_emails').run();
  db.close();
  resetCommunicationServiceForTests();
  resetSesAdapterForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OperationsPlatformService.runEmailWorker', () => {
  it('drains pending rows via the stub SES adapter', async () => {
    const comms = getCommunicationService();
    comms.enqueueEmail({
      recipientEmail: 'worker-test@example.com',
      subject: 'Hello',
      bodyText: 'body',
    });

    const result = await operationsPlatformService.runEmailWorker();
    expect(result.paused).toBe(false);
    expect(result.sent).toBe(1);

    const stub = getStubSesAdapterForTests();
    expect(stub).not.toBeNull();
    expect(stub!.sentMessages).toHaveLength(1);
    expect(stub!.sentMessages[0].to).toBe('worker-test@example.com');
  });

  it('reports paused when email_outbox_paused=1 (no rows claimed)', async () => {
    const comms = getCommunicationService();
    comms.enqueueEmail({
      recipientEmail: 'paused@example.com',
      subject: 'Hi',
      bodyText: 'x',
    });

    const db = new BetterSqlite3(dbPath);
    db.prepare(`
      INSERT INTO system_config
        (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
      VALUES (?, ?, 'email_outbox_paused', '1', ?, 'Test pause', NULL)
    `).run(
      'ops-test-pause',
      '2026-04-17T00:00:00.000Z',
      '2026-04-17T00:00:00.000Z',
    );
    db.close();

    const result = await operationsPlatformService.runEmailWorker();
    expect(result.paused).toBe(true);
    expect(result.claimed).toBe(0);

    // Restore default for subsequent tests in this file.
    const db2 = new BetterSqlite3(dbPath);
    db2.prepare(`
      INSERT INTO system_config
        (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
      VALUES (?, ?, 'email_outbox_paused', '0', ?, 'Test unpause', NULL)
    `).run(
      'ops-test-unpause',
      '2026-04-17T00:00:01.000Z',
      '2026-04-17T00:00:01.000Z',
    );
    db2.close();
  });

  it('getOutboxPollIntervalMs respects seed and clamps to >=1 second', () => {
    const ms = operationsPlatformService.getOutboxPollIntervalMs();
    expect(ms).toBeGreaterThanOrEqual(1000);
    // seed-outbox-poll-interval-seconds = 30 → 30_000
    expect(ms).toBe(30 * 1000);
  });

  // Outbox worker per-email observability (USER_STORIES §SYS_Send_Email lines
  // 2089-2092). PII allowlist: outboxId, memberId, deliveryResult, attemptCount,
  // errorClass. Forbidden: recipientEmail, bodyText, subject, raw err.message.
  //
  // These assertions close the exact gap that made the first staging
  // registration impossible to diagnose without hand-reading the database.

  const ALLOWED_META_KEYS_SUCCESS = new Set(['outboxId', 'memberId', 'deliveryResult']);
  const ALLOWED_META_KEYS_FAILURE = new Set(['outboxId', 'memberId', 'deliveryResult', 'attemptCount', 'errorClass']);

  it('logs outbox sent with allowlisted metadata on success', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const comms = getCommunicationService();
    comms.enqueueEmail({
      recipientEmail: 'log-sent@example.com',
      recipientMemberId: 'member-log-sent',
      subject: 'Hi',
      bodyText: 'x',
    });

    await operationsPlatformService.runEmailWorker();

    const sentCalls = infoSpy.mock.calls.filter(([msg]) => msg === 'outbox sent');
    expect(sentCalls).toHaveLength(1);
    const [, meta] = sentCalls[0];
    expect(meta).toBeDefined();
    const m = meta as Record<string, unknown>;
    expect(m.memberId).toBe('member-log-sent');
    expect(typeof m.outboxId).toBe('string');
    expect(m.deliveryResult).toBe('sent');
    // PII allowlist: no extra keys permitted (esp. recipientEmail, bodyText).
    expect(new Set(Object.keys(m))).toEqual(ALLOWED_META_KEYS_SUCCESS);
  });

  it('logs outbox retrying with allowlisted metadata and errorClass on transient SES failure', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const comms = getCommunicationService();
    comms.enqueueEmail({
      recipientEmail: 'log-retry@example.com',
      recipientMemberId: 'member-log-retry',
      subject: 'Hi',
      bodyText: 'x',
    });

    class TransientSendError extends Error {}
    const stub = getStubSesAdapterForTests();
    expect(stub).not.toBeNull();
    stub!.failNext(new TransientSendError('downstream flap'));

    await operationsPlatformService.runEmailWorker();

    const retryCalls = warnSpy.mock.calls.filter(([msg]) => msg === 'outbox retrying');
    expect(retryCalls).toHaveLength(1);
    const [, meta] = retryCalls[0];
    const m = meta as Record<string, unknown>;
    expect(m.memberId).toBe('member-log-retry');
    expect(typeof m.outboxId).toBe('string');
    expect(m.deliveryResult).toBe('retrying');
    expect(m.attemptCount).toBe(1);
    expect(m.errorClass).toBe('TransientSendError');
    expect(new Set(Object.keys(m))).toEqual(ALLOWED_META_KEYS_FAILURE);
  });

  it('logs outbox dead-letter with allowlisted metadata when retries exhausted', async () => {
    // Force max-retries=1 so the first failure trips dead-letter.
    const db = new BetterSqlite3(dbPath);
    db.prepare(`
      INSERT INTO system_config
        (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
      VALUES (?, ?, 'outbox_max_retry_attempts', '1', ?, 'Force dead-letter', NULL)
    `).run(
      'ops-test-max-retries',
      '2026-04-20T00:00:00.000Z',
      '2026-04-20T00:00:00.000Z',
    );
    db.close();

    const errorSpy = vi.spyOn(logger, 'error');
    const comms = getCommunicationService();
    comms.enqueueEmail({
      recipientEmail: 'log-dead@example.com',
      recipientMemberId: 'member-log-dead',
      subject: 'Hi',
      bodyText: 'x',
    });

    class PermanentSendError extends Error {}
    const stub = getStubSesAdapterForTests();
    stub!.failNext(new PermanentSendError('address rejected'));

    await operationsPlatformService.runEmailWorker();

    // Restore default max-retries via a later-effective config row.
    const db2 = new BetterSqlite3(dbPath);
    db2.prepare(`
      INSERT INTO system_config
        (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
      VALUES (?, ?, 'outbox_max_retry_attempts', '5', ?, 'Restore default', NULL)
    `).run(
      'ops-test-max-retries-restore',
      '2026-04-20T00:00:01.000Z',
      '2026-04-20T00:00:01.000Z',
    );
    db2.close();

    const deadCalls = errorSpy.mock.calls.filter(([msg]) => msg === 'outbox dead-letter');
    expect(deadCalls).toHaveLength(1);
    const [, meta] = deadCalls[0];
    const m = meta as Record<string, unknown>;
    expect(m.memberId).toBe('member-log-dead');
    expect(typeof m.outboxId).toBe('string');
    expect(m.deliveryResult).toBe('dead_letter');
    expect(m.attemptCount).toBe(1);
    expect(m.errorClass).toBe('PermanentSendError');
    expect(new Set(Object.keys(m))).toEqual(ALLOWED_META_KEYS_FAILURE);
  });
});
