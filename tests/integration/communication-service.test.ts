/**
 * Integration tests for CommunicationService: outbox enqueue, drain, retry,
 * dead-letter, and admin pause.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setTestEnv, createTestDb, cleanupTestDb } from '../fixtures/testDb';

const { dbPath } = setTestEnv('3066');

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createCommunicationService: typeof import('../../src/services/communicationService').createCommunicationService;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createStubSesAdapter: typeof import('../../src/adapters/sesAdapter').createStubSesAdapter;

beforeAll(async () => {
  const db = createTestDb(dbPath);
  db.close();
  const commsMod = await import('../../src/services/communicationService');
  const sesMod = await import('../../src/adapters/sesAdapter');
  createCommunicationService = commsMod.createCommunicationService;
  createStubSesAdapter = sesMod.createStubSesAdapter;
});

afterAll(() => cleanupTestDb(dbPath));

/** Clear outbox_emails between tests so state doesn't leak. */
beforeEach(() => {
  const db = new BetterSqlite3(dbPath);
  db.prepare('DELETE FROM outbox_emails').run();
  db.close();
});

function readRow(id: string): Record<string, unknown> {
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const row = db.prepare('SELECT * FROM outbox_emails WHERE id = ?').get(id) as Record<string, unknown>;
  db.close();
  return row;
}

describe('enqueueEmail', () => {
  it('inserts a pending row', () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const { id, status } = svc.enqueueEmail({
      recipientEmail: 'to@example.com',
      subject: 'Hi',
      bodyText: 'hello',
    });
    expect(status).toBe('enqueued');
    const row = readRow(id);
    expect(row.status).toBe('pending');
    expect(row.recipient_email).toBe('to@example.com');
    expect(row.retry_count).toBe(0);
  });

  it('rejects duplicate idempotency_key as "duplicate"', () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const first = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'A', bodyText: 'x',
      idempotencyKey: 'idem-1',
    });
    const second = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'A', bodyText: 'x',
      idempotencyKey: 'idem-1',
    });
    expect(first.status).toBe('enqueued');
    expect(second.status).toBe('duplicate');
    const db = new BetterSqlite3(dbPath, { readonly: true });
    const count = db.prepare('SELECT COUNT(*) AS n FROM outbox_emails WHERE idempotency_key=?')
      .get('idem-1') as { n: number };
    db.close();
    expect(count.n).toBe(1);
  });

  it('returns the original row id on idempotency-key retry', () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const first = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'A', bodyText: 'x',
      idempotencyKey: 'idem-retry',
    });
    const second = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'A', bodyText: 'x',
      idempotencyKey: 'idem-retry',
    });
    const third = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'A', bodyText: 'x',
      idempotencyKey: 'idem-retry',
    });
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
  });

  it('returns the original row id even when retry payload differs', () => {
    // Idempotency takes precedence over payload equality: once a key is
    // claimed, any later enqueue with that key returns the same id.
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const first = svc.enqueueEmail({
      recipientEmail: 'original@example.com', subject: 'Original', bodyText: 'first body',
      idempotencyKey: 'idem-diff',
    });
    const retry = svc.enqueueEmail({
      recipientEmail: 'different@example.com', subject: 'Different', bodyText: 'other body',
      idempotencyKey: 'idem-diff',
    });
    expect(retry.status).toBe('duplicate');
    expect(retry.id).toBe(first.id);
    const row = readRow(first.id);
    expect(row.recipient_email).toBe('original@example.com');
    expect(row.subject).toBe('Original');
  });

  it('different idempotency keys produce different ids', () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const a = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'A', bodyText: 'x',
      idempotencyKey: 'idem-A',
    });
    const b = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'B', bodyText: 'y',
      idempotencyKey: 'idem-B',
    });
    expect(a.status).toBe('enqueued');
    expect(b.status).toBe('enqueued');
    expect(a.id).not.toBe(b.id);
  });

  it('absent idempotency key allows multiple distinct rows', () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const a = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'Hi', bodyText: 'x',
    });
    const b = svc.enqueueEmail({
      recipientEmail: 'to@example.com', subject: 'Hi', bodyText: 'x',
    });
    expect(a.status).toBe('enqueued');
    expect(b.status).toBe('enqueued');
    expect(a.id).not.toBe(b.id);
  });

  it('requires recipientEmail, subject, bodyText', () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    expect(() => svc.enqueueEmail({ recipientEmail: '', subject: 's', bodyText: 'b' })).toThrow();
    expect(() => svc.enqueueEmail({ recipientEmail: 'a@b.c', subject: '', bodyText: 'b' })).toThrow();
    expect(() => svc.enqueueEmail({ recipientEmail: 'a@b.c', subject: 's', bodyText: '' })).toThrow();
  });
});

