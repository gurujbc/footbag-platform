import { Request, Response, NextFunction } from 'express';
import Busboy from 'busboy';
import { memberService, ProfileEditInput } from '../services/memberService';
import { AVATAR_MAX_BYTES, createAvatarService } from '../services/avatarService';
import { identityAccessService } from '../services/identityAccessService';
import { getPhotoStorageAdapter } from '../adapters/photoStorageAdapter';
import { getImageProcessingAdapter } from '../adapters/imageProcessingAdapter';
import { createSessionJwt } from '../services/jwtService';
import { issueSessionCookie } from '../lib/sessionCookie';
import { RateLimitedError, ValidationError, NotFoundError } from '../services/serviceErrors';
import { PageViewModel } from '../types/page';
import { FLASH_KIND, writeFlash, readFlash, clearFlash } from '../lib/flashCookie';

type MemberWelcomeContent = Record<string, never>;

interface MemberPasswordEditContent {
  memberKey: string;
  error?: string;
  success?: boolean;
}

type MemberStubContent = Record<string, never>;
import { logger } from '../config/logger';

// Avatar-upload flash: filename display is capped so a maliciously long
// filename cannot blow out the banner. Cookie semantics live in lib/flashCookie.
const FLASH_NAME_MAX_LEN = 120;

interface StubConfig {
  pageKey: string;
  title: string;
}

const STUB_SEGMENTS: Record<string, StubConfig> = {
  media:    { pageKey: 'member_media',    title: 'Share Media' },
  settings: { pageKey: 'member_settings', title: 'Account Settings' },
  download: { pageKey: 'member_download', title: 'Download My Data' },
  delete:   { pageKey: 'member_delete',   title: 'Delete Account' },
};

function isOwnProfile(req: Request): boolean {
  return req.user?.slug === req.params.memberKey;
}

function renderNotFound(res: Response): void {
  res.status(404).render('errors/not-found', {
    seo:  { title: 'Page Not Found' },
    page: { sectionKey: '', pageKey: 'error_404', title: 'Page Not Found' },
  });
}

