import { Request, Response, NextFunction } from 'express';
import { clubService } from '../services/clubService';
import { NotFoundError, ValidationError, ServiceUnavailableError } from '../services/serviceErrors';
import { logger } from '../config/logger';

/**
 * Thin controller layer for the public Clubs routes.
 *
 * Responsibilities:
 *  - Parse route params
 *  - Call the appropriate ClubService method
 *  - Render the correct Handlebars template
 *  - Map service errors to HTTP status codes
 *
 * Business logic and page shaping live in ClubService, not here.
 */
export const clubController = {
  /**
   * GET /clubs
   * Clubs index: all countries with active clubs.
   */
  index(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = clubService.getPublicClubsIndexPage();
      res.render('clubs/index', vm);
    } catch (err) {
      clubController._handleError(err, res, next);
    }
  },

  /**
   * GET /clubs/:slug
   * Dispatches to club detail or country page based on prefix.
   * slug starts with 'club_' → club detail; otherwise → country page.
   */
  slug(req: Request, res: Response, next: NextFunction): void {
    try {
      const { slug } = req.params;
      if (slug.startsWith('club_')) {
        const vm = clubService.getPublicClubPage(slug);
        if (!req.isAuthenticated) {
          vm.content.club.members = [];
        }
        res.render('clubs/detail', vm);
      } else {
        const vm = clubService.getPublicCountryPage(slug);
        res.render('clubs/country', vm);
      }
    } catch (err) {
      clubController._handleError(err, res, next);
    }
  },

  /**
   * Maps service errors to HTTP responses.
   * NotFoundError and ValidationError both render 404 — validation detail
   * must not be exposed to public visitors.
   */
  _handleError(err: unknown, res: Response, next: NextFunction): void {
    if (err instanceof NotFoundError || err instanceof ValidationError) {
      res.status(404).render('errors/not-found', {
        seo:  { title: 'Page Not Found' },
        page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
      });
      return;
    }
    if (err instanceof ServiceUnavailableError) {
      res.status(503).render('errors/unavailable', {
        seo:  { title: 'Service Unavailable' },
        page: { sectionKey: '', pageKey: 'error_503', title: 'Service Unavailable' },
      });
      return;
    }
    logger.error('unexpected error in clubs controller', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  },
};
