import { Request, Response, NextFunction } from 'express';
import { memberService } from '../services/memberService';
import { NotFoundError } from '../services/serviceErrors';
import { logger } from '../config/logger';

export const memberController = {
  index(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = memberService.getPublicMembersLandingPage();
      res.render('members/index', vm);
    } catch (err) {
      logger.error('members index error', {
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  },

  detail(req: Request, res: Response, next: NextFunction): void {
    try {
      const { personId } = req.params;
      const vm = memberService.getHistoricalMemberPage(personId);
      res.render('members/detail', vm);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      logger.error('member detail error', {
        personId: req.params.personId,
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  },
};