export const memberController = {
  /** GET /members, members landing; public welcome or authenticated search. */
  landing(req: Request, res: Response, next: NextFunction): void {
    if (!req.isAuthenticated) {
      res.render('members/welcome', {
        seo: { title: 'Members' },
        page: { sectionKey: 'members', pageKey: 'member_welcome', title: 'Members' },
        content: {},
      } satisfies PageViewModel<MemberWelcomeContent>);
      return;
    }
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const vm = memberService.getMembersLandingPage(
        req.user!.slug,
        req.user!.displayName ?? 'Member',
        query,
      );
      res.render('members/landing', vm);
    } catch (err) {
      logger.error('members landing error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /** GET /members/:memberKey, own profile or public read-only for HoF/BAP. */
  getProfile(req: Request, res: Response, next: NextFunction): void {
    const memberKey = req.params.memberKey;

    if (isOwnProfile(req)) {
      try {
        const vm = memberService.getOwnProfile(memberKey);
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
      const publicVm = memberService.getPublicProfile(memberKey);
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

  /** GET /members/:memberKey/edit */
  getProfileEdit(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    try {
      let avatarSuccess: string | undefined;
      const flash = readFlash(req);
      if (flash?.kind === FLASH_KIND.AVATAR_UPLOADED) {
        const name = flash.payload && flash.payload.length > 0
          ? flash.payload.slice(0, FLASH_NAME_MAX_LEN)
          : null;
        avatarSuccess = name ? `Avatar updated: ${name}` : 'Avatar updated.';
        clearFlash(res);
      }
      const vm = memberService.getProfileEditPage(
        req.params.memberKey,
        undefined,
        undefined,
        avatarSuccess,
      );
      res.render('members/profile-edit', vm);
    } catch (err) {
      if (err instanceof NotFoundError) { renderNotFound(res); return; }
      logger.error('member profile edit error', { error: err instanceof Error ? err.message : String(err) });
      next(err);
    }
  },

  /** POST /members/:memberKey/edit */
  postProfileEdit(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    try {
      const memberKey = req.params.memberKey;
      const input: ProfileEditInput = {
        bio:             req.body.bio            ?? '',
        city:            req.body.city           ?? '',
        region:          req.body.region         ?? '',
        country:         req.body.country        ?? '',
        phone:           req.body.phone          ?? '',
        emailVisibility: req.body.emailVisibility ?? 'private',
        firstCompetitionYear: req.body.firstCompetitionYear ?? '',
        showCompetitiveResults: req.body.showCompetitiveResults ?? '1',
      };
      try {
        memberService.updateOwnProfile(memberKey, input);
        res.redirect(`/members/${memberKey}`);
      } catch (err) {
        if (err instanceof ValidationError) {
          const vm = memberService.getProfileEditPage(memberKey, err.message);
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

  /** POST /members/:memberKey/avatar, handle avatar file upload. */
  postAvatarUpload(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }

    const memberKey = req.params.memberKey;
    const memberId = req.user!.userId;

    const renderError = (msg: string) => {
      const vm = memberService.getProfileEditPage(memberKey, undefined, msg);
      res.status(422).render('members/profile-edit', vm);
    };

    const chunks: Buffer[] = [];
    let fileFound = false;
    let totalBytes = 0;
    let limitExceeded = false;
    let uploadedFilename = '';

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
    });

    busboy.on('file', (_fieldname, stream, info) => {
      fileFound = true;
      if (info && typeof info.filename === 'string') {
        uploadedFilename = info.filename.slice(0, FLASH_NAME_MAX_LEN);
      }
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > AVATAR_MAX_BYTES) {
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
      const avatarService = createAvatarService({
        storage: getPhotoStorageAdapter(),
        imageProcessor: getImageProcessingAdapter(),
      });

      avatarService.uploadAvatar(memberId, fileBuffer)
        .then(() => {
          writeFlash(res, req, FLASH_KIND.AVATAR_UPLOADED, uploadedFilename || undefined);
          res.redirect(`/members/${memberKey}/edit`);
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

  /** GET /members/:memberKey/edit/password, password-change form (own profile only). */
  getPasswordEdit(req: Request, res: Response): void {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    res.render('members/password-edit', {
      seo:  { title: 'Change Password' },
      page: { sectionKey: 'members', pageKey: 'member_password', title: 'Change Password' },
      navigation: {
        contextLinks: [{ label: 'Back to Profile', href: `/members/${req.params.memberKey}` }],
      },
      content: { memberKey: req.params.memberKey },
    } satisfies PageViewModel<MemberPasswordEditContent>);
  },

  /** POST /members/:memberKey/edit/password, apply password change. */
  async postPasswordEdit(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!isOwnProfile(req)) {
      renderNotFound(res);
      return;
    }
    const memberId = req.user!.userId;

    const renderForm = (opts: { error?: string; success?: boolean; status?: number }) => {
      res.status(opts.status ?? 200).render('members/password-edit', {
        seo:  { title: 'Change Password' },
        page: { sectionKey: 'members', pageKey: 'member_password', title: 'Change Password' },
        navigation: {
          contextLinks: [{ label: 'Back to Profile', href: `/members/${req.params.memberKey}` }],
        },
        content: { error: opts.error, success: opts.success, memberKey: req.params.memberKey },
      } satisfies PageViewModel<MemberPasswordEditContent>);
    };

    const { oldPassword, newPassword, confirmPassword } = req.body as {
      oldPassword?: string; newPassword?: string; confirmPassword?: string;
    };

    try {
      const result = await identityAccessService.changePassword(
        memberId,
        oldPassword ?? '',
        newPassword ?? '',
        confirmPassword ?? '',
      );
      // Re-issue the JWT cookie under the new passwordVersion so this browser
      // stays authenticated. Other sessions (older passwordVersion) are rejected
      // by the auth middleware's per-request DB check.
      const role = req.user!.role;
      const cookieValue = await createSessionJwt(result.memberId, role, result.newPasswordVersion);
      issueSessionCookie(res, cookieValue, req);
      renderForm({ success: true });
    } catch (err) {
      if (err instanceof RateLimitedError) {
        if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
        renderForm({ error: err.message, status: 429 });
        return;
      }
      if (err instanceof ValidationError) {
        renderForm({ error: err.message, status: 422 });
        return;
      }
      next(err);
    }
  },

  /** GET /members/:memberKey/:section, stub pages (own profile only). */
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
          contextLinks: [{ label: 'Back to Profile', href: `/members/${req.params.memberKey}` }],
        },
        content: {},
      } satisfies PageViewModel<MemberStubContent>);
    } catch (err) {
      next(err);
    }
  },
};
