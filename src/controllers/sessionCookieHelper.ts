/**
 * Shared HTTP-layer helper for setting the session JWT cookie. Centralizes
 * the cookie-option block (httpOnly, sameSite, maxAge, secure detection)
 * so cookie-attribute changes happen in one place.
 */
import { Request, Response } from 'express';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
} from '../middleware/auth';

export function issueSessionCookie(
  res: Response,
  cookieValue: string,
  req: Request,
): void {
  res.cookie(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
  });
}
