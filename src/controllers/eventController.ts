import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services/eventService';
import { NotFoundError, ValidationError, ServiceUnavailableError } from '../services/serviceErrors';
import { logger } from '../config/logger';

/**
 * Thin controller layer for the public Events + Results routes.
 *
 * Responsibilities:
 *  - Parse route params
 *  - Call the appropriate EventService method
 *  - Render the correct Handlebars template
 *  - Map service errors to HTTP status codes
 *
 * Business logic and page shaping live in EventService, not here.
 */
export const eventController = {
  /**
   * GET /events
   * Events landing page: upcoming events + archive year links.
   */
  landing(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = eventService.getPublicEventsLandingPage(new Date().toISOString());
      res.render('events/index', vm);
    } catch (err) {
      eventController._handleError(err, res, next);
    }
  },

  /**
   * GET /events/year/:year
   * Full-year archive page — all completed events for a given year.
   */
  year(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawYear = req.params.year;
      const year = parseInt(rawYear, 10);

      // Non-integer year params are treated as 404 (do not expose param detail)
      if (isNaN(year)) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }

      const vm = eventService.getPublicEventsYearPage(year);
      res.render('events/year', vm);
    } catch (err) {
      eventController._handleError(err, res, next);
    }
  },

  /**
   * GET /events/:eventKey
   * Canonical single-event page. eventKey format: event_{year}_{slug}
   */
  event(req: Request, res: Response, next: NextFunction): void {
    try {
      const eventKey = req.params.eventKey;
      const vm = eventService.getPublicEventPage(eventKey);
      res.render('events/detail', vm);
    } catch (err) {
      eventController._handleError(err, res, next);
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
    logger.error('unexpected error in events controller', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  },
};
