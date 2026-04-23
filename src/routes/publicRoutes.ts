import { Router } from 'express';
import { homeController } from '../controllers/homeController';
import { clubController } from '../controllers/clubController';
import { eventController } from '../controllers/eventController';
import { historyController } from '../controllers/historyController';
import { memberController } from '../controllers/memberController';
import { claimController } from '../controllers/claimController';
import { authController } from '../controllers/authController';
import { hofController } from '../controllers/hofController';
import { freestyleController } from '../controllers/freestyleController';
import { recordsController } from '../controllers/recordsController';
import { netController } from '../controllers/netController';
import { legalController } from '../controllers/legalController';
import { requireAuth } from '../middleware/auth';

export const publicRouter = Router();

publicRouter.get('/',      homeController.home);
publicRouter.get('/clubs',       clubController.index);
publicRouter.get('/clubs/:key', clubController.byKey);
publicRouter.get('/hof',   hofController.index);

// IMPORTANT: literal sub-routes registered before param routes (/freestyle/tricks/:slug)
// and before /freestyle itself.
publicRouter.get('/freestyle/records',     freestyleController.records);
publicRouter.get('/freestyle/leaders',     freestyleController.leaders);
publicRouter.get('/freestyle/competition',   freestyleController.competition);
publicRouter.get('/freestyle/partnerships',  freestyleController.partnerships);
publicRouter.get('/freestyle/history',     freestyleController.history);
publicRouter.get('/freestyle/about',       freestyleController.about);
publicRouter.get('/freestyle/moves',       freestyleController.moves);
publicRouter.get('/freestyle/tricks',      freestyleController.tricksIndex);
publicRouter.get('/freestyle/insights',    freestyleController.insights);
publicRouter.get('/freestyle/tricks/:slug', freestyleController.trick);
publicRouter.get('/freestyle',             freestyleController.landing);

publicRouter.get('/records', recordsController.records);

// IMPORTANT: /net must be registered before all /net/* sub-routes
publicRouter.get('/net',                  netController.homePage);

publicRouter.get('/net/events', netController.eventsPage);

publicRouter.get('/net/teams',             netController.teamsPage);
publicRouter.get('/net/teams/:teamId',    netController.teamDetail);

// IMPORTANT: /events/year/:year MUST be registered before /events/:eventKey.
// Express matches routes in registration order. Without this ordering,
// the literal segment "year" would be captured as the :eventKey param,
// which would fail PUBLIC_EVENT_KEY_PATTERN validation and return 404
// instead of routing to the year archive page.
publicRouter.get('/events',              eventController.landing);
publicRouter.get('/events/year/:year',   eventController.year);
publicRouter.get('/events/:eventKey',    eventController.event);

publicRouter.get('/history', (_req, res) => { res.redirect(301, '/members'); });
// IMPORTANT: /history/claim routes MUST be registered before /history/:personId.
// Without this ordering, "claim" would be captured as the :personId param.
publicRouter.get('/history/auto-link',            requireAuth, claimController.getAutoLinkConfirm);
publicRouter.post('/history/auto-link/confirm',   requireAuth, claimController.postAutoLinkConfirm);
publicRouter.get('/history/claim',                requireAuth, claimController.getClaim);
publicRouter.post('/history/claim',               requireAuth, claimController.postClaim);
publicRouter.post('/history/claim/confirm',       requireAuth, claimController.postClaimConfirm);
// HP-only self-serve claim (scenarios D and E). /history/:personId/claim routes
// sit at a deeper path than /history/:personId, so ordering is not strictly
// required, but keeping claim routes grouped.
publicRouter.get('/history/:personId/claim',         requireAuth, claimController.getClaimHp);
publicRouter.post('/history/:personId/claim/confirm', requireAuth, claimController.postClaimHpConfirm);
publicRouter.get('/history/:personId',   historyController.detail);

// IMPORTANT: /members/:memberKey/edit and /members/:memberKey/avatar must be
// registered before /members/:memberKey/:section so literal segments are not
// captured as :section.
publicRouter.get('/members',                       memberController.landing);
publicRouter.get('/members/:memberKey',             memberController.getProfile);
publicRouter.get('/members/:memberKey/edit',          requireAuth, memberController.getProfileEdit);
publicRouter.post('/members/:memberKey/edit',         requireAuth, memberController.postProfileEdit);
publicRouter.get('/members/:memberKey/edit/password', requireAuth, memberController.getPasswordEdit);
publicRouter.post('/members/:memberKey/edit/password',requireAuth, memberController.postPasswordEdit);
publicRouter.post('/members/:memberKey/avatar',       requireAuth, memberController.postAvatarUpload);
publicRouter.get('/members/:memberKey/:section',      requireAuth, memberController.getStub);

publicRouter.get('/legal',      legalController.index);

publicRouter.get('/login',      authController.getLogin);
publicRouter.post('/login',     authController.postLogin);
publicRouter.get('/register',               authController.getRegister);
publicRouter.post('/register',              authController.postRegister);
publicRouter.get('/register/check-email',   authController.getCheckEmail);
publicRouter.get('/verify/:token',          authController.getVerify);
publicRouter.post('/verify/resend',         authController.postVerifyResend);
publicRouter.get('/password/forgot',        authController.getPasswordForgot);
publicRouter.post('/password/forgot',       authController.postPasswordForgot);
publicRouter.get('/password/reset/:token',  authController.getPasswordReset);
publicRouter.post('/password/reset/:token', authController.postPasswordReset);
publicRouter.post('/logout',                authController.postLogout);
