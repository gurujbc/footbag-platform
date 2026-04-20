import { Request, Response, NextFunction } from 'express';
import { identityAccessService } from '../services/identityAccessService';
import { ValidationError } from '../services/serviceErrors';
import { logger } from '../config/logger';

const FORM_VM = {
  seo:  { title: 'Link Legacy Account' },
  page: { sectionKey: 'members', pageKey: 'claim_initiate', title: 'Link Legacy Account' },
};

export const claimController = {
  /** GET /history/claim, render the legacy claim lookup form. */
  getClaim(_req: Request, res: Response): void {
    res.render('history/claim-form', { ...FORM_VM, content: {} });
  },

  /** POST /history/claim, look up a legacy record by identifier. */
  postClaim(req: Request, res: Response, next: NextFunction): void {
    const identifier = req.body.identifier ?? '';

    try {
      const result = identityAccessService.lookupLegacyAccount(req.user!.userId, identifier);

      if (!result) {
        res.status(200).render('history/claim-form', {
          ...FORM_VM,
          content: { error: 'No matching legacy record was found for that identifier.', identifier },
        });
        return;
      }

      res.render('history/claim-confirm', {
        seo:  { title: 'Confirm Legacy Account Link' },
        page: { sectionKey: 'members', pageKey: 'claim_verify', title: 'Confirm Legacy Account Link' },
        content: {
          legacyMemberId:   result.legacyMemberId,
          displayName:      result.displayName,
          country:          result.country,
          isHof:            result.isHof,
          isBap:            result.isBap,
        },
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(422).render('history/claim-form', {
          ...FORM_VM,
          content: { error: err.message, identifier },
        });
        return;
      }
      logger.error('claim lookup error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /** POST /history/claim/confirm, execute the legacy account claim. */
  postClaimConfirm(req: Request, res: Response, next: NextFunction): void {
    const legacyMemberId = req.body.legacyMemberId ?? '';

    if (!legacyMemberId) {
      res.status(422).render('history/claim-form', {
        ...FORM_VM,
        content: { error: 'Invalid claim request.' },
      });
      return;
    }

    try {
      identityAccessService.claimLegacyAccount(req.user!.userId, legacyMemberId);
      res.redirect(`/members/${req.user!.slug}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(422).render('history/claim-form', {
          ...FORM_VM,
          content: { error: err.message },
        });
        return;
      }
      logger.error('claim merge error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },
};
