import { Request, Response } from 'express';
import { hofService } from '../services/hofService';

export const hofController = {
  /**
   * GET /hof
   * Hall of Fame landing page — static/editorial content, no DB queries.
   */
  index(_req: Request, res: Response): void {
    const viewModel = hofService.getHofLandingPage();
    res.render('public/hof', { pageTitle: viewModel.page.title, ...viewModel });
  },
};