describe('processSendQueue', () => {
  it('drains pending → sent via adapter', async () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const { id } = svc.enqueueEmail({
      recipientEmail: 'a@example.com', subject: 'Hi', bodyText: 'b',
    });
    const res = await svc.processSendQueue();
    expect(res.sent).toBe(1);
    expect(res.claimed).toBe(1);
    expect(stub.sentMessages).toHaveLength(1);
    expect(stub.sentMessages[0].to).toBe('a@example.com');
    const row = readRow(id);
    expect(row.status).toBe('sent');
    expect(row.sent_at).not.toBeNull();
  });

  it('scrubs body_text to NULL after successful send (no token persistence in DB backups)', async () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const { id } = svc.enqueueEmail({
      recipientEmail: 'scrub@example.com',
      subject: 'Reset link',
      bodyText: 'Visit https://example.com/password/reset/raw-token-abc-123 to continue.',
    });
    // Pre-send: body_text intact for the worker to read.
    expect(readRow(id).body_text).toContain('raw-token-abc-123');
    await svc.processSendQueue();
    const row = readRow(id);
    expect(row.status).toBe('sent');
    expect(row.body_text).toBeNull();
    // Subject is preserved (no token in subject by design).
    expect(row.subject).toBe('Reset link');
  });

  it('transient failure stays pending, increments retry_count, records last_error', async () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const { id } = svc.enqueueEmail({
      recipientEmail: 'a@example.com', subject: 'Hi', bodyText: 'b',
    });
    stub.failNext(new Error('boom'));
    const res = await svc.processSendQueue();
    expect(res.failed).toBe(1);
    const row = readRow(id);
    expect(row.status).toBe('pending');
    expect(row.retry_count).toBe(1);
    expect(row.last_error).toBe('boom');
  });

  it('moves to dead_letter on last allowed retry', async () => {
    // outbox_max_retry_attempts default is 5; fail 5 times in a row.
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const { id } = svc.enqueueEmail({
      recipientEmail: 'a@example.com', subject: 'Hi', bodyText: 'b',
    });
    for (let i = 0; i < 5; i++) {
      stub.failNext(new Error(`attempt-${i + 1}`));
      // eslint-disable-next-line no-await-in-loop
      await svc.processSendQueue();
    }
    const row = readRow(id);
    expect(row.status).toBe('dead_letter');
    expect(row.retry_count).toBe(5);
  });

  it('respects admin pause (email_outbox_paused=1)', async () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const { id } = svc.enqueueEmail({
      recipientEmail: 'a@example.com', subject: 'Hi', bodyText: 'b',
    });
    // Insert a later-effective system_config row setting paused=1.
    const db = new BetterSqlite3(dbPath);
    db.prepare(`
      INSERT INTO system_config
        (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
      VALUES (?, ?, 'email_outbox_paused', '1', ?, 'Test pause', NULL)
    `).run(
      'test-pause-row',
      '2026-04-17T00:00:00.000Z',
      '2026-04-17T00:00:00.000Z',
    );
    db.close();
    const res = await svc.processSendQueue();
    expect(res.paused).toBe(true);
    expect(res.sent).toBe(0);
    const row = readRow(id);
    expect(row.status).toBe('pending');
    // Undo pause so other tests are unaffected.
    const db2 = new BetterSqlite3(dbPath);
    db2.prepare(`
      INSERT INTO system_config
        (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
      VALUES (?, ?, 'email_outbox_paused', '0', ?, 'Test unpause', NULL)
    `).run(
      'test-unpause-row',
      '2026-04-17T00:00:01.000Z',
      '2026-04-17T00:00:01.000Z',
    );
    db2.close();
  });

  it('respects scheduled_for (future rows not claimed)', async () => {
    const stub = createStubSesAdapter();
    const svc = createCommunicationService(stub);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { id } = svc.enqueueEmail({
      recipientEmail: 'a@example.com', subject: 'Hi', bodyText: 'b',
      scheduledFor: future,
    });
    const res = await svc.processSendQueue();
    expect(res.claimed).toBe(0);
    const row = readRow(id);
    expect(row.status).toBe('pending');
  });
});
