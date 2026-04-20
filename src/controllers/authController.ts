import { Request, Response, NextFunction } from 'express';
import { SESSION_COOKIE_NAME } from '../middleware/auth';
import { createSessionJwt } from '../services/jwtService';
import { issueSessionCookie } from './sessionCookieHelper';
import { identityAccessService } from '../services/identityAccessService';
import { hit as rateLimitHit } from '../services/rateLimitService';
import { readIntConfig } from '../services/configReader';
import { ValidationError } from '../services/serviceErrors';

export const FLASH_LOGOUT_COOKIE = 'footbag_flash_logout';
export const FLASH_LOGOUT_VALUE = '1';

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

  const renderError = (msg: string, status = 200) => {
    res.status(status).render('auth/login', {
      seo: { title: 'Login' },
      page: { sectionKey: '', pageKey: 'login', title: 'Member Login', intro: 'Sign in to your IFPA member account.' },
      content: { error: msg, returnTo: isSafePath(returnTo) ? returnTo : undefined },
    });
  };

  const normalizedEmail = (email ?? '').trim().toLowerCase();
  const ip = req.ip ?? 'unknown';
  const maxAttempts = readIntConfig('login_rate_limit_max_attempts', 10);
  const windowMinutes = readIntConfig('login_rate_limit_window_minutes', 15);
  const rl = rateLimitHit(`login:${normalizedEmail}:${ip}`, maxAttempts, windowMinutes);
  if (!rl.allowed) {
    if (rl.retryAfterSeconds) res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    renderError('Too many failed login attempts. Please try again later.', 429);
    return;
  }

  try {
    // DB-first: attempt to verify against the members table.
    const member = await identityAccessService.verifyMemberCredentials(email ?? '', password ?? '');

    if (member !== null) {
      const role = member.is_admin ? 'admin' : 'member';
      const memberSlug = member.slug ?? member.id;
      const cookieValue = await createSessionJwt(member.id, role, member.password_version);
      issueSessionCookie(res, cookieValue, req);
      res.redirect(isSafePath(returnTo) ? returnTo : `/members/${memberSlug}`);
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
  const { realName, displayName, email, password, confirmPassword } = req.body as {
    realName?: string; displayName?: string; email?: string; password?: string; confirmPassword?: string;
  };

  const renderError = (msg: string) => {
    res.status(422).render('auth/register', {
      seo: { title: 'Create Account' },
      page: { sectionKey: '', pageKey: 'register', title: 'Create an IFPA Account' },
      content: {
        error: msg,
        realName: realName ?? '',
        displayName: displayName ?? '',
        email: email ?? '',
      },
    });
  };

  try {
    await identityAccessService.registerMember(
      email ?? '',
      password ?? '',
      confirmPassword ?? '',
      realName ?? '',
      displayName ?? '',
    );
    // Both 'registered' and 'silent_duplicate' land here; the check-email
    // page is identical regardless, preventing account enumeration.
    // No session cookie is set.
    res.redirect('/register/check-email');
  } catch (err) {
    if (err instanceof ValidationError) {
      renderError(err.message);
      return;
    }
    next(err);
  }
}

function getCheckEmail(_req: Request, res: Response): void {
  res.render('auth/check-email', {
    seo: { title: 'Check your email' },
    page: { sectionKey: '', pageKey: 'check_email', title: 'Check your email' },
    content: {},
  });
}

async function getVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.params.token ?? '';
  try {
    const result = await identityAccessService.verifyEmailByToken(token);
    if (!result) {
      res.status(400).render('auth/verify-result', {
        seo: { title: 'Verification' },
        page: { sectionKey: '', pageKey: 'verify_result', title: 'Verification' },
        content: { ok: false },
      });
      return;
    }
    const role = result.isAdmin ? 'admin' : 'member';
    const cookieValue = await createSessionJwt(result.memberId, role, result.passwordVersion);
    issueSessionCookie(res, cookieValue, req);
    if (result.legacyMatch) {
      res.redirect('/history/claim');
      return;
    }
    res.redirect(`/members/${result.slug}`);
  } catch (err) {
    next(err);
  }
}

async function postVerifyResend(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email } = req.body as { email?: string };
  const normalized = (email ?? '').trim().toLowerCase();
  const rl = rateLimitHit(`verify-resend:${normalized}`, 3, 60);
  // Always render the identical response regardless of rate-limit outcome or
  // whether a member exists (anti-enumeration).
  if (rl.allowed) {
    try {
      await identityAccessService.resendVerifyEmail(normalized);
    } catch (err) {
      next(err);
      return;
    }
  }
  res.render('auth/check-email', {
    seo: { title: 'Check your email' },
    page: { sectionKey: '', pageKey: 'check_email', title: 'Check your email' },
    content: { resent: true },
  });
}

function postLogout(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.cookie(FLASH_LOGOUT_COOKIE, FLASH_LOGOUT_VALUE, {
    maxAge: 60_000,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    path: '/',
  });
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

function getPasswordForgot(_req: Request, res: Response): void {
  res.render('auth/password-forgot', {
    seo: { title: 'Reset your password' },
    page: { sectionKey: '', pageKey: 'password_forgot', title: 'Reset your password' },
    content: {},
  });
}

async function postPasswordForgot(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email } = req.body as { email?: string };
  try {
    await identityAccessService.requestPasswordReset(email ?? '');
    res.render('auth/password-forgot-sent', {
      seo: { title: 'Reset your password' },
      page: { sectionKey: '', pageKey: 'password_forgot_sent', title: 'Reset your password' },
      content: {},
    });
  } catch (err) {
    next(err);
  }
}

function setNoStore(res: Response): void {
  // Token-bearing pages must not be cached by browsers or shared proxies.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

function getPasswordReset(req: Request, res: Response): void {
  setNoStore(res);
  res.render('auth/password-reset', {
    seo: { title: 'Set a new password' },
    page: { sectionKey: '', pageKey: 'password_reset', title: 'Set a new password' },
    content: { token: req.params.token },
  });
}

async function postPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { newPassword, confirmPassword } = req.body as {
    newPassword?: string; confirmPassword?: string;
  };
  const token = req.params.token;
  try {
    const result = await identityAccessService.completePasswordReset(
      token,
      newPassword ?? '',
      confirmPassword ?? '',
    );
    const cookieValue = await createSessionJwt(result.memberId, result.role, result.newPasswordVersion);
    issueSessionCookie(res, cookieValue, req);
    res.redirect('/members');
  } catch (err) {
    if (err instanceof ValidationError) {
      setNoStore(res);
      res.status(422).render('auth/password-reset', {
        seo: { title: 'Set a new password' },
        page: { sectionKey: '', pageKey: 'password_reset', title: 'Set a new password' },
        content: { token, error: err.message },
      });
      return;
    }
    next(err);
  }
}

export const authController = {
  getLogin,
  postLogin,
  getRegister,
  postRegister,
  getCheckEmail,
  getVerify,
  postVerifyResend,
  getPasswordForgot,
  postPasswordForgot,
  getPasswordReset,
  postPasswordReset,
  postLogout,
};
