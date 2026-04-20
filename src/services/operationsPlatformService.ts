import { health } from '../db/db';
import { runSqliteRead } from './sqliteRetry';
import { getCommunicationService, type ProcessBatchResult } from './communicationService';
import { readIntConfig } from './configReader';
import { logger } from '../config/logger';

export interface ReadinessStatus {
  isReady: boolean;
  checks: {
    database: {
      isReady: boolean;
    };
  };
}

/**
 * Operations service surface.
 *
 * Readiness composition belongs here, not in db.ts. Currently the only
 * implemented dependency check is the minimal DB probe from db.ts.
 */
export class OperationsPlatformService {
  /**
   * Single iteration of the email-outbox drain. Delegates to
   * CommunicationService.processSendQueue and logs the outcome. Returns the
   * structured result so callers (worker loop, tests) can act on it.
   */
  async runEmailWorker(opts: { limit?: number } = {}): Promise<ProcessBatchResult> {
    const comms = getCommunicationService();
    const result = await comms.processSendQueue({ limit: opts.limit });
    if (result.paused) {
      logger.info('email worker: paused', { ...result });
    } else if (result.claimed > 0) {
      logger.info('email worker: drained batch', { ...result });
    }
    return result;
  }

  /**
   * Returns the configured polling interval in milliseconds. Reads from
   * system_config, clamped to a safe minimum so a misconfiguration cannot
   * pin the worker in a hot loop.
   */
  getOutboxPollIntervalMs(): number {
    const minutes = readIntConfig('outbox_poll_interval_minutes', 5);
    const clamped = Math.max(1, minutes);
    return clamped * 60 * 1000;
  }

  checkReadiness(): ReadinessStatus {
    try {
      const row = runSqliteRead('checkReadiness', () =>
        health.checkReady.get() as { is_ready: number } | undefined,
      );

      const databaseReady = row?.is_ready === 1;

      return {
        isReady: databaseReady,
        checks: {
          database: {
            isReady: databaseReady,
          },
        },
      };
    } catch {
      return {
        isReady: false,
        checks: {
          database: {
            isReady: false,
          },
        },
      };
    }
  }
}

export const operationsPlatformService = new OperationsPlatformService();
