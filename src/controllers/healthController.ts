import { Request, Response } from 'express';
import { operationsPlatformService } from '../services/operationsPlatformService';

export const healthController = {
  /**
   * GET /health/live
   * Process-only liveness probe. No DB involved, if this process can respond
   * to HTTP, it is alive.
   */
  live(_req: Request, res: Response): void {
    res.json({ ok: true, check: 'live' });
  },

  /**
   * GET /health/ready
   * Minimal readiness probe. Delegates to OperationsPlatformService which
   * runs a cheap SQLite query. Returns 200 if ready, 503 if not.
   */
  ready(_req: Request, res: Response): void {
    const status = operationsPlatformService.checkReadiness();
    res.status(status.isReady ? 200 : 503).json({
      ok: status.isReady,
      check: 'ready',
      checks: status.checks,
    });
  },
};
