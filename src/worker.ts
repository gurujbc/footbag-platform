/**
 * Worker entry point for draining the transactional-email outbox.
 *
 * Polling loop:
 *   1. Call operationsPlatformService.runEmailWorker() to drain a batch.
 *   2. Sleep for outbox_poll_interval_minutes (read per-iteration so admin
 *      config changes take effect on the next tick).
 *   3. Exit cleanly on SIGTERM/SIGINT.
 *
 * No direct DB or SES calls live here; this is a delegation layer only.
 */
import 'dotenv/config';
import { logger } from './config/logger';
import { operationsPlatformService } from './services/operationsPlatformService';

let stopping = false;

// Do NOT unref() the timer: the worker has no HTTP server and better-sqlite3
// is synchronous, so an unref'd timer lets Node exit the event loop mid-sleep
// (exit code 0, restart-backoff masquerading as crash-loop).
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loop(): Promise<void> {
  logger.info('worker started', { mode: 'email-outbox' });
  while (!stopping) {
    try {
      await operationsPlatformService.runEmailWorker();
    } catch (err) {
      logger.error('worker: unexpected error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (stopping) break;
    const intervalMs = operationsPlatformService.getOutboxPollIntervalMs();
    await sleep(intervalMs);
  }
  logger.info('worker stopped');
}

function shutdown(signal: NodeJS.Signals): void {
  logger.info('worker: received signal, shutting down', { signal });
  stopping = true;
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

loop().catch((err) => {
  logger.error('worker: fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
