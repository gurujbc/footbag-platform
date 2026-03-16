/**
 * Worker entry point — MVFP v0.1 stub.
 *
 * Background jobs (email outbox, DB backup, cleanup, etc.) are out of scope
 * for the initial public Events + Results slice. This file exists so the
 * worker container has a valid entry point and the compose stack can start
 * without errors.
 *
 * When job processing is implemented, OperationsPlatformService will own the
 * job catalog and scheduler integration.
 */
import 'dotenv/config';
import { logger } from './config/logger';

logger.info('worker started', { note: 'no jobs configured for MVFP v0.1 — exiting cleanly' });
process.exit(0);
