import { Request, Response } from 'express';
import { config } from '../config/env';
import { createSessionCookie } from '../middleware/authStub';

const COOKIE_NAME = 'footbag_session';
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours

function isSafePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function getLogin(req: Request, res: Response): void {
  if (req.isAuthenticated) {
    res.redirect('/members');
    return;
  }
  const returnTo = isSafePath(req.query.returnTo) ? req.query.returnTo : undefined;
  res.render('auth/login', {
    seo: { title: 'Login' },
    page: { sectionKey: '', pageKey: 'login', title: 'Member Login', intro: 'Sign in to your IFPA member account.' },
    content: { returnTo },
  });
}

function postLogin(req: Request, res: Response): void {
  const { username, password, returnTo } = req.body as { username?: string; password?: string; returnTo?: string };

  if (username === config.stubUsername && password === config.stubPassword) {
    const cookieValue = createSessionCookie('stub-admin', 'admin', config.sessionSecret);
    res.cookie(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    });
    res.redirect(isSafePath(returnTo) ? returnTo : '/members');
    return;
  }

  res.render('auth/login', {
    seo: { title: 'Login' },
    page: { sectionKey: '', pageKey: 'login', title: 'Member Login', intro: 'Sign in to your IFPA member account.' },
    content: { error: 'Invalid username or password.', returnTo: isSafePath(returnTo) ? returnTo : undefined },
  });
}

function postLogout(_req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/');
}

export const authController = { getLogin, postLogin, postLogout };
