import { Request, Response, NextFunction } from 'express';
import Busboy from 'busboy';
import { memberService, ProfileEditInput } from '../services/memberService';
import { createAvatarService } from '../services/avatarService';
import { getPhotoStorage } from '../adapters/photoStorageInstance';
import { ValidationError, NotFoundError } from '../services/serviceErrors';
import { logger } from '../config/logger';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface StubConfig {
  pageKey: string;
  title: string;
}

const STUB_SEGMENTS: Record<string, StubConfig> = {
  media:    { pageKey: 'member_media',    title: 'Share Media' },
  settings: { pageKey: 'member_settings', title: 'Account Settings' },
  password: { pageKey: 'member_password', title: 'Change Password' },
  download: { pageKey: 'member_download', title: 'Download My Data' },
  delete:   { pageKey: 'member_delete',   title: 'Delete Account' },
};

function isOwnProfile(req: Request): boolean {
  return req.user?.slug === req.params.memberId;
}

function renderNotFound(res: Response): void {
  res.status(404).render('errors/not-found', {
    seo:  { title: 'Page Not Found' },
    page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
  });
}

export const memberController = {
  /** GET /members — redirect to own profile when authenticated. */
  landing(req: Request, res: Response): void {
    res.redirect(`/members/${req.user!.slug}`);
  },

  /** GET /members/:memberId — own profile, or public read-only for HoF/BAP members. */
  getProfile(req: Request, res: Response, next: NextFunction): void {
    if (isOwnProfile(req)) {
      try {
        const vm = memberService.getOwnProfile(req.params.memberId);
        res.render('members/profile', vm);
      } catch (err) {
        if (err instanceof NotFoundError) { renderNotFound(res); return; }
        logger.error('member profile error', { error: err instanceof Error ? err.message : String(err) });
        next(err);
      }
      return;
    }

    // Not own profile: try public HoF/BAP view.
    try {
      const publicVm = memberService.getPublicProfile(req.params.memberId);
      if (publicVm) {
        res.render('members/public-profile', publicVm);
        return;
      }
    } catch (err) {
      if (err instanceof NotFoundError) { renderNotFound(res); return; }
      logger.error('member public profile error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
      return;
    }

    // Not HoF/BAP: require auth, then 404.
    if (!req.isAuthenticated) {
      res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    renderNotFound(res);
  },

  /** GET /members/:memberId/edit */
  getProfileEdit(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    try {
      const vm = memberService.getProfileEditPage(req.params.memberId);
      res.render('members/profile-edit', vm);
    } catch (err) {
      if (err instanceof NotFoundError) { renderNotFound(res); return; }
      logger.error('member profile edit error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /** POST /members/:memberId/edit */
  postProfileEdit(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    try {
      const memberId = req.params.memberId;
      const input: ProfileEditInput = {
        displayName:     req.body.displayName    ?? '',
        bio:             req.body.bio            ?? '',
        city:            req.body.city           ?? '',
        region:          req.body.region         ?? '',
        country:         req.body.country        ?? '',
        phone:           req.body.phone          ?? '',
        emailVisibility: req.body.emailVisibility ?? 'private',
      };
      try {
        memberService.updateOwnProfile(memberId, input);
        res.redirect(`/members/${memberId}`);
      } catch (err) {
        if (err instanceof ValidationError) {
          const vm = memberService.getProfileEditPage(memberId, err.message);
          res.status(422).render('members/profile-edit', vm);
          return;
        }
        throw err;
      }
    } catch (err) {
      logger.error('member profile edit post error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /** GET /members/:memberId/avatar — avatar upload form. */
  getAvatarUpload(req: Request, res: Response): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    const slug = req.params.memberId;
    res.render('members/avatar-upload', {
      seo:  { title: 'Upload Avatar' },
      page: { sectionKey: 'members', pageKey: 'member_avatar', title: 'Upload Avatar' },
      navigation: {
        contextLinks: [{ label: 'Back to Profile', href: `/members/${slug}` }],
      },
      content: {},
    });
  },

  /** POST /members/:memberId/avatar — handle avatar file upload. */
  postAvatarUpload(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }

    const slug = req.params.memberId;
    const memberId = req.user!.userId;

    const renderError = (msg: string) => {
      res.status(422).render('members/avatar-upload', {
        seo:  { title: 'Upload Avatar' },
        page: { sectionKey: 'members', pageKey: 'member_avatar', title: 'Upload Avatar' },
        navigation: {
          contextLinks: [{ label: 'Back to Profile', href: `/members/${slug}` }],
        },
        content: { error: msg },
      });
    };

    const chunks: Buffer[] = [];
    let fileFound = false;
    let totalBytes = 0;
    let limitExceeded = false;

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    busboy.on('file', (_fieldname, stream, _info) => {
      fileFound = true;
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_UPLOAD_BYTES) {
          limitExceeded = true;
          stream.resume();
          return;
        }
        chunks.push(chunk);
      });
    });

    busboy.on('finish', () => {
      if (!fileFound || totalBytes === 0) {
        renderError('Please select an image file to upload.');
        return;
      }
      if (limitExceeded) {
        renderError('File is too large. Maximum size is 5 MB.');
        return;
      }

      const fileBuffer = Buffer.concat(chunks);
      const avatarService = createAvatarService(getPhotoStorage());

      avatarService.uploadAvatar(memberId, fileBuffer)
        .then(() => {
          res.redirect(`/members/${slug}`);
        })
        .catch((err: unknown) => {
          if (err instanceof ValidationError) {
            renderError(err.message);
            return;
          }
          logger.error('avatar upload error', { error: err instanceof Error ? err.message : String(err) });
          next(err);
        });
    });

    busboy.on('error', (err: Error) => {
      logger.error('busboy parse error', { error: err.message });
      next(err);
    });

    req.pipe(busboy);
  },

  /** GET /members/:memberId/:section — stub pages (own profile only). */
  getStub(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    const config = STUB_SEGMENTS[req.params.section];
    if (!config) { next(); return; }
    try {
      res.render('members/stub', {
        seo:  { title: config.title },
        page: { sectionKey: 'members', pageKey: config.pageKey, title: config.title },
        navigation: {
          contextLinks: [{ label: 'Back to Profile', href: `/members/${req.params.memberId}` }],
        },
        content: {},
      });
    } catch (err) {
      next(err);
    }
  },
};
