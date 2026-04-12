import { Router } from 'express';
import { netController } from '../controllers/netController';

/**
 * Internal / operator routes.
 * Not linked from public nav. Read-only. No auth gate in this pass.
 * Mount point: /internal
 */
export const internalRouter = Router();

// Net recovery signals + candidates (identity diagnostic)
internalRouter.get('/net/recovery-signals',    netController.recoverySignalsPage);
internalRouter.get('/net/recovery-candidates',              netController.recoveryCandidatesPage);
internalRouter.post('/net/recovery-candidates/:id/decision', netController.recoveryCandidateDecision);
// Net enrichment QC / review
internalRouter.get('/net/review/summary',            netController.reviewSummaryPage);
internalRouter.get('/net/review',                    netController.reviewPage);
internalRouter.post('/net/review/:id/classify',      netController.reviewClassify);
internalRouter.post('/net/review/:id/decision',      netController.reviewDecision);
// Net curated match browser
internalRouter.get('/net/curated',     netController.curatedPage);
// Net match candidates from noise extraction
internalRouter.get('/net/candidates',                              netController.candidatesPage);
// Candidate detail + promote/reject workflow
internalRouter.get('/net/candidates/:candidateId',                 netController.candidateDetail);
internalRouter.post('/net/candidates/:candidateId/approve',        netController.candidateApprove);
internalRouter.post('/net/candidates/:candidateId/reject',         netController.candidateReject);
