import { Request, Response } from 'express';
import { config } from '../config/env';
import { createSessionCookie } from '../middleware/authStub';

const COOKIE_NAME = 'footbag_session';
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours

function getLogin(req: Request, res: Response): void {
  if (req.isAuthenticated) {
    res.redirect('/members');
    return;
  }
  res.render('auth/login', { pageTitle: 'Login' });
}

function postLogin(req: Request, res: Response): void {
  const { username, password } = req.body as { username?: string; password?: string };

  if (username === config.stubUsername && password === config.stubPassword) {
    const cookieValue = createSessionCookie('stub-admin', 'admin', config.sessionSecret);
    res.cookie(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      secure: config.nodeEnv === 'production',
    });
    res.redirect('/members');
    return;
  }

  res.render('auth/login', { pageTitle: 'Login', error: 'Invalid username or password.' });
}

function postLogout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/');
}

export const authController = { getLogin, postLogin, postLogout };
