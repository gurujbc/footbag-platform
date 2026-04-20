import { randomUUID } from 'node:crypto';
import { outbox, type OutboxRow } from '../db/db';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { readIntConfig } from './configReader';
import { ValidationError } from './serviceErrors';
import { SesAdapter, getSesAdapter } from '../adapters/sesAdapter';

export interface EnqueueEmailInput {
  recipientEmail: string;
  recipientMemberId?: string;
  subject: string;
  bodyText: string;
  idempotencyKey?: string;
  scheduledFor?: string;
  mailingListId?: string;
  fromIdentity?: string;
}

export interface EnqueueResult {
  id: string;
  status: 'enqueued' | 'duplicate';
}

export interface ProcessBatchResult {
  claimed: number;
  sent: number;
  failed: number;
  deadLettered: number;
  paused: boolean;
}

export interface CommunicationService {
  enqueueEmail(input: EnqueueEmailInput): EnqueueResult;
  processSendQueue(opts?: { limit?: number }): Promise<ProcessBatchResult>;
}

export function createCommunicationService(
  adapter: SesAdapter,
): CommunicationService {
  const defaultFrom = config.sesFromIdentity;

  return {
    enqueueEmail(input) {
      if (!input.recipientEmail) {
        throw new ValidationError('recipientEmail is required.');
      }
      if (!input.subject || !input.bodyText) {
        throw new ValidationError('subject and bodyText are required.');
      }
      const id = `email_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const now = new Date().toISOString();
      try {
        outbox.insert.run(
          id,
          now,
          now,
          input.idempotencyKey ?? null,
          input.recipientEmail,
          input.recipientMemberId ?? null,
          input.mailingListId ?? null,
          null, // sender_member_id
          input.fromIdentity ?? defaultFrom ?? null,
          input.subject,
          input.bodyText,
          input.scheduledFor ?? null,
        );
        return { id, status: 'enqueued' };
      } catch (err) {
        // Unique idempotency_key conflict → treat as duplicate, not error.
        // Return the EXISTING row's id so retries with the same key are
        // truly idempotent (same id every time, not a fresh one per retry).
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
          input.idempotencyKey
        ) {
          const existing = outbox.findByIdempotencyKey.get(input.idempotencyKey) as
            | { id: string }
            | undefined;
          return { id: existing?.id ?? id, status: 'duplicate' };
        }
        throw err;
      }
    },

    async processSendQueue(opts = {}) {
      const result: ProcessBatchResult = {
        claimed: 0,
        sent: 0,
        failed: 0,
        deadLettered: 0,
        paused: false,
      };

      const paused = readIntConfig('email_outbox_paused', 0) === 1;
      if (paused) {
        result.paused = true;
        return result;
      }

      const maxRetries = readIntConfig('outbox_max_retry_attempts', 5);
      const limit = opts.limit ?? 10;
      const now = new Date().toISOString();

      const rows = outbox.selectPendingBatch.all(now, limit) as OutboxRow[];

      for (const row of rows) {
        const claimedNow = outbox.markSending.run(now, now, row.id);
        if (claimedNow.changes !== 1) continue;
        result.claimed += 1;

        try {
          await adapter.sendEmail({
            to: row.recipient_email ?? '',
            subject: row.subject,
            bodyText: row.body_text,
            from: row.from_identity ?? undefined,
          });
          outbox.markSent.run(new Date().toISOString(), new Date().toISOString(), row.id);
          result.sent += 1;
          logger.info('outbox sent', {
            outboxId: row.id,
            memberId: row.recipient_member_id ?? null,
            deliveryResult: 'sent',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errorClass = err instanceof Error ? err.constructor.name : 'Unknown';
          const nextRetryCount = row.retry_count + 1;
          if (nextRetryCount >= maxRetries) {
            outbox.markDeadLetter.run(message, new Date().toISOString(), row.id);
            result.deadLettered += 1;
            logger.error('outbox dead-letter', {
              outboxId: row.id,
              memberId: row.recipient_member_id ?? null,
              deliveryResult: 'dead_letter',
              attemptCount: nextRetryCount,
              errorClass,
            });
          } else {
            outbox.markFailedRetry.run(message, new Date().toISOString(), row.id);
            result.failed += 1;
            logger.warn('outbox retrying', {
              outboxId: row.id,
              memberId: row.recipient_member_id ?? null,
              deliveryResult: 'retrying',
              attemptCount: nextRetryCount,
              errorClass,
            });
          }
        }
      }
      return result;
    },
  };
}

let singleton: CommunicationService | null = null;

export function getCommunicationService(): CommunicationService {
  if (singleton) return singleton;
  singleton = createCommunicationService(getSesAdapter());
  return singleton;
}

export function resetCommunicationServiceForTests(): void {
  singleton = null;
}
