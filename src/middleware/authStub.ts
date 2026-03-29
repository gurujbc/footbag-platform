import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface SessionUser {
  userId: string;
  slug: string;
  role: string;
  displayName?: string;
}

// Augment Express Request so TypeScript knows about our auth properties.
declare global {
  namespace Express {
    interface Request {
      isAuthenticated: boolean;
      user: SessionUser | null;
    }
  }
}

export function createSessionCookie(userId: string, role: string, secret: string, displayName?: string, slug?: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, role, displayName, slug })).toString('base64');
  const sig = createHmac('sha256', secret).update(payload).digest('base64');
  return `${payload}.${sig}`;
}

export function parseSessionCookie(cookie: string, secret: string): SessionUser | null {
  const dotIndex = cookie.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const payload = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);

  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64');

  // Constant-time comparison to prevent timing attacks.
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (typeof data.userId === 'string' && typeof data.role === 'string') {
      return {
        userId: data.userId,
        slug: typeof data.slug === 'string' ? data.slug : data.userId,
        role: data.role,
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      };
    }
  } catch {
    // malformed payload
  }
  return null;
}

export function authStub(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookie = req.cookies?.footbag_session as string | undefined;
    if (cookie) {
      const user = parseSessionCookie(cookie, secret);
      req.isAuthenticated = user !== null;
      req.user = user;
    } else {
      req.isAuthenticated = false;
      req.user = null;
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated) {
    res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  next();
}
