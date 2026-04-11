import { Request, Response, NextFunction } from 'express';
import { consecutiveService } from '../services/consecutiveService';
import { ServiceUnavailableError } from '../services/serviceErrors';
import { logger } from '../config/logger';

/**
 * Thin controller for public consecutive kicks routes.
 * Business logic and page shaping live in consecutiveService.
 */
export const consecutiveController = {
  /** GET /consecutive */
  records(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = consecutiveService.getRecordsPage();
      res.render('consecutive/records', vm);
    } catch (err) {
      consecutiveController._handleError(err, res, next);
    }
  },

  _handleError(err: unknown, res: Response, next: NextFunction): void {
    if (err instanceof ServiceUnavailableError) {
      res.status(503).render('errors/unavailable', {
        seo:  { title: 'Service Unavailable' },
        page: { sectionKey: '', pageKey: 'error_503', title: 'Service Unavailable' },
      });
      return;
    }
    logger.error('unexpected error in consecutive controller', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  },
};
