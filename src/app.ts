import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { engine } from 'express-handlebars';
import { logger } from './config/logger';
import { config } from './config/env';
import { authMiddleware } from './middleware/auth';
import { FLASH_KIND, readFlash, clearFlash } from './lib/flashCookie';
import { healthRouter }   from './routes/healthRoutes';
import { internalRouter } from './routes/internalRoutes';
import { publicRouter }   from './routes/publicRoutes';
import { redactTokenPaths } from './lib/redactTokenPaths';
import { countryFlag } from './services/countryUtils';

/**
 * Factory that returns a configured Express application without
 * binding to a port. Keeping this as a factory (not a module singleton)
 * lets integration tests call createApp() directly without an HTTP server.
 */
export function createApp(): express.Application {
  const app = express();

  // Trust XFF only when the immediate peer is a private/loopback IP. Inside
  // the docker bridge the only inbound path is nginx, which is itself behind
  // CloudFront's X-Origin-Verify shared secret (terraform/.../cloudfront.tf
  // + docker/nginx/nginx.conf.template). Prod default is the named-range
  // string; dev/test defaults to 0.
  app.set('trust proxy', config.trustProxy);

  // Host-header injection is closed at the nginx layer (proxy_set_header Host
  // ${PUBLIC_HOST}, rendered from PUBLIC_BASE_URL). Express therefore always
  // sees the canonical host on req.hostname, regardless of which domain the
  // viewer used (CloudFront default *.cloudfront.net domain, custom CNAME,
  // future aliases). No app-layer middleware needed.

  // Strict Content-Security-Policy: 'self' for scripts and styles, no inline
  // execution, no inline event handlers, no framing. Third-party origins are
  // added only when a template references them — currently i.ytimg.com (YouTube
  // thumbnail CDN, served as the <img> placeholder before the user clicks the
  // facade) and www.youtube-nocookie.com (the privacy-friendly embed iframe
  // loaded after the click). data: is allowed in img-src as a future allowance
  // for small inline SVG icons (no current consumer). HSTS preload stays off
  // until the custom domain lands.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        scriptSrcAttr:  ["'none'"],
        styleSrc:       ["'self'"],
        imgSrc:         ["'self'", 'data:', 'https://i.ytimg.com'],
        fontSrc:        ["'self'"],
        connectSrc:     ["'self'"],
        frameSrc:       ['https://www.youtube-nocookie.com'],
        objectSrc:      ["'none'"],
        baseUri:        ["'self'"],
        formAction:     ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // ── Static assets ────────────────────────────────────────────────────────
  // Served from src/public/ so .hbs templates can reference /css/style.css etc.
  // process.cwd() resolves correctly from both tsx (dev) and dist/ (prod).
  app.use(express.static(path.join(process.cwd(), 'src', 'public')));

  // ── Media uploads (avatars, photos) ─────────────────────────────────────
  // Cache header matches the production S3 PUT contract
  // (Cache-Control: public, max-age=31536000, immutable). URL-versioning
  // via `?v={media_id}` makes `immutable` semantically correct: each
  // emitted URL is unique to its upload, replacement uploads emit a fresh
  // `?v=` and become a distinct cache entry.
  app.use(
    '/media',
    express.static(config.mediaDir, { maxAge: '1y', immutable: true }),
  );

  // ── View engine ──────────────────────────────────────────────────────────
  app.engine(
    'hbs',
    engine({
      extname: '.hbs',
      defaultLayout: 'main',
      layoutsDir:   path.join(process.cwd(), 'src', 'views', 'layouts'),
      partialsDir:  path.join(process.cwd(), 'src', 'views', 'partials'),
      helpers: {
        countryFlag: (country: string) => countryFlag(country),
        eq:  (a: unknown, b: unknown) => a === b,
        gt:  (a: unknown, b: unknown) => (a as number) > (b as number),
        add: (a: unknown, b: unknown) => (a as number) + (b as number),
        not: (a: unknown) => !a,
        formatDate: (iso: string) => {
          const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          const parts = String(iso).split('-');
          const year  = parts[0];
          const month = parseInt(parts[1], 10);
          const day   = parseInt(parts[2], 10);
          if (!parts[1]) return year;
          if (!parts[2] || isNaN(day)) return `${months[month - 1]} ${year}`;
          return `${day} ${months[month - 1]} ${year}`;
        },
        formatLocation: (city: unknown, region: unknown, country: unknown) => {
          const c = typeof city === 'string' ? city.trim() : '';
          const r = typeof region === 'string' ? region.trim() : '';
          const co = typeof country === 'string' ? country.trim() : '';
          if (!c && (!co || co.toLowerCase() === 'unknown')) return 'Location under investigation';
          const parts = [c, r, co].filter(Boolean);
          return parts.join(', ');
        },
        yearFromDate: (iso: string) => String(iso).split('-')[0],
      },
    }),
  );
  app.set('view engine', 'hbs');
  app.set('views', path.join(process.cwd(), 'src', 'views'));

  // ── Body parsing ─────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(config.sessionSecret));

  // ── Auth (JWT session + per-request passwordVersion check) ──────────────
  app.use(authMiddleware());

  // ── No-store on authenticated responses ──────────────────────────────────
  // Prevents CloudFront (and other shared caches) from storing personalized
  // HTML. Without this, post-upload redirects serve cached HTML carrying
  // stale avatar version tokens, making new uploads appear to not take effect.
  //
  // Current implementation is at the app layer. Target is the AWS managed
  // `CachingDisabled` CloudFront cache policy; this middleware is
  // functionally equivalent until the CloudFront policy is wired up.
  app.use((req, res, next) => {
    if (req.isAuthenticated) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    next();
  });

  // ── Active nav section + auth locals ─────────────────────────────────────
  app.use((req, res, next) => {
    res.locals.currentSection = req.path === '/' ? 'home'
      : req.path.startsWith('/events') ? 'events'
      : req.path.startsWith('/members') ? 'members'
      : req.path.startsWith('/history') ? 'history'
      : req.path.startsWith('/clubs') ? 'clubs'
      : req.path.startsWith('/hof') ? 'hof'
      : req.path.startsWith('/freestyle') ? 'freestyle'
      : req.path.startsWith('/records') ? 'records'
      : req.path.startsWith('/net') ? 'net'
      : '';
    res.locals.isAuthenticated = req.isAuthenticated;
    res.locals.currentUser = req.user;
    const flash = readFlash(req);
    if (flash?.kind === FLASH_KIND.LOGOUT) {
      res.locals.flashLoggedOut = true;
      // Clear only when the banner actually renders, not on redirects.
      // Otherwise a logout that redirects through an auth-gated page consumes
      // the cookie on the 302 response before the banner ever surfaces.
      const origRender = res.render.bind(res);
      res.render = ((...args: Parameters<typeof origRender>) => {
        clearFlash(res);
        return origRender(...args);
      }) as typeof res.render;
    }
    next();
  });

  // ── Request logging ──────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    logger.debug('incoming request', { method: req.method, url: redactTokenPaths(req.url) });
    next();
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/health',   healthRouter);
  app.use('/internal', internalRouter);
  app.use('/',         publicRouter);

  // ── 404 handler ──────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).render('errors/not-found', {
      seo:  { title: 'Page Not Found' },
      page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
    });
  });

  // ── 500 error handler ────────────────────────────────────────────────────
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('unhandled error', {
      method: req.method,
      url: req.url,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).render('errors/unavailable', {
      seo:  { title: 'Service Unavailable' },
      page: { sectionKey: '', pageKey: 'error_503', title: 'Service Unavailable' },
    });
  });

  return app;
}
