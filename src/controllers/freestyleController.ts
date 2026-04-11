import { Request, Response, NextFunction } from 'express';
import { freestyleService } from '../services/freestyleService';
import { NotFoundError, ServiceUnavailableError } from '../services/serviceErrors';
import { logger } from '../config/logger';

/**
 * Thin controller for public freestyle routes.
 * Business logic and page shaping live in freestyleService.
 */
export const freestyleController = {
  /** GET /freestyle */
  landing(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = freestyleService.getLandingPage();
      res.render('freestyle/landing', vm);
    } catch (err) {
      freestyleController._handleError(err, res, next);
    }
  },

  /** GET /freestyle/records */
  records(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = freestyleService.getRecordsPage();
      res.render('freestyle/records', vm);
    } catch (err) {
      freestyleController._handleError(err, res, next);
    }
  },

  /** GET /freestyle/leaders */
  leaders(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = freestyleService.getLeadersPage();
      res.render('freestyle/leaders', vm);
    } catch (err) {
      freestyleController._handleError(err, res, next);
    }
  },

  /** GET /freestyle/tricks/:slug */
  trick(req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = freestyleService.getTrickDetailPage(req.params['slug'] ?? '');
      res.render('freestyle/trick', vm);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      freestyleController._handleError(err, res, next);
    }
  },

  /** GET /freestyle/about */
  about(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = freestyleService.getAboutPage();
      res.render('freestyle/about', vm);
    } catch (err) {
      freestyleController._handleError(err, res, next);
    }
  },

  /** GET /freestyle/moves */
  moves(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = freestyleService.getMovesPage();
      res.render('freestyle/moves', vm);
    } catch (err) {
      freestyleController._handleError(err, res, next);
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
    logger.error('unexpected error in freestyle controller', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  },
};
