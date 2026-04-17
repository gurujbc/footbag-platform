import { Request, Response, NextFunction } from 'express';
import { personsService } from '../services/personsService';
import { logger } from '../config/logger';

export const personsController = {
  /** GET /internal/persons/qc */
  qcPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawCategory = req.query['category'];
      const rawSource   = req.query['source'];

      const filters = {
        category: typeof rawCategory === 'string' && rawCategory.trim()
          ? rawCategory.trim() : undefined,
        source: typeof rawSource === 'string' && rawSource.trim()
          ? rawSource.trim() : undefined,
      };

      const vm = personsService.getPersonsQcPage(filters);
      res.render('persons/qc', vm);
    } catch (err) {
      logger.error('unexpected error in persons controller', {
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  },

  /** GET /internal/persons/browse */
  browsePage(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawSearch = req.query['search'];
      const rawSource = req.query['source'];
      const rawPage   = req.query['page'];

      const filters = {
        search: typeof rawSearch === 'string' && rawSearch.trim()
          ? rawSearch.trim() : undefined,
        source: typeof rawSource === 'string' && rawSource.trim()
          ? rawSource.trim() : undefined,
        page: typeof rawPage === 'string' && /^\d+$/.test(rawPage)
          ? parseInt(rawPage, 10) : undefined,
      };

      const vm = personsService.getPersonsBrowsePage(filters);
      res.render('persons/browse', vm);
    } catch (err) {
      logger.error('unexpected error in persons controller', {
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  },
};
