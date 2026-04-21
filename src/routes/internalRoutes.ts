import { Router } from 'express';
import { netQcController } from '../internal-qc/controllers/netQcController';
import { devOutboxController } from '../internal-qc/controllers/devOutboxController';
import { personsController } from '../controllers/personsController';
import { requireAuth } from '../middleware/auth';

/**
 * Internal / operator routes.
 * Not linked from public nav. Gated to any logged-in member
 * (redirects to /login when unauthenticated).
 * Mount point: /internal
 */
export const internalRouter = Router();
internalRouter.use(requireAuth);

// Persons QC + browse
internalRouter.get('/persons/qc', personsController.qcPage);
internalRouter.get('/persons/browse', personsController.browsePage);

// Net team corrections triage
internalRouter.get('/net/team-corrections',                    netQcController.teamCorrectionsPage);
internalRouter.post('/net/team-corrections/:id/decision',      netQcController.teamCorrectionDecision);
// Net recovery signals + candidates (identity diagnostic)
internalRouter.get('/net/recovery-signals',    netQcController.recoverySignalsPage);
internalRouter.get('/net/recovery-candidates',              netQcController.recoveryCandidatesPage);
internalRouter.post('/net/recovery-candidates/:id/decision', netQcController.recoveryCandidateDecision);
// Net enrichment QC / review
internalRouter.get('/net/review/summary',            netQcController.reviewSummaryPage);
internalRouter.get('/net/review',                    netQcController.reviewPage);
internalRouter.post('/net/review/:id/classify',      netQcController.reviewClassify);
internalRouter.post('/net/review/:id/decision',      netQcController.reviewDecision);
// Net event detail (QC reviewer view — discipline grouping, conflict-flag labels, QC hints)
internalRouter.get('/net/events/:eventId', netQcController.eventDetailPage);
// Net curated match browser
internalRouter.get('/net/curated',     netQcController.curatedPage);
// Net match candidates from noise extraction
internalRouter.get('/net/candidates',                              netQcController.candidatesPage);
// Candidate detail + promote/reject workflow
internalRouter.get('/net/candidates/:candidateId',                 netQcController.candidateDetail);
internalRouter.post('/net/candidates/:candidateId/approve',        netQcController.candidateApprove);
internalRouter.post('/net/candidates/:candidateId/reject',         netQcController.candidateReject);
// Dev outbox: stub SES adapter in-memory message log; 404 when SES_ADAPTER is not stub
internalRouter.get('/dev-outbox',                                  devOutboxController.page);
