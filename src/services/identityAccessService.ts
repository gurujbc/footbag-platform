import { randomUUID } from 'crypto';
import argon2 from 'argon2';
import { auth, registration, legacyClaim, legacyMembers, MemberAuthRow, LegacyMemberRow, AlreadyClaimedRow, HistoricalPersonClaimRow } from '../db/db';
import { transaction } from '../db/db';
import { accountTokenService } from './accountTokenService';
import { getCommunicationService } from './communicationService';
import { hit as rateLimitHit } from './rateLimitService';
import { readIntConfig } from './configReader';
import { config } from '../config/env';
import { ValidationError } from './serviceErrors';

const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME = 64;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Generate a URL-safe slug from a display name.
 * Rules: lowercase, spaces become _, strip non-alphanumeric/underscore,
 * collapse consecutive underscores, trim leading/trailing underscores.
 */
import { slugify } from './slugify';
export { slugify };

/**
 * Generate a unique slug. Appends _2, _3, etc. on conflict.
 */
export function generateUniqueSlug(displayName: string): string {
  const base = slugify(displayName);
  if (!base) {
    // Fallback for names that produce empty slugs (e.g. all non-ASCII).
    const fallback = `member_${randomUUID().slice(0, 8)}`;
    return fallback;
  }

  const exists = (slug: string): boolean =>
    (registration.checkSlugExists.get(slug) as { exists_flag: number } | undefined) !== undefined;

  if (!exists(base)) return base;

  let suffix = 2;
  while (exists(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

export interface RegisteredMember {
  id: string;
  slug: string;
  displayName: string;
  isAdmin: number;
  passwordVersion: number;
}

export interface RegisterResult {
  /**
   * Always redirect to /register/check-email regardless of which branch ran.
   * Duplicate-email registrations silently take the 'silent_duplicate' branch
   * to prevent account enumeration.
   */
  status: 'registered' | 'silent_duplicate';
}

/**
 * Verify member credentials against the database.
 *
 * Returns the member row on success, null on any failure (wrong password,
 * not found, unverified, deceased). Fall-through to the env-var stub is the
 * caller's responsibility and must only happen when this returns null AND the
 * email did not match any DB row.
 */
async function verifyMemberCredentials(
  email: string,
  password: string,
): Promise<MemberAuthRow | null> {
  const normalized = normalizeEmail(email);
  const member = auth.findMemberByEmail.get(normalized) as MemberAuthRow | undefined;

  if (!member) {
    return null;
  }

  const valid = await argon2.verify(member.password_hash, password);
  if (!valid) {
    return null;
  }

  const now = new Date().toISOString();
  auth.updateMemberLastLogin.run(now, now, member.id);

  return member;
}

/**
 * Register a new member account.
 *
 * Validates input, hashes password, generates a unique slug, and inserts the
 * member row. Email is auto-verified in the current dev phase (real email
 * verification is a later-phase item).
 */
/**
 * Extract the surname (last word) from a name after stripping common suffixes.
 */
function extractSurname(name: string): string {
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md']);
  const words = name.trim().split(/\s+/);
  // Strip trailing suffixes
  while (words.length > 1 && suffixes.has(words[words.length - 1].replace(/\.$/, '').toLowerCase())) {
    words.pop();
  }
  return words[words.length - 1] || '';
}

/**
 * Strip accents for comparison (Unicode NFD decomposition, remove combining marks).
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Validate a full legal name for registration.
 * Rules: required, 2-64 chars, at least two words, at least one word 2+ chars, no digits.
 */
function validateRealName(name: string): void {
  if (!name) {
    throw new ValidationError('Full legal name is required.');
  }
  if (name.length > MAX_DISPLAY_NAME) {
    throw new ValidationError(`Full legal name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
  }
  if (/\d/.test(name)) {
    throw new ValidationError('Full legal name must not contain digits.');
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    throw new ValidationError('Full legal name must include at least a first name and last name.');
  }
  if (!words.some(w => w.length >= 2)) {
    throw new ValidationError('Full legal name must include at least one name that is two or more characters.');
  }
}

/**
 * Validate that a display name shares a surname with the real name.
 */
function validateDisplayNameSurname(displayName: string, realName: string): void {
  const displaySurname = stripAccents(extractSurname(displayName)).toLowerCase();
  const realSurname = stripAccents(extractSurname(realName)).toLowerCase();
  if (displaySurname !== realSurname) {
    throw new ValidationError('Display name must include your last name.');
  }
}

async function registerMember(
  email: string,
  password: string,
  confirmPassword: string,
  realName: string,
  displayName: string,
): Promise<RegisterResult> {
  const trimmedRealName = realName.trim();
  const trimmedDisplayName = displayName.trim() || trimmedRealName;
  const trimmedEmail = email.trim();
  const normalizedEmail = normalizeEmail(trimmedEmail);

  validateRealName(trimmedRealName);

  if (trimmedDisplayName.length > MAX_DISPLAY_NAME) {
    throw new ValidationError(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
  }
  if (trimmedDisplayName !== trimmedRealName) {
    validateDisplayNameSurname(trimmedDisplayName, trimmedRealName);
  }

  if (!trimmedEmail) {
    throw new ValidationError('Email address is required.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirmPassword) {
    throw new ValidationError('Passwords do not match.');
  }

  const emailExists = registration.checkEmailExists.get(normalizedEmail) as { exists_flag: number } | undefined;
  if (emailExists) {
    // Anti-enumeration: render the same check-email page for an
    // already-registered address. We do not re-issue a token here;
    // the existing verified account is unaffected.
    return { status: 'silent_duplicate' };
  }

  const id = `member_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const slug = generateUniqueSlug(trimmedDisplayName);
  const hash = await argon2.hash(password);
  const now = new Date().toISOString();

  registration.insertMember.run(
    id,
    slug,
    trimmedEmail,
    normalizedEmail,
    null,  // email_verified_at — NULL until verify link consumed
    hash,
    now,   // password_changed_at
    trimmedRealName,                    // real_name
    trimmedDisplayName,                 // display_name
    trimmedDisplayName.toLowerCase(),   // display_name_normalized
    now,   // created_at
    now,   // updated_at
  );

  await issueAndEnqueueVerifyEmail(id, trimmedEmail);
  return { status: 'registered' };
}

export interface VerifyEmailResult {
  memberId: string;
  slug: string;
  passwordVersion: number;
  isAdmin: number;
  legacyMatch: LegacyAccountLookupResult | null;
}

async function issueAndEnqueueVerifyEmail(memberId: string, recipientEmail: string): Promise<void> {
  const { rawToken } = accountTokenService.issueToken({
    memberId,
    tokenType: 'email_verify',
    ttlHours: 24,
  });
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, '');
  const verifyUrl = `${baseUrl}/verify/${rawToken}`;
  getCommunicationService().enqueueEmail({
    recipientEmail,
    recipientMemberId: memberId,
    subject: 'Verify your IFPA Footbag account',
    bodyText:
      'Welcome to IFPA Footbag.\n\n' +
      'Please confirm your email address by opening the link below. The link expires in 24 hours.\n\n' +
      `${verifyUrl}\n\n` +
      'If you did not request this account, you can ignore this message.',
  });
}

/**
 * Consume an email_verify token, mark the member verified, run the legacy-link
 * check, and return the session inputs the controller needs to issue a JWT.
 * Returns null if the token is invalid, expired, or already used.
 */
async function verifyEmailByToken(rawToken: string): Promise<VerifyEmailResult | null> {
  const consumed = accountTokenService.consumeToken(rawToken, 'email_verify');
  if (!consumed) return null;

  const now = new Date().toISOString();
  const update = auth.markEmailVerified.run(now, now, consumed.memberId);
  // update.changes may be 0 if the member was already verified; that's fine
  // since the token itself is single-use, we proceed with login in any case.

  const row = auth.findMemberForSessionAfterVerify.get(consumed.memberId) as
    | { id: string; slug: string | null; login_email: string | null; password_version: number; is_admin: number }
    | undefined;
  if (!row) return null;

  // Legacy-link check: see whether this member's email matches an
  // imported legacy row so the post-verify
  // landing can offer the claim flow. lookupLegacyAccount throws on already-
  // claimed; at verify time the member has never claimed, so errors here
  // are swallowed, they don't belong on the verify path.
  let legacyMatch: LegacyAccountLookupResult | null = null;
  if (row.login_email) {
    try {
      legacyMatch = lookupLegacyAccount(row.id, row.login_email);
    } catch {
      legacyMatch = null;
    }
  }

  return {
    memberId: row.id,
    slug: row.slug ?? row.id,
    passwordVersion: row.password_version,
    isAdmin: row.is_admin,
    legacyMatch,
  };
}

/**
 * Re-send an email_verify token to an unverified member. Normalizes the
 * provided email, silently no-ops when no unverified member matches.
 * Callers are expected to rate-limit per-email before invoking.
 */
async function resendVerifyEmail(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const row = auth.findUnverifiedMemberByEmail.get(normalized) as
    | { id: string }
    | undefined;
  if (!row) return;
  await issueAndEnqueueVerifyEmail(row.id, email.trim());
}

// ── Legacy account claim flow (three-table design) ──────────────────────────
//
// Operates against the legacy_members table. Claim marks the row (sets
// claimed_by_member_id + claimed_at); the row is never deleted. If the claimed
// legacy account has a matching historical_persons.legacy_member_id,
// members.historical_person_id is also set in the same transaction.

export interface LegacyAccountLookupResult {
  legacyMemberId: string;
  displayName: string | null;
  country: string | null;
  isHof: boolean;
  isBap: boolean;
}

function lookupLegacyAccount(
  requestingMemberId: string,
  identifier: string,
): LegacyAccountLookupResult | null {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new ValidationError('Please enter a legacy identifier.');
  }

  const already = legacyClaim.checkAlreadyClaimed.get(requestingMemberId) as AlreadyClaimedRow | undefined;
  if (already) {
    throw new ValidationError('Your account is already linked to a legacy record.');
  }

  const row = legacyMembers.findByIdentifier.get(trimmed, trimmed, trimmed) as LegacyMemberRow | undefined;
  if (!row) return null;

  return {
    legacyMemberId: row.legacy_member_id,
    displayName: row.display_name ?? row.real_name ?? null,
    country: row.country,
    isHof: Boolean(row.is_hof),
    isBap: Boolean(row.is_bap),
  };
}

/**
 * Execute the three-table claim transaction.
 *
 * Marks the legacy_members row claimed (atomic via WHERE claimed_by_member_id IS NULL),
 * copies merge-eligible fields to the claiming members row, and if the legacy account
 * has a matching historical_persons row (shared legacy_member_id), also sets
 * members.historical_person_id so the member↔HP FK link is established.
 */
function claimLegacyAccount(requestingMemberId: string, targetLegacyMemberId: string): void {
  transaction(() => {
    const already = legacyClaim.checkAlreadyClaimed.get(requestingMemberId) as AlreadyClaimedRow | undefined;
    if (already) {
      throw new ValidationError('Your account is already linked to a legacy record.');
    }

    const row = legacyMembers.findByLegacyMemberId.get(targetLegacyMemberId) as LegacyMemberRow | undefined;
    if (!row) {
      throw new ValidationError('The legacy record is no longer available for claim.');
    }
    if (row.claimed_by_member_id) {
      throw new ValidationError('This legacy record has already been claimed by another account.');
    }

    const now = new Date().toISOString();

    const marked = legacyMembers.markClaimed.run(requestingMemberId, now, targetLegacyMemberId);
    if (marked.changes === 0) {
      throw new ValidationError('This legacy record has already been claimed by another account.');
    }

    legacyClaim.transferLegacyFields.run(
      row.legacy_member_id,
      row.legacy_user_id,
      row.legacy_email,
      row.bio ?? '',
      row.birth_date,
      row.street_address,
      row.postal_code,
      row.city,
      row.region,
      row.country,
      row.ifpa_join_date,
      row.is_hof,
      row.is_bap,
      row.first_competition_year,
      now,
      requestingMemberId,
    );

    const hp = legacyClaim.findHistoricalPersonByLegacyId.get(row.legacy_member_id) as HistoricalPersonClaimRow | undefined;
    if (hp) {
      legacyMembers.setMemberHistoricalPersonId.run(hp.person_id, now, requestingMemberId);
    }
  });
}

export interface PasswordChangeResult {
  memberId: string;
  newPasswordVersion: number;
}

async function changePassword(
  memberId: string,
  oldPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<PasswordChangeResult> {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match.');
  }
  if (oldPassword === newPassword) {
    throw new ValidationError('New password must be different from your current password.');
  }

  const row = auth.findMemberForPasswordChange.get(memberId) as
    | { id: string; password_hash: string; password_version: number }
    | undefined;
  if (!row || !row.password_hash) {
    throw new ValidationError('Current password is incorrect.');
  }

  const ok = await argon2.verify(row.password_hash, oldPassword);
  if (!ok) {
    throw new ValidationError('Current password is incorrect.');
  }

  const newHash = await argon2.hash(newPassword);
  const now = new Date().toISOString();
  auth.updateMemberPassword.run(newHash, now, now, memberId);

  // Confirmation email. Best-effort: enqueue failures must not unwind
  // the password change.
  try {
    const member = auth.findMemberForSessionAfterVerify.get(memberId) as
      | { login_email: string | null }
      | undefined;
    if (member?.login_email) {
      getCommunicationService().enqueueEmail({
        recipientEmail: member.login_email,
        recipientMemberId: memberId,
        subject: 'Your IFPA Footbag password was changed',
        bodyText:
          'This is a confirmation that the password for your IFPA Footbag account was just changed.\n\n' +
          'If this was not you, please reset your password immediately and contact admin@footbag.org.',
      });
    }
  } catch {
    // Swallow: the password change itself already committed.
  }

  return { memberId, newPasswordVersion: row.password_version + 1 };
}

// ── Password reset ───────────────────────────────────────────────────────────

export interface PasswordResetRequestResult {
  /** Always true; caller renders the same page either way (anti-enumeration). */
  responseSent: true;
}

async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const normalized = normalizeEmail(email);
  const maxAttempts = readIntConfig('password_reset_rate_limit_max_attempts', 5);
  const windowMinutes = readIntConfig('password_reset_rate_limit_window_minutes', 60);
  const rl = rateLimitHit(`pwreset:${normalized}`, maxAttempts, windowMinutes);
  if (!rl.allowed) {
    return { responseSent: true };
  }
  const row = auth.findMemberByEmail.get(normalized) as MemberAuthRow | undefined;
  if (!row) {
    return { responseSent: true };
  }
  const ttlHours = readIntConfig('password_reset_expiry_hours', 1);
  const { rawToken } = accountTokenService.issueToken({
    memberId: row.id,
    tokenType: 'password_reset',
    ttlHours,
  });
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, '');
  const resetUrl = `${baseUrl}/password/reset/${rawToken}`;
  getCommunicationService().enqueueEmail({
    recipientEmail: email.trim(),
    recipientMemberId: row.id,
    subject: 'Reset your IFPA Footbag password',
    bodyText:
      'A password reset was requested for your IFPA Footbag account.\n\n' +
      `Open the link below within ${ttlHours} hour${ttlHours === 1 ? '' : 's'} to set a new password:\n\n` +
      `${resetUrl}\n\n` +
      'If you did not request this, you can ignore this message. Your current password remains in effect.',
  });
  return { responseSent: true };
}

export interface PasswordResetCompletionResult {
  memberId: string;
  newPasswordVersion: number;
  role: 'admin' | 'member';
}

async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  confirmPassword: string,
): Promise<PasswordResetCompletionResult> {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match.');
  }

  const consumed = accountTokenService.consumeToken(rawToken, 'password_reset');
  if (!consumed) {
    throw new ValidationError('This reset link is invalid, expired, or already used.');
  }

  const member = auth.findMemberForSessionAfterVerify.get(consumed.memberId) as
    | { id: string; slug: string | null; login_email: string | null; password_version: number; is_admin: number }
    | undefined;
  if (!member) {
    throw new ValidationError('This reset link is invalid, expired, or already used.');
  }

  const newHash = await argon2.hash(newPassword);
  const now = new Date().toISOString();
  auth.updateMemberPassword.run(newHash, now, now, consumed.memberId);

  // Confirmation email, best-effort.
  try {
    if (member.login_email) {
      getCommunicationService().enqueueEmail({
        recipientEmail: member.login_email,
        recipientMemberId: consumed.memberId,
        subject: 'Your IFPA Footbag password was changed',
        bodyText:
          'Your IFPA Footbag password was reset via the password-reset link.\n\n' +
          'If this was not you, contact admin@footbag.org immediately.',
      });
    }
  } catch {
    // Swallow, the reset itself committed.
  }

  return {
    memberId: consumed.memberId,
    newPasswordVersion: member.password_version + 1,
    role: member.is_admin ? 'admin' : 'member',
  };
}

export const identityAccessService = { verifyMemberCredentials, registerMember, lookupLegacyAccount, claimLegacyAccount, changePassword, verifyEmailByToken, resendVerifyEmail, requestPasswordReset, completePasswordReset };
