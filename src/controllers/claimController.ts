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

// Reason-aware guidance shown on the manual claim page for each tier3 branch.
// Messages are kept short and pick the same tone as the verify/auth templates.
const TIER3_MESSAGES: Record<string, string> = {
  ambiguous_email_anchor:
    'This identifier matches multiple legacy accounts. Please enter a legacy username or member ID to continue.',
  multiple_name_candidates:
    'We found multiple possible matches for your name. Please select your profile below.',
  no_name_candidate:
    "We couldn't find a matching profile automatically. Please search for your name below.",
  hp_mismatch:
    "We found a similar name, but couldn't confirm it's your profile. Please verify manually.",
  no_hp_for_legacy_account:
    "Your account exists, but isn't yet linked to a competition profile. Please search to continue.",
};

// Shown when /history/claim is reached via the ?reason= query param from
// postAutoLinkConfirm drift redirects. Only rendered when no tier3
// reason-aware message is already in play (tier3 copy is more specific).
const DRIFT_MESSAGE =
  "We couldn't automatically confirm your match. Please review and select your record manually.";

export const claimController = {
  /**
   * GET /history/claim, render the legacy claim lookup form.
   *
   * Prefills the identifier input with the member's real_name (best-effort
   * context only; the lookup remains identifier-based). When the verify-time
   * classifier reported tier3, shows a reason-aware message and — where the
   * existing `findAutoLinkCandidates` helper returned HP options — lists them
   * as selectable links to the existing `/history/:personId/claim` page.
   *
   * No new route, no claim-flow changes, no new matching heuristic. The
   * candidate fetch reuses the same read helper the classifier uses; no new
   * DB work beyond that helper.
   */
  getClaim(req: Request, res: Response): void {
    const userId = req.user?.userId;
    const member = userId
      ? (legacyClaim.findClaimingMember.get(userId) as ClaimingMemberRow | undefined)
      : undefined;
    const realName = member?.real_name?.trim() ?? '';

    let message: string | undefined;
    const candidates: Array<{ personId: string; personName: string }> = [];

    if (userId && realName) {
      const classification = identityAccessService.getAutoLinkClassificationForMember(userId);
      if (classification.tier === 'tier3') {
        message = TIER3_MESSAGES[classification.reason];
        // Surface candidate HPs only for reasons where name-match data is
        // meaningful: multi-legacy candidates and the decoy-HP case. For
        // ambiguous_email_anchor and no_hp_for_legacy_account the name
        // didn't drive the tier3, so a candidate list could mislead.
        if (
          classification.reason === 'multiple_name_candidates' ||
          classification.reason === 'hp_mismatch' ||
          classification.reason === 'no_name_candidate'
        ) {
          for (const c of findAutoLinkCandidates(realName)) {
            candidates.push({ personId: c.personId, personName: c.personName });
          }
        }
      }
    }

    // Drift explainer: shown when postAutoLinkConfirm redirects here with
    // ?reason=classification_changed AND no tier3 reason-aware message
    // has already taken the slot. The tier3 message, when present, is
    // more specific than the generic drift copy and takes precedence.
    if (!message && String(req.query.reason ?? '') === 'classification_changed') {
      message = DRIFT_MESSAGE;
    }

    res.render('history/claim-form', {
      ...FORM_VM,
      content: {
        identifier: realName,
        message,
        candidates,
      },
    });
  },

  /**
   * GET /history/auto-link, the verification-time confirmation step for
   * Tier 1 / Tier 2 auto-link candidates. Renders an HP summary with
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
          declineHref:              `/members/${encodeURIComponent(req.user!.slug)}`,
        },
      });
    } catch (err) {
      logger.error('auto-link confirm error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /**
   * POST /history/auto-link/confirm — one-turn classifier-trusted commit
   * path for the Tier 1 / Tier 2 auto-link "Yes" button. Re-validates the
   * classification at commit time (defense in depth against stale GET
   * state), then delegates to the existing transactional
   * identityAccessService.claimHistoricalPerson.
   *
   * Does NOT re-run the surname-reconciliation / duplicate-claim checks
   * itself — those live inside claimHistoricalPerson. The four-anchor
   * classifier already guarantees them for Tier 1 / Tier 2, so there is
   * no need for the two-click bounce through GET /history/:personId/claim
   * that the manual HP-claim flow uses.
   *
   * Fallback contract matches GET /history/auto-link:
   *   - classification no longer tier1/tier2   → 302 /history/claim
   *   - classification 'none'                  → 302 /members/:slug
   *   - submitted personId ≠ classifier's     → 302 /history/claim (drift)
   *   - ValidationError from commit           → 422 re-render with error
   */
  postAutoLinkConfirm(req: Request, res: Response, next: NextFunction): void {
    try {
      const userId   = req.user!.userId;
      const slug     = req.user!.slug;
      const personId = String(req.body.personId ?? '').trim();

      if (!personId) {
        res.status(422).render('history/auto-link-confirm', {
          ...AUTO_LINK_FORM_VM,
          content: {
            error:       'Invalid claim request.',
            declineHref: `/members/${encodeURIComponent(slug)}`,
          },
        });
        return;
      }

      const classification = identityAccessService.getAutoLinkClassificationForMember(userId);

      if (classification.tier === 'tier3') {
        // Classification drifted between GET render and POST commit.
        // Surface via the manual claim route with an explanatory reason.
        res.redirect('/history/claim?reason=classification_changed');
        return;
      }
      if (classification.tier === 'none') {
        res.redirect(`/members/${encodeURIComponent(slug)}`);
        return;
      }
      // Drift: GET saw one candidate, POST sees another. Same reason
      // query param so /history/claim can explain the state change.
      if (classification.personId !== personId) {
        res.redirect('/history/claim?reason=classification_changed');
        return;
      }

      try {
        identityAccessService.claimHistoricalPerson(userId, personId);
        res.redirect(`/members/${encodeURIComponent(slug)}`);
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(422).render('history/auto-link-confirm', {
            ...AUTO_LINK_FORM_VM,
            content: {
              personId:    classification.personId,
              personName:  classification.personName,
              tier:        classification.tier,
              error:       err.message,
              declineHref: `/members/${encodeURIComponent(slug)}`,
            },
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      logger.error('auto-link confirm commit error', { error: err instanceof Error ? err.message : String(err) });
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
      const lookup = identityAccessService.lookupLegacyAccount(req.user!.userId, identifier);

      if (lookup.kind === 'none') {
        res.status(200).render('history/claim-form', {
          ...FORM_VM,
          content: { error: 'No matching legacy record was found for that identifier.', identifier },
        });
        return;
      }

      if (lookup.kind === 'ambiguous_email') {
        res.status(200).render('history/claim-form', {
          ...FORM_VM,
          content: {
            error:
              'This identifier matches multiple legacy accounts. ' +
              'Please try a legacy username or member ID instead.',
            identifier,
          },
        });
        return;
      }

      const { result } = lookup;
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
