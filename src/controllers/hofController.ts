import { Request, Response } from 'express';
import { hofService } from '../services/hofService';

export const hofController = {
  /**
   * GET /hof
   * Hall of Fame landing page — static/editorial content, no DB queries.
   */
  index(_req: Request, res: Response): void {
    const vm = hofService.getHofLandingPage();
    res.render('public/hof', vm);
  },
};
