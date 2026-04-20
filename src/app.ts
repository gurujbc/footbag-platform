import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { engine } from 'express-handlebars';
import { logger } from './config/logger';
import { config } from './config/env';
import { authMiddleware } from './middleware/auth';
import { FLASH_LOGOUT_COOKIE, FLASH_LOGOUT_VALUE } from './controllers/authController';
import { healthRouter }   from './routes/healthRoutes';
import { internalRouter } from './routes/internalRoutes';
import { publicRouter }   from './routes/publicRoutes';

/**
 * Factory that returns a configured Express application without
 * binding to a port. Keeping this as a factory (not a module singleton)
 * lets integration tests call createApp() directly without an HTTP server.
 */
export function createApp(): express.Application {
  const app = express();

  // Express trust-proxy setting, driven by TRUST_PROXY env via config.
  // Production default is 2 (nginx container peer + CloudFront edge);
  // dev/test default is 0. Operators can override with an integer,
  // boolean, or subnet list without a code change. Revisit when
  // CloudFront origin-bypass hardening (IP deviation #12 / 1-F) lands.
  app.set('trust proxy', config.trustProxy);

  // ── Static assets ────────────────────────────────────────────────────────
  // Served from src/public/ so .hbs templates can reference /css/style.css etc.
  // process.cwd() resolves correctly from both tsx (dev) and dist/ (prod).
  app.use(express.static(path.join(process.cwd(), 'src', 'public')));

  // ── Media uploads (avatars, photos) ─────────────────────────────────────
  app.use('/media', express.static(config.mediaDir, { maxAge: '7d' }));

  // ── View engine ──────────────────────────────────────────────────────────
  const COUNTRY_FLAGS: Record<string, string> = {
    'Argentina':        '🇦🇷',
    'Australia':        '🇦🇺',
    'Austria':          '🇦🇹',
    'Belgium':          '🇧🇪',
    'Brazil':           '🇧🇷',
    'Bulgaria':         '🇧🇬',
    'Canada':           '🇨🇦',
    'Chile':            '🇨🇱',
    'China':            '🇨🇳',
    'Colombia':         '🇨🇴',
    'Czech Republic':   '🇨🇿',
    'Denmark':          '🇩🇰',
    'Estonia':          '🇪🇪',
    'Finland':          '🇫🇮',
    'France':           '🇫🇷',
    'Germany':          '🇩🇪',
    'Hungary':          '🇭🇺',
    'India':            '🇮🇳',
    'Ireland':          '🇮🇪',
    'Japan':            '🇯🇵',
    'Mexico':           '🇲🇽',
    'New Zealand':      '🇳🇿',
    'Nigeria':          '🇳🇬',
    'Pakistan':         '🇵🇰',
    'Poland':           '🇵🇱',
    'Puerto Rico':      '🇵🇷',
    'Russia':           '🇷🇺',
    'Slovakia':         '🇸🇰',
    'Slovenia':         '🇸🇮',
    'South Africa':     '🇿🇦',
    'South Korea':      '🇰🇷',
    'Spain':            '🇪🇸',
    'Sweden':           '🇸🇪',
    'Switzerland':      '🇨🇭',
    'The Netherlands':  '🇳🇱',
    'Turkey':           '🇹🇷',
    'Ukraine':          '🇺🇦',
    'United Kingdom':   '🇬🇧',
    'USA':              '🇺🇸',
    'United States':    '🇺🇸',
    'Venezuela':        '🇻🇪',
  };

  app.engine(
    'hbs',
    engine({
      extname: '.hbs',
      defaultLayout: 'main',
      layoutsDir:   path.join(process.cwd(), 'src', 'views', 'layouts'),
      partialsDir:  path.join(process.cwd(), 'src', 'views', 'partials'),
      helpers: {
        countryFlag: (country: string) => COUNTRY_FLAGS[country] ?? '',
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
  app.use(cookieParser());

  // ── Auth (JWT session + per-request passwordVersion check) ──────────────
  app.use(authMiddleware());

  // ── No-store on authenticated responses ──────────────────────────────────
  // Prevents CloudFront (and other shared caches) from storing personalized
  // HTML. Without this, post-upload redirects serve cached HTML carrying
  // stale avatar version tokens, making new uploads appear to not take effect.
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
    if (req.cookies?.[FLASH_LOGOUT_COOKIE] === FLASH_LOGOUT_VALUE) {
      res.locals.flashLoggedOut = true;
      // Clear only when the banner actually renders, not on redirects.
      // Otherwise a logout that redirects through an auth-gated page consumes
      // the cookie on the 302 response before the banner ever surfaces.
      const origRender = res.render.bind(res);
      res.render = ((...args: Parameters<typeof origRender>) => {
        res.clearCookie(FLASH_LOGOUT_COOKIE, { path: '/' });
        return origRender(...args);
      }) as typeof res.render;
    }
    next();
  });

  // ── Request logging ──────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    logger.debug('incoming request', { method: req.method, url: req.url });
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
