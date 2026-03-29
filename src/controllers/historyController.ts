import { Request, Response, NextFunction } from 'express';
import { historyService } from '../services/historyService';
import { NotFoundError } from '../services/serviceErrors';
import { logger } from '../config/logger';

function redirectToLogin(req: Request, res: Response): void {
  res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
}

export const historyController = {
  /** GET /history -- full player index; requires auth. */
  index(req: Request, res: Response, next: NextFunction): void {
    if (!req.isAuthenticated) {
      redirectToLogin(req, res);
      return;
    }
    try {
      const vm = historyService.getHistoryLandingPage();
      res.render('history/index', vm);
    } catch (err) {
      logger.error('history index error', {
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  },

  /** GET /history/:personId -- public for HoF/BAP persons; auth required otherwise. */
  detail(req: Request, res: Response, next: NextFunction): void {
    try {
      const { personId } = req.params;
      const vm = historyService.getHistoricalPlayerPage(personId);

      const isPublicHonor = vm.content.hofMember || vm.content.bapMember;
      if (!isPublicHonor && !req.isAuthenticated) {
        redirectToLogin(req, res);
        return;
      }

      res.render('history/detail', vm);
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
