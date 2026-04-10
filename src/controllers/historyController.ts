import { Request, Response, NextFunction } from 'express';
import { historyService } from '../services/historyService';
import { NotFoundError } from '../services/serviceErrors';
import { logger } from '../config/logger';

function redirectToLogin(req: Request, res: Response): void {
  res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
}

export const historyController = {
  /** GET /history/:personId -- service decides: redirect, require auth, or render. */
  detail(req: Request, res: Response, next: NextFunction): void {
    try {
      const result = historyService.getHistoricalPlayerPage(req.params.personId, req.isAuthenticated);
      switch (result.action) {
        case 'redirect':
          res.redirect(301, result.href);
          break;
        case 'requireAuth':
          redirectToLogin(req, res);
          break;
        case 'render':
          res.render('history/detail', result.vm);
          break;
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      logger.error('history detail error', {
        personId: req.params.personId,
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  },
};
