import { Request, Response, NextFunction } from 'express';
import { auth as authDb } from '../db/db';
import { getJwtSigningAdapter } from '../adapters/jwtSigningAdapter';

export const SESSION_COOKIE_NAME = 'footbag_session';
export const SESSION_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export interface SessionUser {
  userId: string;
  slug: string;
  role: string;
  displayName?: string;
}

declare global {
  namespace Express {
    interface Request {
      isAuthenticated: boolean;
      user: SessionUser | null;
    }
  }
}

interface SessionMemberRow {
  id: string;
  slug: string | null;
  display_name: string | null;
  password_version: number;
  is_admin: number;
}

export function authMiddleware() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    req.isAuthenticated = false;
    req.user = null;

    const cookie = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!cookie) {
      next();
      return;
    }

    try {
      const claims = await getJwtSigningAdapter().verifyJwt(cookie);
      if (!claims) {
        next();
        return;
      }

      const row = authDb.findMemberForSession.get(claims.sub) as
        | SessionMemberRow
        | undefined;
      if (!row) {
        next();
        return;
      }

      if (row.password_version !== claims.passwordVersion) {
        next();
        return;
      }

      req.isAuthenticated = true;
      req.user = {
        userId: row.id,
        slug: row.slug ?? row.id,
        // Authz role is derived strictly from the current DB row, never
        // from JWT claims. A stale admin-role JWT issued before demotion
        // must not grant admin privileges after `is_admin` is cleared.
        // `claims.role` stays in the token for audit logs but is not used
        // for authorization decisions.
        role: row.is_admin ? 'admin' : 'member',
        displayName: row.display_name ?? undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated) {
    res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
}
