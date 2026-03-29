import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { createSessionCookie } from '../middleware/authStub';
import { identityAccessService } from '../services/identityAccessService';
import { ValidationError } from '../services/serviceErrors';

const COOKIE_NAME = 'footbag_session';
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours

function isSafePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function getLogin(req: Request, res: Response): void {
  if (req.isAuthenticated) {
    res.redirect(`/members/${req.user!.slug}`);
    return;
  }
  const returnTo = isSafePath(req.query.returnTo) ? req.query.returnTo : undefined;
  res.render('auth/login', {
    seo: { title: 'Login' },
    page: { sectionKey: '', pageKey: 'login', title: 'Member Login', intro: 'Sign in to your IFPA member account.' },
    content: {
      returnTo,
      authReason: returnTo ? 'The content you are trying to reach requires an IFPA Member account.' : undefined,
    },
  });
}

async function postLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password, returnTo } = req.body as { email?: string; password?: string; returnTo?: string };

  const renderError = (msg: string) => {
    res.render('auth/login', {
      seo: { title: 'Login' },
      page: { sectionKey: '', pageKey: 'login', title: 'Member Login', intro: 'Sign in to your IFPA member account.' },
      content: { error: msg, returnTo: isSafePath(returnTo) ? returnTo : undefined },
    });
  };

  try {
    // DB-first: attempt to verify against the members table.
    const member = await identityAccessService.verifyMemberCredentials(email ?? '', password ?? '');

    if (member !== null) {
      const role = member.is_admin ? 'admin' : 'member';
      const memberSlug = member.slug ?? member.id;
      const cookieValue = createSessionCookie(member.id, role, config.sessionSecret, member.display_name, memberSlug);
      res.cookie(COOKIE_NAME, cookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      });
      res.redirect(isSafePath(returnTo) ? returnTo : `/members/${memberSlug}`);
      return;
    }

    // Fallback: env-var stub user (dev only).
    if (
      config.stubUsername &&
      config.stubPassword &&
      (email ?? '') === config.stubUsername &&
      (password ?? '') === config.stubPassword
    ) {
      const cookieValue = createSessionCookie('stub-admin', 'admin', config.sessionSecret, 'Dev Admin', 'stub_admin');
      res.cookie(COOKIE_NAME, cookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      });
      res.redirect(isSafePath(returnTo) ? returnTo : '/members');
      return;
    }

    renderError('Invalid email or password. Please try again.');
  } catch (err) {
    next(err);
  }
}

function getRegister(req: Request, res: Response): void {
  if (req.isAuthenticated) {
    res.redirect(`/members/${req.user!.slug}`);
    return;
  }
  res.render('auth/register', {
    seo: { title: 'Create Account' },
    page: { sectionKey: '', pageKey: 'register', title: 'Create an IFPA Account' },
    content: {},
  });
}

async function postRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { displayName, email, password, confirmPassword } = req.body as {
    displayName?: string; email?: string; password?: string; confirmPassword?: string;
  };

  const renderError = (msg: string) => {
    res.status(422).render('auth/register', {
      seo: { title: 'Create Account' },
      page: { sectionKey: '', pageKey: 'register', title: 'Create an IFPA Account' },
      content: {
        error: msg,
        displayName: displayName ?? '',
        email: email ?? '',
      },
    });
  };

  try {
    const member = await identityAccessService.registerMember(
      email ?? '',
      password ?? '',
      confirmPassword ?? '',
      displayName ?? '',
    );

    const cookieValue = createSessionCookie(
      member.id, 'member', config.sessionSecret, member.displayName, member.slug,
    );
    res.cookie(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    });
    res.redirect(`/members/${member.slug}`);
  } catch (err) {
    if (err instanceof ValidationError) {
      renderError(err.message);
      return;
    }
    next(err);
  }
}

function postLogout(req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME);
  const referer = req.get('Referer');
  if (referer) {
    try {
      const parsed = new URL(referer);
      if (isSafePath(parsed.pathname)) {
        res.redirect(parsed.pathname);
        return;
      }
    } catch { /* ignore malformed Referer */ }
  }
  res.redirect('/');
}

export const authController = { getLogin, postLogin, getRegister, postRegister, postLogout };
