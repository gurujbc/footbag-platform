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
import { requireAuth } from '../middleware/authStub';

export const publicRouter = Router();

publicRouter.get('/',      homeController.home);
publicRouter.get('/clubs',       clubController.index);
publicRouter.get('/clubs/:key', clubController.byKey);
publicRouter.get('/hof',   hofController.index);

// IMPORTANT: literal sub-routes registered before param routes (/freestyle/tricks/:slug)
// and before /freestyle itself.
publicRouter.get('/freestyle/records',     freestyleController.records);
publicRouter.get('/freestyle/leaders',     freestyleController.leaders);
publicRouter.get('/freestyle/competition', freestyleController.competition);
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

// IMPORTANT: /net/events/:eventId must be registered after /net/events
publicRouter.get('/net/events',           netController.eventsPage);
publicRouter.get('/net/events/:eventId',  netController.eventDetailPage);

publicRouter.get('/net/partnerships',             netController.partnershipsPage);
publicRouter.get('/net/partnerships/:teamId',    netController.partnershipDetail);

// IMPORTANT: /net/teams/:teamId must be registered after /net/teams
publicRouter.get('/net/teams',          netController.teams);
publicRouter.get('/net/teams/:teamId',  netController.teamDetail);

// IMPORTANT: /net/players/:personId/partners/:teamId must be registered before
// /net/players/:personId so the literal segment 'partners' is not captured as :personId.
publicRouter.get('/net/players/:personId/partners/:teamId', netController.playerPartnerDetail);
publicRouter.get('/net/players/:personId',                  netController.playerPage);

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
publicRouter.get('/history/claim',                requireAuth, claimController.getClaim);
publicRouter.post('/history/claim',               requireAuth, claimController.postClaim);
publicRouter.post('/history/claim/confirm',       requireAuth, claimController.postClaimConfirm);
publicRouter.get('/history/:personId',   historyController.detail);

// IMPORTANT: /members/:memberKey/edit and /members/:memberKey/avatar must be
// registered before /members/:memberKey/:section so literal segments are not
// captured as :section.
publicRouter.get('/members',                       memberController.landing);
publicRouter.get('/members/:memberKey',             memberController.getProfile);
publicRouter.get('/members/:memberKey/edit',        requireAuth, memberController.getProfileEdit);
publicRouter.post('/members/:memberKey/edit',       requireAuth, memberController.postProfileEdit);
publicRouter.post('/members/:memberKey/avatar',     requireAuth, memberController.postAvatarUpload);
publicRouter.get('/members/:memberKey/:section',    requireAuth, memberController.getStub);

publicRouter.get('/login',      authController.getLogin);
publicRouter.post('/login',     authController.postLogin);
publicRouter.get('/register',   authController.getRegister);
publicRouter.post('/register',  authController.postRegister);
publicRouter.post('/logout',    authController.postLogout);
