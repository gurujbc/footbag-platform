import { Request, Response, NextFunction } from 'express';
import { identityAccessService } from '../services/identityAccessService';
import { ValidationError } from '../services/serviceErrors';
import { logger } from '../config/logger';

const FORM_VM = {
  seo:  { title: 'Link Legacy Account' },
  page: { sectionKey: 'members', pageKey: 'claim_initiate', title: 'Link Legacy Account' },
};

const HP_FORM_VM = {
  seo:  { title: 'Claim Historical Record' },
  page: { sectionKey: 'members', pageKey: 'claim_hp_verify', title: 'Claim Historical Record' },
};

const AUTO_LINK_FORM_VM = {
  seo:  { title: 'We found a match' },
  page: { sectionKey: 'members', pageKey: 'auto_link_confirm', title: 'We found a match' },
};

export const claimController = {
  /** GET /history/claim, render the legacy claim lookup form. */
  getClaim(_req: Request, res: Response): void {
    res.render('history/claim-form', { ...FORM_VM, content: {} });
  },

  /**
   * GET /history/auto-link, the Phase 3B verification-time confirmation step
   * for Tier 1 / Tier 2 auto-link candidates. Renders an HP summary with
   * explicit "yes / no" actions; never performs the link itself. Falls
   * through to /history/claim when the classifier no longer reports
   * Tier 1 / Tier 2 for the authenticated member.
   */
  getAutoLinkConfirm(req: Request, res: Response, next: NextFunction): void {
    try {
      const classification = identityAccessService.getAutoLinkClassificationForMember(
        req.user!.userId,
      );
      if (classification.tier !== 'tier1' && classification.tier !== 'tier2') {
        res.redirect('/history/claim');
        return;
      }
      res.render('history/auto-link-confirm', {
        ...AUTO_LINK_FORM_VM,
        content: {
          personId:                 classification.personId,
          personName:               classification.personName,
          tier:                     classification.tier,
          matchedVariantNormalized: classification.tier === 'tier2'
            ? classification.matchedVariantNormalized
            : undefined,
          confirmHref:              `/history/${encodeURIComponent(classification.personId)}/claim`,
          declineHref:              `/members/${encodeURIComponent(req.user!.slug)}`,
        },
      });
    } catch (err) {
      logger.error('auto-link confirm error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /**
   * GET /history/:personId/claim, render the HP-claim confirmation page
   * (scenarios D and E). No separate lookup form, the viewer arrived here
   * from the historical-record detail page's "Claim this identity" CTA.
   */
  getClaimHp(req: Request, res: Response, next: NextFunction): void {
    const personId = req.params.personId ?? '';
    try {
      const result = identityAccessService.lookupHistoricalPersonForClaim(req.user!.userId, personId);
      if (!result) {
        res.redirect(`/history/${encodeURIComponent(personId)}`);
        return;
      }
      res.render('history/claim-hp-confirm', {
        ...HP_FORM_VM,
        content: {
          personId:         result.personId,
          personName:       result.personName,
          country:          result.country,
          isHof:            result.isHof,
          isBap:            result.isBap,
          firstNameWarning: result.firstNameWarning,
          cancelHref:       `/history/${encodeURIComponent(result.personId)}`,
        },
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(422).render('history/claim-hp-confirm', {
          ...HP_FORM_VM,
          content: {
            personId,
            error: err.message,
            cancelHref: `/history/${encodeURIComponent(personId)}`,
          },
        });
        return;
      }
      logger.error('hp claim lookup error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /**
   * POST /history/:personId/claim/confirm, execute the HP claim.
   */
  postClaimHpConfirm(req: Request, res: Response, next: NextFunction): void {
    const personId = req.params.personId ?? '';
    if (!personId) {
      res.status(422).render('history/claim-hp-confirm', {
        ...HP_FORM_VM,
        content: { error: 'Invalid claim request.', cancelHref: '/members' },
      });
      return;
    }
    try {
      identityAccessService.claimHistoricalPerson(req.user!.userId, personId);
      res.redirect(`/members/${req.user!.slug}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(422).render('history/claim-hp-confirm', {
          ...HP_FORM_VM,
          content: {
            personId,
            error: err.message,
            cancelHref: `/history/${encodeURIComponent(personId)}`,
          },
        });
        return;
      }
      logger.error('hp claim error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /**
   * POST /history/claim, look up a legacy record by identifier.
   *
   * Current flow is a direct-lookup early-test shortcut: no email
   * verification, no token round-trip, no rate limiting, no name
   * reconciliation guard, and revealing "no match" vs confirmation-
   * page responses (fails the anti-enumeration invariant that
   * lookup must return identical UX for found vs not-found).
   *
   * Target flow lives in `LegacyMigrationService` and delivers an
   * email-verified claim token to the legacy email address, with
   * per-account / per-target / per-IP rate limiting, name
   * reconciliation, and identical-UX anti-enumeration responses.
   * The token is consumed at `GET /history/claim/verify/:token`
   * which runs the confirm + merge transaction.
   *
   * Must change before production cutover.
   */
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
