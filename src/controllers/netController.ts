import { Request, Response, NextFunction } from 'express';
import { netService } from '../services/netService';
import { NotFoundError, ServiceUnavailableError, ConflictError, ValidationError } from '../services/serviceErrors';
import { logger } from '../config/logger';

/**
 * Thin controller for public net team routes.
 * Business logic and page shaping live in netService.
 */
export const netController = {
  /** GET /internal/net/curated */
  curatedPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawStatus  = req.query['status'];
      const rawSource  = req.query['source'];
      const rawEvent   = req.query['event'];
      const rawYear    = req.query['year'];
      const rawLinked  = req.query['linked'];
      const rawLimit   = req.query['limit'];

      const filters = {
        curated_status: typeof rawStatus === 'string' &&
          ['approved', 'rejected'].includes(rawStatus)
          ? rawStatus : undefined,
        source_file: typeof rawSource === 'string' && rawSource.trim()
          ? rawSource.trim() : undefined,
        event_id: typeof rawEvent === 'string' && rawEvent.trim()
          ? rawEvent.trim() : undefined,
        year_hint: typeof rawYear === 'string' && /^\d{4}$/.test(rawYear)
          ? parseInt(rawYear, 10) : undefined,
        linked_only: rawLinked === 'true',
        limit: typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
          ? Math.min(parseInt(rawLimit, 10), 200) : 50,
      };

      const vm = netService.getNetCuratedPage(filters);
      res.render('net/curated', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/candidates */
  candidatesPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawStatus  = req.query['status'];
      const rawEvent   = req.query['event'];
      const rawSource  = req.query['source'];
      const rawLinked  = req.query['linked'];
      const rawConf    = req.query['min_confidence'];
      const rawGroup   = req.query['group'];
      const rawLimit   = req.query['limit'];

      const filters = {
        review_status: typeof rawStatus === 'string' &&
          ['pending', 'accepted', 'rejected', 'needs_info'].includes(rawStatus)
          ? rawStatus : undefined,
        event_id: typeof rawEvent === 'string' && rawEvent.trim()
          ? rawEvent.trim() : undefined,
        source_file: typeof rawSource === 'string' && rawSource.trim()
          ? rawSource.trim() : undefined,
        linked_only: rawLinked === 'true',
        min_confidence: typeof rawConf === 'string' && /^0?\.\d+$/.test(rawConf)
          ? parseFloat(rawConf) : undefined,
        group_by: typeof rawGroup === 'string' &&
          ['event', 'source', 'year'].includes(rawGroup)
          ? rawGroup : undefined,
        limit: typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
          ? Math.min(parseInt(rawLimit, 10), 200) : 50,
      };

      const vm = netService.getNetCandidatesPage(filters);
      res.render('net/candidates', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/review/summary */
  reviewSummaryPage(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getNetReviewSummaryPage();
      res.render('net/review-summary', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/team-corrections */
  teamCorrectionsPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getTeamCorrectionsPage({
        severity:      typeof req.query['severity'] === 'string' && req.query['severity'] ? req.query['severity'] : undefined,
        event:         typeof req.query['event'] === 'string' && req.query['event'] ? req.query['event'] : undefined,
        anomalyType:   typeof req.query['type'] === 'string' && req.query['type'] ? req.query['type'] : undefined,
        hasSuggestion: typeof req.query['suggestion'] === 'string' && req.query['suggestion'] ? req.query['suggestion'] : undefined,
      });
      res.render('net/team-corrections', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** POST /internal/net/team-corrections/:id/decision */
  teamCorrectionDecision(req: Request, res: Response, next: NextFunction): void {
    try {
      const candidateId = req.params['id'] ?? '';
      const rawDecision = req.body?.['decision'];
      const rawPlayerA  = req.body?.['player_a'];
      const rawPlayerB  = req.body?.['player_b'];
      const rawNotes    = req.body?.['notes'];

      if (typeof rawDecision !== 'string' || !rawDecision.trim()) {
        res.status(400).send('Bad Request: decision is required');
        return;
      }

      netService.updateTeamCorrectionDecision(candidateId, {
        decision: rawDecision.trim(),
        playerA:  typeof rawPlayerA === 'string' ? rawPlayerA : undefined,
        playerB:  typeof rawPlayerB === 'string' ? rawPlayerB : undefined,
        notes:    typeof rawNotes === 'string' ? rawNotes : undefined,
      });
      res.redirect('/internal/net/team-corrections');
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo: { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(400).send(`Bad Request: ${err.message}`);
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/recovery-candidates */
  recoveryCandidatesPage(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getRecoveryCandidatesPage();
      res.render('net/recovery-candidates', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** POST /internal/net/recovery-candidates/:id/decision */
  recoveryCandidateDecision(req: Request, res: Response, next: NextFunction): void {
    try {
      const candidateId = req.params['id'] ?? '';
      const rawDecision = req.body?.['decision'];
      const rawNotes    = req.body?.['notes'];

      if (typeof rawDecision !== 'string' || !rawDecision.trim()) {
        res.status(400).send('Bad Request: decision is required');
        return;
      }

      netService.updateRecoveryDecision(candidateId, {
        decision: rawDecision.trim(),
        notes:    typeof rawNotes === 'string' ? rawNotes : null,
      });
      res.redirect('/internal/net/recovery-candidates');
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(400).send(`Bad Request: ${err.message}`);
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/recovery-signals */
  recoverySignalsPage(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getRecoverySignalsPage();
      res.render('net/recovery-signals', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/review */
  reviewPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawReason         = req.query['reason'];
      const rawPriority       = req.query['priority'];
      const rawStatus         = req.query['status'];
      const rawEvent          = req.query['event'];
      const rawLimit          = req.query['limit'];
      const rawClassification = req.query['classification'];
      const rawFixType        = req.query['fix_type'];
      const rawDecision       = req.query['decision'];

      const VALID_CLASSIFICATIONS   = new Set([
        'retag_team_type', 'split_merged_discipline', 'quarantine_non_results_block',
        'parser_improvement', 'unresolved',
      ]);
      const VALID_FIX_TYPES = new Set([
        'retag_team_type', 'rename_discipline', 'rename_and_retag',
        'reshape_doubles_to_singles', 'split_merged_discipline',
        'quarantine_non_results_block', 'parser_improvement',
      ]);
      const VALID_DECISION_STATUSES = new Set(['fix_encoded', 'fix_active', 'deferred', 'wont_fix']);

      const filters = {
        reason_code: typeof rawReason === 'string' && rawReason.trim()
          ? rawReason.trim() : undefined,
        priority: typeof rawPriority === 'string' && /^[1-4]$/.test(rawPriority)
          ? parseInt(rawPriority, 10) : undefined,
        resolution_status: typeof rawStatus === 'string' &&
          ['open', 'resolved', 'wont_fix', 'escalated'].includes(rawStatus)
          ? rawStatus : undefined,
        event_id: typeof rawEvent === 'string' && rawEvent.trim()
          ? rawEvent.trim() : undefined,
        limit: typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
          ? Math.min(parseInt(rawLimit, 10), 200) : 50,
        classification: typeof rawClassification === 'string' &&
          VALID_CLASSIFICATIONS.has(rawClassification)
          ? rawClassification : undefined,
        proposed_fix_type: typeof rawFixType === 'string' &&
          VALID_FIX_TYPES.has(rawFixType)
          ? rawFixType : undefined,
        decision_status: typeof rawDecision === 'string' &&
          VALID_DECISION_STATUSES.has(rawDecision)
          ? rawDecision : undefined,
      };

      const vm = netService.getNetReviewPage(filters);
      res.render('net/review', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /net */
  homePage(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getNetHomePage();
      res.render('net/index', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /net/events */
  eventsPage(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getEventsPage();
      res.render('net/events', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /net/events/:eventId */
  eventDetailPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getEventDetailPage(req.params['eventId'] ?? '');
      res.render('net/event-detail', vm);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** GET /net/partnerships */
  partnershipsPage(req: Request, res: Response, next: NextFunction): void {
    try {
      const rawDivision = req.query['division'];
      const rawSearch   = req.query['q'];
      const division = typeof rawDivision === 'string' && rawDivision.trim()
        ? rawDivision.trim() : undefined;
      const search = typeof rawSearch === 'string' && rawSearch.trim().length >= 2
        ? rawSearch.trim() : undefined;
      const vm = netService.getPartnershipsPage(division, search);
      res.render('net/partnerships', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /net/partnerships/:teamId */
  partnershipDetail(req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getPartnershipDetailPage(req.params['teamId'] ?? '');
      res.render('net/partnership-detail', vm);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** GET /net/teams */
  teams(_req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getTeamsPage();
      res.render('net/teams', vm);
    } catch (err) {
      netController._handleError(err, res, next);
    }
  },

  /** GET /net/teams/:teamId */
  teamDetail(req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getTeamDetailPage(req.params['teamId'] ?? '');
      res.render('net/team-detail', vm);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** GET /internal/net/candidates/:candidateId */
  candidateDetail(req: Request, res: Response, next: NextFunction): void {
    try {
      const vm = netService.getCandidateDetailPage(req.params['candidateId'] ?? '');
      res.render('net/candidate-detail', vm);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** POST /internal/net/candidates/:candidateId/approve */
  candidateApprove(req: Request, res: Response, next: NextFunction): void {
    try {
      const candidateId = req.params['candidateId'] ?? '';
      const note = typeof req.body?.['note'] === 'string' && req.body['note'].trim()
        ? req.body['note'].trim() : undefined;
      netService.approveCandidate(candidateId, { note });
      res.redirect(`/internal/net/candidates/${candidateId}`);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      if (err instanceof ConflictError) {
        res.status(409).render('errors/not-found', {
          seo:  { title: 'Already Curated' },
          page: { sectionKey: '', pageKey: 'error_409', title: 'Already Curated' },
        });
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** POST /internal/net/candidates/:candidateId/reject */
  candidateReject(req: Request, res: Response, next: NextFunction): void {
    try {
      const candidateId = req.params['candidateId'] ?? '';
      const note = typeof req.body?.['note'] === 'string' && req.body['note'].trim()
        ? req.body['note'].trim() : undefined;
      netService.rejectCandidate(candidateId, { note });
      res.redirect(`/internal/net/candidates/${candidateId}`);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      if (err instanceof ConflictError) {
        res.status(409).render('errors/not-found', {
          seo:  { title: 'Already Curated' },
          page: { sectionKey: '', pageKey: 'error_409', title: 'Already Curated' },
        });
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** POST /internal/net/review/:id/classify */
  reviewClassify(req: Request, res: Response, next: NextFunction): void {
    try {
      const id = req.params['id'] ?? '';

      const rawClassification = req.body?.['classification'];
      const rawFixType        = req.body?.['proposed_fix_type'];
      const rawConfidence     = req.body?.['classification_confidence'];

      const payload: {
        classification?:            string | null;
        proposed_fix_type?:         string | null;
        classification_confidence?: string | null;
      } = {};

      if (typeof rawClassification === 'string') {
        payload.classification = rawClassification.trim() || null;
      }
      if (typeof rawFixType === 'string') {
        payload.proposed_fix_type = rawFixType.trim() || null;
      }
      if (typeof rawConfidence === 'string') {
        payload.classification_confidence = rawConfidence.trim() || null;
      }

      netService.classifyReviewItem(id, payload);
      res.redirect('/internal/net/review');
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(400).send(`Bad Request: ${err.message}`);
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  /** POST /internal/net/review/:id/decision */
  reviewDecision(req: Request, res: Response, next: NextFunction): void {
    try {
      const id = req.params['id'] ?? '';

      const rawStatus = req.body?.['decision_status'];
      const rawNotes  = req.body?.['decision_notes'];

      const payload: {
        decision_status?: string | null;
        decision_notes?:  string | null;
      } = {};

      if (typeof rawStatus === 'string') {
        payload.decision_status = rawStatus.trim() || null;
      }
      if (typeof rawNotes === 'string') {
        payload.decision_notes = rawNotes.trim() || null;
      }

      netService.updateReviewDecision(id, payload);
      res.redirect('/internal/net/review');
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).render('errors/not-found', {
          seo:  { title: 'Page Not Found' },
          page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
        });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(400).send(`Bad Request: ${err.message}`);
        return;
      }
      netController._handleError(err, res, next);
    }
  },

  _handleError(err: unknown, res: Response, next: NextFunction): void {
    if (err instanceof ServiceUnavailableError) {
      res.status(503).render('errors/unavailable', {
        seo:  { title: 'Service Unavailable' },
        page: { sectionKey: '', pageKey: 'error_503', title: 'Service Unavailable' },
      });
      return;
    }
    logger.error('unexpected error in net controller', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  },
};
