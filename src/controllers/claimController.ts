import { Request, Response, NextFunction } from 'express';
import { identityAccessService } from '../services/identityAccessService';
import { findAutoLinkCandidates } from '../services/nameVariantsService';
import { legacyClaim } from '../db/db';
import { ValidationError } from '../services/serviceErrors';
import { logger } from '../config/logger';

interface ClaimingMemberRow {
  id: string;
  slug: string;
  real_name: string;
  legacy_member_id: string | null;
  historical_person_id: string | null;
}

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
  /**
   * GET /history/claim, render the legacy claim lookup form.
   *
   * Prefills the identifier input with the member's real_name (best-effort
   * context only; the lookup remains identifier-based) and, when the
   * verify-time classifier reported tier3, shows a soft notice plus any HP
   * candidates the name-match helper returned. Candidate links go to the
   * existing `/history/:personId/claim` page — no new route, no
   * claim-flow changes, no new matching heuristic.
   */
  getClaim(req: Request, res: Response): void {
    const userId = req.user?.userId;
    const member = userId
      ? (legacyClaim.findClaimingMember.get(userId) as ClaimingMemberRow | undefined)
      : undefined;
    const realName = member?.real_name?.trim() ?? '';

    let autoLinkNotice: string | undefined;
    const candidates: Array<{ personId: string; personName: string }> = [];

    if (userId && realName) {
      const classification = identityAccessService.getAutoLinkClassificationForMember(userId);
      if (classification.tier === 'tier3') {
        for (const c of findAutoLinkCandidates(realName)) {
          candidates.push({ personId: c.personId, personName: c.personName });
        }
        if (candidates.length > 0) {
          autoLinkNotice =
            "We couldn't confidently match your profile automatically. " +
            'Please select your profile below or enter a legacy identifier.';
        }
      }
    }

    res.render('history/claim-form', {
      ...FORM_VM,
      content: {
        identifier: realName,
        autoLinkNotice,
        candidates,
      },
    });
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
