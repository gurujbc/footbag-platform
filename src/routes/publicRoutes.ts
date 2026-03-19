import { Router } from 'express';
import { homeController } from '../controllers/homeController';
import { clubController } from '../controllers/clubController';
import { eventController } from '../controllers/eventController';
import { memberController } from '../controllers/memberController';
import { authController } from '../controllers/authController';
import { hofController } from '../controllers/hofController';
import { requireAuth } from '../middleware/authStub';

export const publicRouter = Router();

publicRouter.get('/',      homeController.home);
publicRouter.get('/clubs', clubController.index);
publicRouter.get('/hof',   hofController.index);

// IMPORTANT: /events/year/:year MUST be registered before /events/:eventKey.
// Express matches routes in registration order. Without this ordering,
// the literal segment "year" would be captured as the :eventKey param,
// which would fail PUBLIC_EVENT_KEY_PATTERN validation and return 404
// instead of routing to the year archive page.
publicRouter.get('/events',              eventController.landing);
publicRouter.get('/events/year/:year',   eventController.year);
publicRouter.get('/events/:eventKey',    eventController.event);

publicRouter.get('/members',             requireAuth, memberController.index);
publicRouter.get('/members/:personId',   requireAuth, memberController.detail);

publicRouter.get('/login',   authController.getLogin);
publicRouter.post('/login',  authController.postLogin);
publicRouter.post('/logout', authController.postLogout);
