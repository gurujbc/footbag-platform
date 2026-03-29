import { Router } from 'express';
import { homeController } from '../controllers/homeController';
import { clubController } from '../controllers/clubController';
import { eventController } from '../controllers/eventController';
import { historyController } from '../controllers/historyController';
import { memberController } from '../controllers/memberController';
import { authController } from '../controllers/authController';
import { hofController } from '../controllers/hofController';
import { requireAuth } from '../middleware/authStub';

export const publicRouter = Router();

publicRouter.get('/',      homeController.home);
publicRouter.get('/clubs',       clubController.index);
publicRouter.get('/clubs/:slug', clubController.slug);
publicRouter.get('/hof',   hofController.index);

// IMPORTANT: /events/year/:year MUST be registered before /events/:eventKey.
// Express matches routes in registration order. Without this ordering,
// the literal segment "year" would be captured as the :eventKey param,
// which would fail PUBLIC_EVENT_KEY_PATTERN validation and return 404
// instead of routing to the year archive page.
publicRouter.get('/events',              eventController.landing);
publicRouter.get('/events/year/:year',   eventController.year);
publicRouter.get('/events/:eventKey',    eventController.event);

publicRouter.get('/history',             historyController.index);
publicRouter.get('/history/:personId',   historyController.detail);

// IMPORTANT: /members/:memberId/edit and /members/:memberId/avatar must be
// registered before /members/:memberId/:section so literal segments are not
// captured as :section.
publicRouter.get('/members',                       requireAuth, memberController.landing);
publicRouter.get('/members/:memberId',             memberController.getProfile);
publicRouter.get('/members/:memberId/edit',        requireAuth, memberController.getProfileEdit);
publicRouter.post('/members/:memberId/edit',       requireAuth, memberController.postProfileEdit);
publicRouter.get('/members/:memberId/avatar',      requireAuth, memberController.getAvatarUpload);
publicRouter.post('/members/:memberId/avatar',     requireAuth, memberController.postAvatarUpload);
publicRouter.get('/members/:memberId/:section',    requireAuth, memberController.getStub);

publicRouter.get('/login',      authController.getLogin);
publicRouter.post('/login',     authController.postLogin);
publicRouter.get('/register',   authController.getRegister);
publicRouter.post('/register',  authController.postRegister);
publicRouter.post('/logout',    authController.postLogout);
