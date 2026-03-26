import { Request, Response } from 'express';

export const clubController = {
  /**
   * GET /clubs
   * Clubs landing placeholder — no data required.
   */
  index(_req: Request, res: Response): void {
    res.render('public/clubs', {
      seo: { title: 'Clubs' },
      page: { sectionKey: 'clubs', pageKey: 'clubs_index', title: 'Clubs' },
      content: {},
    });
  },
};
